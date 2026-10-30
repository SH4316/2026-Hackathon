package com.example.securitydashboard;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.*;
import org.springframework.test.web.servlet.*;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

@SpringBootTest
@AutoConfigureMockMvc
@EnabledIfEnvironmentVariable(named = "TEST_DB_URL", matches = ".+")
class MySqlApiIntegrationTest {
  @Autowired MockMvc mvc;
  @Autowired ObjectMapper json;
  @Autowired JdbcTemplate jdbc;

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    String url = System.getenv("TEST_DB_URL");
    if (url == null || !url.matches("jdbc:mysql://[^/]+/[A-Za-z0-9_]+_test(?:\\?.*)?"))
      throw new IllegalStateException(
          "TEST_DB_URL must point to a separate MySQL schema ending in _test");
    registry.add("spring.datasource.url", () -> url);
    registry.add(
        "spring.datasource.username",
        () -> System.getenv().getOrDefault("TEST_DB_USERNAME", "dashboard"));
    registry.add(
        "spring.datasource.password",
        () -> System.getenv().getOrDefault("TEST_DB_PASSWORD", "dashboard-local"));
  }

  @BeforeEach
  void reset() {
    assertThat(jdbc.queryForObject("SELECT VERSION()", String.class)).startsWith("8.");
    jdbc.update("DELETE FROM saved_searches");
    jdbc.update("UPDATE active_config SET version_id=NULL");
    jdbc.update("DELETE FROM detection_tags");
    jdbc.update("DELETE FROM detections");
    jdbc.update("DELETE FROM security_events");
    jdbc.update("DELETE FROM people");
    jdbc.update("DELETE FROM config_versions");
  }

  @Test
  void startsEmptyAndDocumentsAllApisAndPreservesMissingRoutes() throws Exception {
    mvc.perform(get("/api/v1/config-versions")).andExpect(content().json("[]"));
    mvc.perform(get("/api/v1/classifier-config"))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.code").value("NO_ACTIVE_VERSION"));
    mvc.perform(get("/api/v1/metrics"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.versionId").isEmpty())
        .andExpect(jsonPath("$.summary.eventCount").value(0))
        .andExpect(jsonPath("$.tags").isEmpty());
    mvc.perform(get("/v3/api-docs"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.servers[0].url").value("/"))
        .andExpect(jsonPath("$.paths['/api/v1/config-versions']").exists())
        .andExpect(jsonPath("$.paths['/api/v1/saved-searches/{id}/metrics']").exists());
    var tagSchema = getJson(get("/v3/api-docs")).at("/components/schemas/Tag/properties");
    assertThat(tagSchema.has("jevPrompt")).isFalse();
    assertThat(tagSchema.has("jevThreshold")).isTrue();
    var regexSchema =
        getJson(get("/v3/api-docs")).at("/components/schemas/Tag/properties/pythonRegex");
    assertThat(regexSchema.path("type")).isEqualTo(json.valueToTree(List.of("string", "null")));
    assertThat(regexSchema.path("maxLength").asInt()).isEqualTo(4000);
    assertThat(regexSchema.path("default").isTextual()).isTrue();
    assertThat(regexSchema.path("default").asText()).isEmpty();
    assertThat(regexSchema.path("description").asText()).contains("문법 검사나 실행을 하지 않으며");
    mvc.perform(get("/swagger-ui.html")).andExpect(status().is3xxRedirection());
    mvc.perform(get("/swagger-ui/index.html")).andExpect(status().isOk());
    for (String path : List.of("/api/v1/missing", "/assets/missing.js", "/random"))
      mvc.perform(get(path)).andExpect(status().isNotFound());
    for (String path : List.of("/events/123", "/settings/metrics", "/saved-searches/example"))
      mvc.perform(get(path)).andExpect(forwardedUrl("/index.html"));
  }

  @Test
  void pythonRegexRoundTripsIndependentlyAndFollowsVersionLifecycle() throws Exception {
    var draft = createDraft("Python 정규식", null);
    String id = draft.path("id").asText();
    String regex = "(?im)^(?P<email>\\w+@example\\.com)$\r\n  ";
    var root = tag("root", "부모", null);
    root.put("guidance", "기존 가이드");
    root.put("pythonRegex", regex);
    var child = tag("child", "자식", "root");
    child.put("pythonRegex", "(?P<unfinished>[");
    var omitted = tag("omitted", "생략", "root");
    var explicitNull = tag("null", "널", "root");
    explicitNull.put("pythonRegex", null);
    var saved =
        call(
            put("/api/v1/config-versions/" + id),
            Map.of(
                "revision",
                0,
                "name",
                "Python 정규식",
                "tags",
                List.of(root, child, omitted, explicitNull),
                "policyStates",
                policies()),
            200);
    assertThat(find(saved.path("tags"), "root").path("pythonRegex").asText()).isEqualTo(regex);
    assertThat(find(saved.path("tags"), "root").path("guidance").asText()).isEqualTo("기존 가이드");
    assertThat(find(saved.path("tags"), "child").path("pythonRegex").asText())
        .isEqualTo("(?P<unfinished>[");
    for (String empty : List.of("omitted", "null"))
      assertThat(find(saved.path("tags"), empty).path("pythonRegex").asText()).isEmpty();
    var published =
        call(post("/api/v1/config-versions/" + id + "/publish"), Map.of("revision", 1), 200);
    call(post("/api/v1/config-versions/" + id + "/activate"), null, 200);
    assertThat(getJson(get("/api/v1/classifier-config")).path("tags"))
        .isEqualTo(saved.path("tags"));
    var clone = createDraft("복제", id);
    assertThat(clone.path("tags")).isEqualTo(published.path("tags"));
    child.put("pythonRegex", "(?s)new\\s+value");
    var changed =
        call(
            put("/api/v1/config-versions/" + clone.path("id").asText()),
            Map.of(
                "revision",
                0,
                "name",
                "복제 수정",
                "tags",
                List.of(root, child, omitted, explicitNull),
                "policyStates",
                policies()),
            200);
    assertThat(find(changed.path("tags"), "root").path("pythonRegex").asText()).isEqualTo(regex);
    assertThat(find(changed.path("tags"), "child").path("pythonRegex").asText())
        .isEqualTo("(?s)new\\s+value");
    assertThat(
            call(
                    put("/api/v1/config-versions/" + id),
                    Map.of(
                        "revision",
                        published.path("revision").asLong(),
                        "name",
                        "게시 수정",
                        "tags",
                        List.of(root),
                        "policyStates",
                        policies()),
                    409)
                .path("code")
                .asText())
        .isEqualTo("VERSION_IMMUTABLE");
    assertThat(getJson(get("/api/v1/config-versions/" + id)).path("tags"))
        .isEqualTo(saved.path("tags"));
  }

  @Test
  void rejectsLegacyTagJevPromptInFullCatalogRequests() throws Exception {
    var draft = createDraft("명시적 분리", null);
    var oldTag = tag("a", "판단", null);
    oldTag.put("jevPrompt", "이전 태그 프롬프트");
    call(
        put("/api/v1/config-versions/" + draft.path("id").asText()),
        Map.of("revision", 0, "name", "명시적 분리", "tags", List.of(oldTag), "policyStates", List.of()),
        400);
    assertThat(getJson(get("/api/v1/config-versions/" + draft.path("id").asText())))
        .isEqualTo(draft);
  }

  @Test
  void acceptsMaximumPythonRegexCodePointsAndRejectsInvalidTextWithoutChangingDraft()
      throws Exception {
    String id = createDraft("Python 정규식 길이 검증", null).path("id").asText();
    String maximum = "😀".repeat(4000);
    var tag = tag("a", "패턴", null);
    tag.put("pythonRegex", maximum);
    var saved =
        call(
            put("/api/v1/config-versions/" + id),
            Map.of("revision", 0, "name", "길이 검증", "tags", List.of(tag), "policyStates", List.of()),
            200);
    assertThat(saved.at("/tags/0/pythonRegex").asText()).isEqualTo(maximum);
    tag.put("pythonRegex", maximum + "x");
    var tooLong =
        call(
            put("/api/v1/config-versions/" + id),
            Map.of("revision", 1, "name", "초과", "tags", List.of(tag), "policyStates", List.of()),
            400);
    assertThat(tooLong.path("fieldErrors").has("tags.pythonRegex")).isTrue();
    for (String surrogate : List.of("\\ud800", "\\udc00")) {
      String malformed =
          "{\"revision\":1,\"name\":\"잘못된 문자\",\"tags\":[{\"id\":\"a\",\"name\":\"패턴\","
              + "\"pythonRegex\":\""
              + surrogate
              + "\"}],\"policyStates\":[]}";
      mvc.perform(
              put("/api/v1/config-versions/" + id)
                  .contentType(MediaType.APPLICATION_JSON)
                  .content(malformed))
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.fieldErrors['tags.pythonRegex']").exists());
    }
    assertThat(getJson(get("/api/v1/config-versions/" + id))).isEqualTo(saved);
  }

  @Test
  void registeredPeopleRemainVisibleWithDatesAndPromptFilters() throws Exception {
    String v = version(true);
    person("active", "활동 담당자");
    person("empty", "신규 담당자");
    create(
        event(
            "person-filter",
            v,
            "active",
            "matching prompt",
            List.of(span(0, 1, "m", "a")),
            "2026-10-20T01:00:00Z"));
    var people = getJson(range(get("/api/v1/people")).param("q", "matching"));
    assertThat(people.path("totalElements").asInt()).isEqualTo(2);
    var empty = find(people.path("items"), "empty");
    assertThat(empty.path("eventCount").asLong()).isZero();
    assertThat(empty.path("findingCount").asLong()).isZero();
    assertThat(empty.path("lastEventAt").isNull()).isTrue();
    assertThat(find(people.path("items"), "active").path("eventCount").asLong()).isEqualTo(1);
    var noMatches = getJson(range(get("/api/v1/people")).param("q", "absent"));
    assertThat(noMatches.path("totalElements").asInt()).isEqualTo(2);
    for (var person : noMatches.path("items")) {
      assertThat(person.path("eventCount").asLong()).isZero();
      assertThat(person.path("lastEventAt").isNull()).isTrue();
    }
    assertThat(
            getJson(range(get("/api/v1/people")).param("q", "absent").param("personId", "empty"))
                .path("totalElements")
                .asInt())
        .isEqualTo(1);
    assertThat(
            getJson(range(get("/api/v1/people")).param("q", "absent").param("personQuery", "신규"))
                .path("totalElements")
                .asInt())
        .isEqualTo(1);
  }

  @Test
  void draftsAreRevisionCheckedPublishedImmutableClonedAndSingletonActive() throws Exception {
    var draft = createDraft("처음", null);
    String id = draft.path("id").asText();
    var edit =
        call(
            put("/api/v1/config-versions/" + id),
            Map.of("revision", 0, "name", "수정", "tags", tags(true), "policyStates", policies()),
            200);
    call(
        put("/api/v1/config-versions/" + id),
        Map.of("revision", 0, "name", "오래됨", "tags", List.of(), "policyStates", List.of()),
        409);
    call(post("/api/v1/config-versions/" + id + "/publish"), Map.of("revision", 0), 409);
    var published =
        call(
            post("/api/v1/config-versions/" + id + "/publish"),
            Map.of("revision", edit.path("revision").asLong()),
            200);
    assertThat(published.path("status").asText()).isEqualTo("PUBLISHED");
    call(
        put("/api/v1/config-versions/" + id),
        Map.of(
            "revision",
            published.path("revision").asLong(),
            "name",
            "변경",
            "tags",
            List.of(),
            "policyStates",
            List.of()),
        409);
    mvc.perform(delete("/api/v1/config-versions/" + id)).andExpect(status().isConflict());
    var clone = createDraft("복제", id);
    assertThat(clone.path("tags")).isEqualTo(published.path("tags"));
    mvc.perform(delete("/api/v1/config-versions/" + clone.path("id").asText()))
        .andExpect(status().isNoContent());
    call(post("/api/v1/config-versions/" + id + "/activate"), null, 200);
    String second = publishEmpty();
    call(post("/api/v1/config-versions/" + second + "/activate"), null, 200);
    assertThat(
            jdbc.queryForObject(
                "SELECT version_id FROM active_config WHERE singleton_id=1", String.class))
        .isEqualTo(second);
  }

  @Test
  void rejectsInvalidTreesAndUnregisteredDetectionDefinitionsAtomically() throws Exception {
    String v = version(true);
    person("p", "담당자");
    var cycle =
        List.of(
            Map.of("id", "a", "name", "A", "parentId", "b"),
            Map.of("id", "b", "name", "B", "parentId", "a"));
    String draft = createDraft("bad", null).path("id").asText();
    call(
        put("/api/v1/config-versions/" + draft),
        Map.of("revision", 0, "name", "bad", "tags", cycle, "policyStates", List.of()),
        400);
    call(
        post("/api/v1/events"),
        event("unknown", v, "p", "A😀BC", List.of(span(1, 2, "😀", "missing")), null),
        422);
    var bad = event("policy", v, "p", "safe", List.of(), null);
    bad.put("policyStateId", "missing");
    call(post("/api/v1/events"), bad, 422);
    call(post("/api/v1/events"), event("person", v, "missing", "safe", List.of(), null), 422);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM security_events", Long.class)).isZero();
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM detections", Long.class)).isZero();
  }

  @Test
  void unicodeRangesMergeReplaysAfterActivationAndOmittedTimestampRemainsStable() throws Exception {
    String v = version(true);
    person("p", "담당자");
    var body =
        event(
            "unicode",
            v,
            "p",
            " A😀BC ",
            List.of(span(2, 3, "😀", "b", "a"), span(2, 3, "😀", "a"), span(2, 4, "😀B", "b")),
            null);
    var created = call(post("/api/v1/events"), body, 201);
    assertThat(created.path("findingCount").asInt()).isEqualTo(2);
    assertThat(created.path("detections").get(0).path("tags").size()).isEqualTo(2);
    assertThat(created.path("prompt").asText()).isEqualTo(" A😀BC ");
    body.put("detections", List.of(span(2, 4, "😀B", "b"), span(2, 3, "😀", "a", "b")));
    assertThat(call(post("/api/v1/events"), body, 200)).isEqualTo(created);
    String second = publishEmpty();
    call(post("/api/v1/config-versions/" + second + "/activate"), null, 200);
    assertThat(call(post("/api/v1/events"), body, 200)).isEqualTo(created);
    body.put("eventId", "stale");
    call(post("/api/v1/events"), body, 409);
    body.put("eventId", "unicode");
    body.put("model", "different");
    call(post("/api/v1/events"), body, 409);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM security_events", Long.class))
        .isEqualTo(1);
  }

  @Test
  void sqlAggregatesDistinctSubtreeAndUnmappedAcrossEveryCapturedVersion() throws Exception {
    String v1 = version(true);
    person("p", "김_담당");
    person("empty", "영 기록");
    create(
        event(
            "first",
            v1,
            "p",
            "abc %_",
            List.of(span(0, 1, "a", "a", "b"), span(1, 2, "b", "b")),
            "2026-10-20T14:59:59Z"));
    create(event("zero", v1, "p", "zero", List.of(), "2026-10-20T15:00:00Z"));
    String v2 = createDraft("다른 트리", null).path("id").asText();
    call(
        put("/api/v1/config-versions/" + v2),
        Map.of(
            "revision",
            0,
            "name",
            "새 트리",
            "tags",
            List.of(tag("root", "상위", null), tag("a", "새 이름", "root")),
            "policyStates",
            List.of()),
        200);
    call(post("/api/v1/config-versions/" + v2 + "/publish"), Map.of("revision", 1), 200);
    call(post("/api/v1/config-versions/" + v2 + "/activate"), null, 200);
    create(event("new", v2, "p", "abc", List.of(span(0, 1, "a", "a")), "2026-10-21T01:00:00Z"));
    var metrics = getJson(range(get("/api/v1/metrics")).param("versionId", v2));
    assertThat(metrics.at("/summary/eventCount").asInt()).isEqualTo(3);
    assertThat(metrics.at("/summary/findingCount").asInt()).isEqualTo(3);
    assertThat(metrics.at("/summary/detectedEventCount").asInt()).isEqualTo(2);
    assertThat(metrics.at("/unmapped/count").asInt()).isEqualTo(1);
    assertThat(find(metrics.path("tags"), "root").path("count").asInt()).isEqualTo(2);
    assertThat(find(metrics.path("tags"), "a").path("name").asText()).isEqualTo("새 이름");
    assertThat(metrics.path("series").get(0).path("bucket").asText()).isEqualTo("2026-10-20");
    var selected =
        getJson(range(get("/api/v1/metrics")).param("versionId", v1).param("tagId", "root"));
    assertThat(selected.at("/summary/findingCount").asInt()).isEqualTo(3);
    var unmapped =
        getJson(range(get("/api/v1/metrics")).param("versionId", v2).param("unmapped", "true"));
    assertThat(unmapped.at("/summary/findingCount").asInt()).isEqualTo(1);
    assertThat(unmapped.at("/summary/eventCount").asInt()).isEqualTo(1);
    var events = getJson(range(get("/api/v1/events")).param("versionId", v2));
    assertThat(events.path("totalElements").asInt()).isEqualTo(3);
    var oldEvent = findEvent(events.path("items"), "first");
    assertThat(oldEvent.path("detections").get(0).path("tags").get(0).path("name").asText())
        .isEqualTo("이전 A");
    assertThat(getJson(range(get("/api/v1/events")).param("q", "%_")).path("totalElements").asInt())
        .isEqualTo(1);
    assertThat(
            getJson(range(get("/api/v1/people")).param("q", "%_").param("personQuery", "_"))
                .path("totalElements")
                .asInt())
        .isEqualTo(1);
    assertThat(
            getJson(range(get("/api/v1/events")).param("hasDetections", "false"))
                .path("totalElements")
                .asInt())
        .isEqualTo(1);
  }

  @Test
  void snapshotsFreezeAllMembershipAndInterpretationAndDeletionKeepsEvents() throws Exception {
    String v = version(true);
    person("p", "담당자");
    for (int i = 0; i < 23; i++)
      create(
          event("snap" + i, v, "p", "abc", List.of(span(0, 1, "a", "a")), "2026-10-20T01:00:00Z"));
    var saved =
        call(
            post("/api/v1/saved-searches"),
            Map.of(
                "name",
                "전체 저장",
                "filters",
                Map.of(
                    "from", "2026-10-20T00:00:00Z", "to", "2026-10-22T00:00:00Z", "tagId", "root")),
            201);
    String id = saved.path("id").asText();
    assertThat(saved.path("eventCount").asInt()).isEqualTo(23);
    assertThat(saved.path("versionId").asText()).isEqualTo(v);
    create(event("after", v, "p", "abc", List.of(span(0, 1, "a", "a")), "2026-10-20T01:00:00Z"));
    String next = publishEmpty();
    call(post("/api/v1/config-versions/" + next + "/activate"), null, 200);
    var page =
        getJson(
            get("/api/v1/saved-searches/" + id + "/events").param("page", "1").param("size", "20"));
    assertThat(page.path("totalElements").asInt()).isEqualTo(23);
    assertThat(page.path("items").size()).isEqualTo(3);
    var metric = getJson(get("/api/v1/saved-searches/" + id + "/metrics"));
    assertThat(metric.at("/summary/findingCount").asInt()).isEqualTo(23);
    assertThat(metric.path("versionId").asText()).isEqualTo(v);
    mvc.perform(delete("/api/v1/saved-searches/" + id)).andExpect(status().isNoContent());
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM security_events", Long.class))
        .isEqualTo(24);
  }

  @Test
  void nullAndUnmappedPoliciesUseCapturedNamesWithoutSyntheticState() throws Exception {
    String v = version(true);
    person("p", "담당");
    var e = event("with-policy", v, "p", "a", List.of(), "2026-10-20T01:00:00Z");
    e.put("policyStateId", "custom");
    create(e);
    create(event("null-policy", v, "p", "a", List.of(), "2026-10-20T01:00:00Z"));
    String empty = publishEmpty();
    call(post("/api/v1/config-versions/" + empty + "/activate"), null, 200);
    var m = getJson(range(get("/api/v1/metrics")));
    assertThat(m.path("policies").size()).isEqualTo(1);
    assertThat(m.path("policies").get(0).path("name").asText()).isEqualTo("직접 만든 정책");
    assertThat(m.path("policies").get(0).path("mapped").asBoolean()).isFalse();
    assertThat(m.path("policies").get(0).path("eventCount").asInt()).isEqualTo(1);
  }

  @Test
  void concurrentIdenticalAndConflictingIngestionIsAtomic() throws Exception {
    String v = version(true);
    person("p", "담당");
    var e = event("race", v, "p", "abc", List.of(span(0, 1, "a", "a", "b")), null);
    String body = json.writeValueAsString(e);
    var barrier = new CyclicBarrier(6);
    try (var pool = Executors.newFixedThreadPool(6)) {
      List<Callable<Integer>> calls = new ArrayList<>();
      for (int i = 0; i < 6; i++)
        calls.add(
            () -> {
              barrier.await();
              return mvc.perform(
                      post("/api/v1/events").contentType(MediaType.APPLICATION_JSON).content(body))
                  .andReturn()
                  .getResponse()
                  .getStatus();
            });
      var result = new ArrayList<Integer>();
      for (var f : pool.invokeAll(calls)) result.add(f.get());
      assertThat(result).containsOnly(200, 201);
      assertThat(result.stream().filter(s -> s == 201).count()).isEqualTo(1);
    }
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM security_events", Long.class))
        .isEqualTo(1);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM detections", Long.class)).isEqualTo(1);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM detection_tags", Long.class)).isEqualTo(2);
    e.put("prompt", "different");
    call(post("/api/v1/events"), e, 400);
    var contentBarrier = new CyclicBarrier(2);
    try (var pool = Executors.newFixedThreadPool(2)) {
      List<Callable<Integer>> calls = new ArrayList<>();
      for (String text : List.of("a", "z")) {
        String payload =
            json.writeValueAsString(
                event("content-race", v, "p", text + "bc", List.of(span(0, 1, text, "a")), null));
        calls.add(
            () -> {
              contentBarrier.await();
              return mvc.perform(
                      post("/api/v1/events")
                          .contentType(MediaType.APPLICATION_JSON)
                          .content(payload))
                  .andReturn()
                  .getResponse()
                  .getStatus();
            });
      }
      var results = new ArrayList<Integer>();
      for (var f : pool.invokeAll(calls)) results.add(f.get());
      assertThat(results).containsExactlyInAnyOrder(201, 409);
    }
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM security_events", Long.class))
        .isEqualTo(2);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM detections", Long.class)).isEqualTo(2);
  }

  @Test
  void concurrentDraftUpdatesAndActivationUseDatabaseLocks() throws Exception {
    String draft = createDraft("경합 초안", null).path("id").asText();
    var barrier = new CyclicBarrier(2);
    try (var pool = Executors.newFixedThreadPool(2)) {
      List<Callable<Integer>> calls = new ArrayList<>();
      for (String name : List.of("첫 변경", "둘째 변경")) {
        String body =
            json.writeValueAsString(
                Map.of("revision", 0, "name", name, "tags", List.of(), "policyStates", List.of()));
        calls.add(
            () -> {
              barrier.await();
              return mvc.perform(
                      put("/api/v1/config-versions/" + draft)
                          .contentType(MediaType.APPLICATION_JSON)
                          .content(body))
                  .andReturn()
                  .getResponse()
                  .getStatus();
            });
      }
      var results = new ArrayList<Integer>();
      for (var f : pool.invokeAll(calls)) results.add(f.get());
      assertThat(results).containsExactlyInAnyOrder(200, 409);
    }
    String first = publishEmpty(), second = publishEmpty();
    var activeBarrier = new CyclicBarrier(8);
    try (var pool = Executors.newFixedThreadPool(8)) {
      List<Callable<Integer>> calls = new ArrayList<>();
      for (int i = 0; i < 8; i++) {
        String id = i % 2 == 0 ? first : second;
        calls.add(
            () -> {
              activeBarrier.await();
              return mvc.perform(post("/api/v1/config-versions/" + id + "/activate"))
                  .andReturn()
                  .getResponse()
                  .getStatus();
            });
      }
      for (var f : pool.invokeAll(calls)) assertThat(f.get()).isEqualTo(200);
    }
    long activeCount = 0;
    for (var v : getJson(get("/api/v1/config-versions")))
      if (v.path("isActive").asBoolean()) activeCount++;
    assertThat(activeCount).isEqualTo(1);
  }

  @Test
  void retainsMicrosecondHalfOpenBoundsAndHourlyLimits() throws Exception {
    String v = version(true);
    person("p", "담당");
    create(event("precise", v, "p", "a", List.of(), "1987-06-01T14:30:00.123456789Z"));
    assertThat(
            getJson(
                    get("/api/v1/events")
                        .param("from", "1987-06-01T14:30:00.123456001Z")
                        .param("to", "1987-06-01T14:30:01Z"))
                .path("totalElements")
                .asInt())
        .isZero();
    assertThat(
            getJson(
                    get("/api/v1/events")
                        .param("from", "1987-06-01T14:30:00Z")
                        .param("to", "1987-06-01T14:30:00.123456001Z"))
                .path("totalElements")
                .asInt())
        .isEqualTo(1);
    var m =
        getJson(
            get("/api/v1/metrics")
                .param("from", "1987-05-31T14:00:00Z")
                .param("to", "1987-06-02T14:00:00Z"));
    assertThat(m.path("series").get(0).path("bucket").asText()).isEqualTo("1987-06-01");
    assertThat(m.path("series").get(1).path("eventCount").asInt()).isEqualTo(1);
    mvc.perform(
            get("/api/v1/metrics")
                .param("from", "2026-01-01T00:00:00Z")
                .param("to", "2026-03-01T00:00:00Z")
                .param("interval", "hour"))
        .andExpect(status().isBadRequest());
  }

  @Test
  void supportsFullSizeCatalogAndDetectionLimits() throws Exception {
    String id = createDraft("최대 크기", null).path("id").asText();
    List<Map<String, Object>> catalog = new ArrayList<>();
    for (int n = 0; n < 1000; n++)
      catalog.add(tag("n" + n, "태그" + n, n == 0 ? null : n < 32 ? "n" + (n - 1) : "n0"));
    call(
        put("/api/v1/config-versions/" + id),
        Map.of("revision", 0, "name", "최대 크기", "tags", catalog, "policyStates", List.of()),
        200);
    catalog.add(tag("extra", "초과", null));
    call(
        put("/api/v1/config-versions/" + id),
        Map.of("revision", 1, "name", "초과", "tags", catalog, "policyStates", List.of()),
        400);
    call(post("/api/v1/config-versions/" + id + "/publish"), Map.of("revision", 1), 200);
    call(post("/api/v1/config-versions/" + id + "/activate"), null, 200);
    person("p", "담당");
    List<Map<String, Object>> spans = new ArrayList<>();
    for (int n = 0; n < 1000; n++) spans.add(span(n, n + 1, "a", "n31"));
    var body = event("max-detections", id, "p", "a".repeat(1000), spans, null);
    var created = create(body);
    assertThat(created.path("findingCount").asInt()).isEqualTo(1000);
    spans.add(span(0, 1, "a", "n0"));
    body.put("eventId", "too-many");
    call(post("/api/v1/events"), body, 400);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM security_events", Long.class))
        .isEqualTo(1);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM detections", Long.class)).isEqualTo(1000);
  }

  @Test
  void acceptsLargePromptAndRejectsOversizedChunkedOrMalformedSensitiveInput() throws Exception {
    String v = version(true);
    person("p", "담당");
    create(event("large", v, "p", "😀".repeat(200000), List.of(), null));
    byte[] oversized =
        ("{\"name\":\"" + "x".repeat(1024 * 1024) + "\"}")
            .getBytes(java.nio.charset.StandardCharsets.UTF_8);
    mvc.perform(post("/api/v1/people").contentType(MediaType.APPLICATION_JSON).content(oversized))
        .andExpect(status().isPayloadTooLarge());
    mvc.perform(
            post("/api/v1/people")
                .contentType(MediaType.APPLICATION_JSON)
                .content(oversized)
                .with(
                    request ->
                        new org.springframework.mock.web.MockHttpServletRequest() {
                          {
                            setMethod("POST");
                            setRequestURI("/api/v1/people");
                            setContentType("application/json");
                            setContent(oversized);
                          }

                          @Override
                          public long getContentLengthLong() {
                            return -1;
                          }
                        }))
        .andExpect(status().isPayloadTooLarge());
    String malformed = "{\"sourceId\":123,\"prompt\":\"sensitive-example\"}";
    var response =
        mvc.perform(
                post("/api/v1/events").contentType(MediaType.APPLICATION_JSON).content(malformed))
            .andExpect(status().isBadRequest())
            .andReturn();
    assertThat(response.getResponse().getContentAsString()).doesNotContain("sensitive-example");
  }

  private JsonNode call(MockHttpServletRequestBuilder request, Object body, int status)
      throws Exception {
    request.contentType(MediaType.APPLICATION_JSON);
    if (body != null) request.content(json.writeValueAsString(body));
    return json.readTree(
        mvc.perform(request)
            .andExpect(status().is(status))
            .andReturn()
            .getResponse()
            .getContentAsString());
  }

  private JsonNode getJson(MockHttpServletRequestBuilder request) throws Exception {
    return json.readTree(
        mvc.perform(request)
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString());
  }

  private JsonNode createDraft(String name, String base) throws Exception {
    var m = new LinkedHashMap<String, Object>();
    m.put("name", name);
    if (base != null) m.put("baseVersionId", base);
    return call(post("/api/v1/config-versions"), m, 201);
  }

  private String publishEmpty() throws Exception {
    String id = createDraft("빈 게시 버전", null).path("id").asText();
    call(post("/api/v1/config-versions/" + id + "/publish"), Map.of("revision", 0), 200);
    return id;
  }

  private String version(boolean activate) throws Exception {
    String id = createDraft("설정", null).path("id").asText();
    call(
        put("/api/v1/config-versions/" + id),
        Map.of("revision", 0, "name", "설정", "tags", tags(true), "policyStates", policies()),
        200);
    call(post("/api/v1/config-versions/" + id + "/publish"), Map.of("revision", 1), 200);
    if (activate) call(post("/api/v1/config-versions/" + id + "/activate"), null, 200);
    return id;
  }

  private List<Map<String, Object>> tags(boolean unused) {
    return List.of(tag("root", "상위", null), tag("a", "이전 A", "root"), tag("b", "이전 B", "root"));
  }

  private Map<String, Object> tag(String id, String name, String parent) {
    var m = new LinkedHashMap<String, Object>();
    m.put("id", id);
    m.put("name", name);
    m.put("parentId", parent);
    return m;
  }

  private List<Map<String, Object>> policies() {
    return List.of(Map.of("id", "custom", "name", "직접 만든 정책", "color", "#ABCDEF"));
  }

  private void person(String id, String name) throws Exception {
    call(post("/api/v1/people"), Map.of("id", id, "name", name), 201);
  }

  private Map<String, Object> event(
      String event, String version, String person, String prompt, List<?> spans, String time) {
    var m = new LinkedHashMap<String, Object>();
    m.put("sourceId", "src");
    m.put("eventId", event);
    m.put("personId", person);
    m.put("versionId", version);
    m.put("prompt", prompt);
    m.put("detections", spans);
    if (time != null) m.put("occurredAt", time);
    return m;
  }

  private Map<String, Object> span(int start, int end, String text, String... ids) {
    return Map.of("start", start, "end", end, "text", text, "tagIds", List.of(ids));
  }

  private JsonNode create(Map<String, Object> input) throws Exception {
    return call(post("/api/v1/events"), input, 201);
  }

  private MockHttpServletRequestBuilder range(MockHttpServletRequestBuilder q) {
    return q.param("from", "2026-10-19T15:00:00Z").param("to", "2026-10-22T15:00:00Z");
  }

  private JsonNode find(JsonNode nodes, String id) {
    for (var n : nodes) if (n.path("id").asText().equals(id)) return n;
    throw new AssertionError("missing " + id);
  }

  private JsonNode findEvent(JsonNode nodes, String id) {
    for (var n : nodes) if (n.path("eventId").asText().equals(id)) return n;
    throw new AssertionError("missing " + id);
  }
}
