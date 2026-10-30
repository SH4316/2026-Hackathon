package com.example.securitydashboard;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.Executors;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

@SpringBootTest
@AutoConfigureMockMvc
@EnabledIfEnvironmentVariable(named = "TEST_DB_URL", matches = ".+")
class TagDetailsIntegrationTest {
  @Autowired MockMvc mvc;
  @Autowired ObjectMapper json;
  @Autowired JdbcTemplate jdbc;

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    String url = System.getenv("TEST_DB_URL");
    if (url == null || !url.matches("jdbc:mysql://[^/]+/[A-Za-z0-9_]+_test(?:\\?.*)?"))
      throw new IllegalStateException(
          "TEST_DB_URL must point to a separate schema ending in _test");
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
    jdbc.update("DELETE FROM saved_searches");
    jdbc.update("UPDATE active_config SET version_id=NULL");
    jdbc.update("DELETE FROM detection_tags");
    jdbc.update("DELETE FROM detections");
    jdbc.update("DELETE FROM security_events");
    jdbc.update("DELETE FROM people");
    jdbc.update("DELETE FROM config_versions");
  }

  @Test
  void updatesAllPublishedTagDetailsOnlyInSelectedVersionWithoutReplacingItsTree()
      throws Exception {
    var draft = catalog();
    String id = draft.path("id").asText();
    call(post("/api/v1/config-versions/" + id + "/publish"), Map.of("revision", 1), 200);
    var before = call(post("/api/v1/config-versions/" + id + "/activate"), null, 200);
    var clone =
        call(post("/api/v1/config-versions"), Map.of("name", "다른 트리", "baseVersionId", id), 201);
    call(post("/api/v1/people"), Map.of("id", "person", "name", "담당"), 201);
    call(
        post("/api/v1/events"),
        Map.of(
            "sourceId",
            "details",
            "eventId",
            "referenced-tag",
            "personId",
            "person",
            "versionId",
            id,
            "prompt",
            "x",
            "detections",
            List.of(Map.of("start", 0, "end", 1, "text", "x", "tagIds", List.of("child")))),
        201);
    var counts = catalogCounts();
    String prompt = "  자체 판단 😀\r\n\t줄바꿈 유지\n ";
    String regex = "(?im)^(?P<email>\\w+@example\\.com)$\r\n  ";
    var body = details(before.path("revision").asLong(), "  변경 이름  ");
    body.put("description", "새 설명");
    body.put("examples", List.of("새 예시", "  공백 예시\n"));
    body.put("guidance", "새 가이드");
    body.put("jevPrompt", prompt);
    body.put("pythonRegex", regex);
    body.put("color", "#ab12ef");
    var changed = call(put(tagPath(id, "child")), body, 200);

    for (String field :
        List.of("id", "name", "status", "isActive", "createdAt", "publishedAt", "policyStates"))
      assertThat(changed.path(field)).as(field).isEqualTo(before.path(field));
    assertThat(changed.path("revision").asLong()).isEqualTo(before.path("revision").asLong() + 1);
    assertThat(changed.path("tags").size()).isEqualTo(before.path("tags").size());
    for (var tag : before.path("tags")) {
      var after = find(changed.path("tags"), tag.path("id").asText());
      for (String field : List.of("id", "parentId", "order"))
        assertThat(after.path(field)).as(field).isEqualTo(tag.path(field));
      if (!tag.path("id").asText().equals("child")) assertThat(after).isEqualTo(tag);
    }
    var child = find(changed.path("tags"), "child");
    assertThat(child.path("name").asText()).isEqualTo("변경 이름");
    assertThat(child.path("description").asText()).isEqualTo("새 설명");
    assertThat(child.path("examples")).isEqualTo(json.valueToTree(body.get("examples")));
    assertThat(child.path("guidance").asText()).isEqualTo("새 가이드");
    assertThat(child.path("jevPrompt").asText()).isEqualTo(prompt);
    assertThat(child.path("pythonRegex").asText()).isEqualTo(regex);
    assertThat(child.path("color").asText()).isEqualTo("#AB12EF");
    assertThat(call(get("/api/v1/config-versions/" + clone.path("id").asText()), null, 200))
        .isEqualTo(clone);
    assertThat(call(get("/api/v1/classifier-config"), null, 200)).isEqualTo(changed);
    assertThat(catalogCounts()).isEqualTo(counts);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM detection_tags", Long.class)).isEqualTo(1);
  }

  @Test
  void draftDetailsUseSharedDefaultsAndRejectStaleDetailAndFullCatalogSaves() throws Exception {
    var before = catalog();
    String id = before.path("id").asText();
    var body = details(1, "  상세만 변경  ");
    body.put("description", null);
    body.put("examples", null);
    body.put("guidance", null);
    body.put("jevPrompt", null);
    body.put("pythonRegex", null);
    body.put("color", null);
    var changed = call(put(tagPath(id, "child")), body, 200);
    var child = find(changed.path("tags"), "child");
    assertThat(child.path("name").asText()).isEqualTo("상세만 변경");
    for (String field : List.of("description", "guidance", "jevPrompt", "pythonRegex"))
      assertThat(child.path(field).asText()).as(field).isEmpty();
    assertThat(child.path("examples")).isEmpty();
    assertThat(child.path("color").asText()).isEqualTo("#64748B");
    assertThat(changed.path("status").asText()).isEqualTo("DRAFT");
    assertThat(changed.path("revision").asInt()).isEqualTo(2);
    assertThat(call(put(tagPath(id, "child")), body, 409).path("code").asText())
        .isEqualTo("REVISION_CONFLICT");
    assertThat(
            call(
                    put("/api/v1/config-versions/" + id),
                    Map.of(
                        "revision",
                        1,
                        "name",
                        "오래된 전체 저장",
                        "tags",
                        before.path("tags"),
                        "policyStates",
                        before.path("policyStates")),
                    409)
                .path("code")
                .asText())
        .isEqualTo("REVISION_CONFLICT");
    assertThat(call(get("/api/v1/config-versions/" + id), null, 200)).isEqualTo(changed);
    var latest = details(2, "최신 변경");
    assertThat(call(put(tagPath(id, "child")), latest, 200).path("revision").asInt()).isEqualTo(3);
  }

  @Test
  void rejectsStructuralOrUnknownFieldsAndMissingTagsWithoutMutatingCatalog() throws Exception {
    var before = catalog();
    String id = before.path("id").asText();
    for (var field :
        Map.<String, Object>of(
                "id",
                "new-tag",
                "parentId",
                "sibling",
                "order",
                99,
                "tags",
                List.of(),
                "policyStates",
                List.of(),
                "status",
                "PUBLISHED",
                "unknown",
                true)
            .entrySet()) {
      var body = details(1, "구조 변경 시도");
      body.put(field.getKey(), field.getValue());
      call(put(tagPath(id, "child")), body, 400);
    }
    assertThat(call(put(tagPath(id, "missing")), details(1, "추가 시도"), 404).path("code").asText())
        .isEqualTo("TAG_NOT_FOUND");
    assertThat(
            call(put(tagPath("missing", "child")), details(1, "없는 버전"), 404).path("code").asText())
        .isEqualTo("VERSION_NOT_FOUND");
    assertThat(call(get("/api/v1/config-versions/" + id), null, 200)).isEqualTo(before);
  }

  @Test
  void validatesDetailValuesAndRevisionWithoutChangingTheVersion() throws Exception {
    var before = catalog();
    String id = before.path("id").asText();
    List<Map.Entry<String, Object>> invalid = new ArrayList<>();
    invalid.add(Map.entry("name", " "));
    invalid.add(Map.entry("name", "x".repeat(81)));
    invalid.add(Map.entry("description", "😀".repeat(4001)));
    invalid.add(Map.entry("guidance", "x".repeat(4001)));
    invalid.add(Map.entry("examples", java.util.Collections.nCopies(21, "x")));
    invalid.add(Map.entry("examples", List.of("x".repeat(1001))));
    invalid.add(Map.entry("examples", java.util.Arrays.asList((String) null)));
    invalid.add(Map.entry("jevPrompt", "😀".repeat(12001)));
    invalid.add(Map.entry("pythonRegex", "😀".repeat(4001)));
    invalid.add(Map.entry("color", "invalid"));
    invalid.add(Map.entry("revision", -1));
    invalid.add(Map.entry("revision", 1.5));
    for (var field : invalid) {
      var body = details(1, "유효 이름");
      body.put(field.getKey(), field.getValue());
      call(put(tagPath(id, "child")), body, 400);
    }
    for (String field : List.of("jevPrompt", "pythonRegex"))
      for (String surrogate : List.of("\\ud800", "\\udc00"))
        mvc.perform(
                put(tagPath(id, "child"))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(
                        "{\"revision\":1,\"name\":\"유효 이름\",\""
                            + field
                            + "\":\""
                            + surrogate
                            + "\"}"))
            .andExpect(status().isBadRequest());
    var missingRevision = details(1, "유효 이름");
    missingRevision.remove("revision");
    call(put(tagPath(id, "child")), missingRevision, 400);
    missingRevision.put("revision", null);
    call(put(tagPath(id, "child")), missingRevision, 400);
    assertThat(call(get("/api/v1/config-versions/" + id), null, 200)).isEqualTo(before);
  }

  @Test
  void concurrentMetadataAndPublishingHonorOneRevisionAndPreservePublishedTree() throws Exception {
    var before = catalog();
    String id = before.path("id").asText();
    var barrier = new CyclicBarrier(2);
    try (var pool = Executors.newFixedThreadPool(2)) {
      List<Callable<Integer>> calls =
          List.of(
              () -> concurrentCall(barrier, put(tagPath(id, "child")), details(1, "경합 상세")),
              () ->
                  concurrentCall(
                      barrier,
                      post("/api/v1/config-versions/" + id + "/publish"),
                      Map.of("revision", 1)));
      var statuses = new ArrayList<Integer>();
      for (var future : pool.invokeAll(calls)) statuses.add(future.get());
      assertThat(statuses).containsExactlyInAnyOrder(200, 409);
    }
    var changed = call(get("/api/v1/config-versions/" + id), null, 200);
    assertThat(changed.path("revision").asInt()).isEqualTo(2);
    if (changed.path("status").asText().equals("DRAFT")) {
      assertThat(find(changed.path("tags"), "child").path("name").asText()).isEqualTo("경합 상세");
      changed =
          call(post("/api/v1/config-versions/" + id + "/publish"), Map.of("revision", 2), 200);
    } else {
      assertThat(changed.path("tags")).isEqualTo(before.path("tags"));
    }
    var tree = changed.path("tags");
    var saved =
        call(put(tagPath(id, "child")), details(changed.path("revision").asLong(), "게시 후 상세"), 200);
    assertThat(saved.path("status").asText()).isEqualTo("PUBLISHED");
    for (var tag : tree) {
      var after = find(saved.path("tags"), tag.path("id").asText());
      assertThat(after.path("parentId")).isEqualTo(tag.path("parentId"));
      assertThat(after.path("order")).isEqualTo(tag.path("order"));
    }
  }

  @Test
  void concurrentPublishedMetadataUpdatesRejectStaleRevisionAndActivationDoesNotDeadlock()
      throws Exception {
    var draft = catalog();
    String id = draft.path("id").asText();
    call(post("/api/v1/config-versions/" + id + "/publish"), Map.of("revision", 1), 200);
    var barrier = new CyclicBarrier(3);
    try (var pool = Executors.newFixedThreadPool(3)) {
      List<Callable<Integer>> calls =
          List.of(
              () -> concurrentCall(barrier, put(tagPath(id, "child")), details(2, "첫 변경")),
              () -> concurrentCall(barrier, put(tagPath(id, "sibling")), details(2, "둘째 변경")),
              () ->
                  concurrentCall(
                      barrier, post("/api/v1/config-versions/" + id + "/activate"), null));
      var statuses = new ArrayList<Integer>();
      for (var future : pool.invokeAll(calls)) statuses.add(future.get());
      assertThat(statuses).containsExactlyInAnyOrder(200, 200, 409);
    }
    var saved = call(get("/api/v1/classifier-config"), null, 200);
    assertThat(saved.path("revision").asInt()).isEqualTo(3);
    assertThat(saved.path("isActive").asBoolean()).isTrue();
    assertThat(saved.path("tags").size()).isEqualTo(3);
  }

  @Test
  void documentsSelectedVersionDetailContractAndConstraints() throws Exception {
    var api = call(get("/v3/api-docs"), null, 200);
    var operation = api.at("/paths/~1api~1v1~1config-versions~1{id}~1tags~1{tagId}/put");
    assertThat(operation.path("description").asText())
        .contains("게시 버전", "다른 버전", "REVISION_CONFLICT");
    assertThat(operation.at("/requestBody/content/application~1json/examples").size()).isEqualTo(1);
    var schema = api.at("/components/schemas/UpdateTagDetails");
    assertThat(schema.path("required"))
        .contains(json.valueToTree("revision"), json.valueToTree("name"));
    assertThat(schema.path("additionalProperties").asBoolean(true)).isFalse();
    assertThat(schema.at("/properties/revision/minimum").asInt()).isZero();
    assertThat(schema.at("/properties/name/maxLength").asInt()).isEqualTo(80);
    assertThat(schema.at("/properties/description/maxLength").asInt()).isEqualTo(4000);
    assertThat(schema.at("/properties/examples/maxItems").asInt()).isEqualTo(20);
    assertThat(schema.at("/properties/jevPrompt/maxLength").asInt()).isEqualTo(12000);
    assertThat(schema.at("/properties/pythonRegex/maxLength").asInt()).isEqualTo(4000);
    for (String field : List.of("id", "parentId", "order", "tags", "policyStates"))
      assertThat(schema.path("properties").has(field)).as(field).isFalse();
  }

  private int concurrentCall(
      CyclicBarrier barrier, MockHttpServletRequestBuilder request, Object body) throws Exception {
    request.contentType(MediaType.APPLICATION_JSON);
    if (body != null) request.content(json.writeValueAsString(body));
    barrier.await(10, java.util.concurrent.TimeUnit.SECONDS);
    return mvc.perform(request).andReturn().getResponse().getStatus();
  }

  private JsonNode catalog() throws Exception {
    var draft = call(post("/api/v1/config-versions"), Map.of("name", "트리"), 201);
    var root =
        Map.of(
            "id",
            "root",
            "name",
            "부모",
            "jevPrompt",
            "부모 판단",
            "pythonRegex",
            "부모 패턴",
            "color",
            "#AA0000",
            "order",
            10);
    var child = Map.of("id", "child", "name", "자식", "parentId", "root", "order", 20);
    var sibling = Map.of("id", "sibling", "name", "다른 자식", "parentId", "root", "order", 30);
    return call(
        put("/api/v1/config-versions/" + draft.path("id").asText()),
        Map.of(
            "revision",
            0,
            "name",
            "트리",
            "tags",
            List.of(root, child, sibling),
            "policyStates",
            List.of(Map.of("id", "review", "name", "검토", "color", "#AABBCC"))),
        200);
  }

  private Map<String, Object> details(long revision, String name) {
    var body = new LinkedHashMap<String, Object>();
    body.put("revision", revision);
    body.put("name", name);
    return body;
  }

  private Map<String, Long> catalogCounts() {
    var result = new LinkedHashMap<String, Long>();
    for (String table :
        List.of(
            "config_versions",
            "config_version_tags",
            "config_tag_closure",
            "config_version_policies"))
      result.put(table, jdbc.queryForObject("SELECT COUNT(*) FROM " + table, Long.class));
    return result;
  }

  private String tagPath(String versionId, String tagId) {
    return "/api/v1/config-versions/" + versionId + "/tags/" + tagId;
  }

  private JsonNode find(JsonNode tags, String id) {
    for (var tag : tags) if (tag.path("id").asText().equals(id)) return tag;
    throw new AssertionError("Missing tag " + id);
  }

  private JsonNode call(MockHttpServletRequestBuilder request, Object body, int expectedStatus)
      throws Exception {
    request.contentType(MediaType.APPLICATION_JSON);
    if (body != null) request.content(json.writeValueAsString(body));
    return json.readTree(
        mvc.perform(request)
            .andExpect(status().is(expectedStatus))
            .andReturn()
            .getResponse()
            .getContentAsString());
  }
}
