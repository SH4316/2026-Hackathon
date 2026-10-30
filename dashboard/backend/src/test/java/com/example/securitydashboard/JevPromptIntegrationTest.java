package com.example.securitydashboard;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Arrays;
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
class JevPromptIntegrationTest {
  @Autowired MockMvc mvc;
  @Autowired ObjectMapper json;
  @Autowired JdbcTemplate jdbc;

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    String url = System.getenv("TEST_DB_URL");
    if (url == null || !url.matches("jdbc:mysql://[^/]+/[A-Za-z0-9_]+_test(?:\\?.*)?"))
      throw new IllegalStateException("TEST_DB_URL must point to a schema ending in _test");
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
  void standalonePromptCrudOnPublishedActiveVersionKeepsTagsAndOtherVersionsIntact()
      throws Exception {
    var before = catalog();
    String id = before.path("id").asText();
    before = call(post(versionPath(id) + "/publish"), Map.of("revision", 1), 200);
    before = call(post(versionPath(id) + "/activate"), null, 200);
    var clone =
        call(post("/api/v1/config-versions"), Map.of("name", "다른 버전", "baseVersionId", id), 201);
    var tree = structuralSnapshot(before);
    String raw = "  독립 판단 😀\r\n\t공백 유지\n ";
    var created =
        call(
            post(promptsPath(id)),
            save(
                2,
                "  보안 판단  ",
                raw,
                List.of(output("child", new BigDecimal("0.123456")), output("root", null))),
            201);
    assertThat(created.path("revision").asInt()).isEqualTo(3);
    assertThat(created.path("status").asText()).isEqualTo("PUBLISHED");
    assertThat(created.path("isActive").asBoolean()).isTrue();
    assertThat(structuralSnapshot(created)).isEqualTo(tree);
    assertThat(created.path("jevPrompts").size()).isEqualTo(1);
    var prompt = created.path("jevPrompts").get(0);
    String promptId = prompt.path("id").asText();
    assertThat(promptId).isNotBlank();
    assertThat(prompt.path("name").asText()).isEqualTo("보안 판단");
    assertThat(prompt.path("prompt").asText()).isEqualTo(raw);
    assertThat(prompt.path("tagIds"))
        .containsExactly(json.valueToTree("child"), json.valueToTree("root"));
    assertThat(find(created.path("tags"), "child").path("jevThreshold").decimalValue())
        .isEqualByComparingTo("0.123456");
    assertThat(find(created.path("tags"), "root").path("jevThreshold").isNull()).isTrue();
    for (var tag : created.path("tags")) assertThat(tag.has("jevPrompt")).isFalse();
    assertThat(call(get(versionPath(clone.path("id").asText())), null, 200)).isEqualTo(clone);
    assertThat(call(get("/api/v1/classifier-config"), null, 200)).isEqualTo(created);

    var edited = call(put(promptsPath(id) + "/" + promptId), save(3, "수정", "", List.of()), 200);
    assertThat(edited.path("revision").asInt()).isEqualTo(4);
    assertThat(edited.at("/jevPrompts/0/id").asText()).isEqualTo(promptId);
    assertThat(edited.at("/jevPrompts/0/prompt").asText()).isEmpty();
    assertThat(edited.at("/jevPrompts/0/tagIds")).isEmpty();
    assertThat(find(edited.path("tags"), "child").path("jevThreshold").decimalValue())
        .isEqualByComparingTo("0.123456");
    var deleted = call(delete(promptsPath(id) + "/" + promptId), Map.of("revision", 4), 200);
    assertThat(deleted.path("revision").asInt()).isEqualTo(5);
    assertThat(deleted.path("jevPrompts")).isEmpty();
    assertThat(deleted.path("tags")).isEqualTo(edited.path("tags"));
    assertThat(structuralSnapshot(deleted)).isEqualTo(tree);
    assertThat(call(get(versionPath(clone.path("id").asText())), null, 200)).isEqualTo(clone);
  }

  @Test
  void outputThresholdIsSharedAcrossPromptsAndSurvivesUnbindingAndDeletion() throws Exception {
    var draft = catalog();
    String id = draft.path("id").asText();
    var first =
        call(
            post(promptsPath(id)),
            save(1, "첫 판단", "A", List.of(output("child", BigDecimal.ZERO))),
            201);
    String firstId = first.at("/jevPrompts/0/id").asText();
    var second =
        call(
            post(promptsPath(id)),
            save(2, "둘째 판단", "B", List.of(output("child", BigDecimal.ONE))),
            201);
    String secondId = second.at("/jevPrompts/1/id").asText();
    assertThat(find(second.path("tags"), "child").path("jevThreshold").decimalValue())
        .isEqualByComparingTo("1");
    assertThat(find(second.path("jevPrompts"), firstId).path("tagIds"))
        .containsExactly(json.valueToTree("child"));
    var updated =
        call(
            put(promptsPath(id) + "/" + firstId),
            save(3, "첫 판단", "A", List.of(output("child", new BigDecimal("0.123456")))),
            200);
    assertThat(find(updated.path("tags"), "child").path("jevThreshold").decimalValue())
        .isEqualByComparingTo("0.123456");
    assertThat(find(updated.path("jevPrompts"), secondId).path("tagIds"))
        .containsExactly(json.valueToTree("child"));
    var removed = call(delete(promptsPath(id) + "/" + firstId), Map.of("revision", 4), 200);
    assertThat(find(removed.path("tags"), "child").path("jevThreshold").decimalValue())
        .isEqualByComparingTo("0.123456");
    var cleared =
        call(
            put(promptsPath(id) + "/" + secondId),
            save(5, "둘째 판단", "B", List.of(output("child", null))),
            200);
    assertThat(find(cleared.path("tags"), "child").path("jevThreshold").isNull()).isTrue();
  }

  @Test
  void clonePreservesPromptsBindingsAndThresholdsAndCatalogReplacementOnlyDropsRemovedBindings()
      throws Exception {
    var draft = catalog();
    String sourceId = draft.path("id").asText();
    var original =
        call(
            post(promptsPath(sourceId)),
            save(
                1,
                "복제할 판단",
                "  원문 😀\n",
                List.of(output("root", BigDecimal.ZERO), output("child", new BigDecimal("0.5")))),
            201);
    var clone =
        call(post("/api/v1/config-versions"), Map.of("name", "복제", "baseVersionId", sourceId), 201);
    assertThat(clone.path("tags")).isEqualTo(original.path("tags"));
    assertThat(clone.path("jevPrompts")).isEqualTo(original.path("jevPrompts"));
    String id = clone.path("id").asText();
    String promptId = clone.at("/jevPrompts/0/id").asText();
    var keptRoot = find(clone.path("tags"), "root").deepCopy();
    var changed =
        call(
            put(versionPath(id)),
            Map.of(
                "revision",
                0,
                "name",
                "구조 변경",
                "tags",
                List.of(keptRoot, Map.of("id", "new", "name", "새 태그", "parentId", "root")),
                "policyStates",
                clone.path("policyStates")),
            200);
    assertThat(changed.path("jevPrompts").size()).isEqualTo(1);
    assertThat(changed.at("/jevPrompts/0/id").asText()).isEqualTo(promptId);
    assertThat(changed.at("/jevPrompts/0/prompt")).isEqualTo(clone.at("/jevPrompts/0/prompt"));
    assertThat(changed.at("/jevPrompts/0/tagIds")).containsExactly(json.valueToTree("root"));
    assertThat(find(changed.path("tags"), "root").path("jevThreshold").decimalValue())
        .isEqualByComparingTo("0");
    assertThat(call(get(versionPath(sourceId)), null, 200)).isEqualTo(original);
    // The same cloned prompt ID only changes the selected version.
    call(
        put(promptsPath(id) + "/" + promptId),
        save(1, "복제 판단 수정", "새 원문", List.of(output("new", BigDecimal.ONE))),
        200);
    assertThat(call(get(versionPath(sourceId)), null, 200)).isEqualTo(original);
  }

  @Test
  void validatesNamePromptOutputsAndRevisionWithoutMutation() throws Exception {
    var before = catalog();
    String id = before.path("id").asText();
    var invalid = new ArrayList<Map<String, Object>>();
    for (Object name : List.of("", "  ", "x".repeat(81), 1, true)) invalid.add(with("name", name));
    for (Object prompt : List.of("😀".repeat(12001), 1, true)) invalid.add(with("prompt", prompt));
    for (Object outputs :
        List.of(
            "child",
            true,
            List.of("child"),
            List.of(Map.of("tagId", "")),
            List.of(Map.of("tagId", 1)),
            List.of(Map.of("tagId", true)),
            List.of(Map.of("tagId", "child", "unknown", true)),
            List.of(output("child", null), output("child", null)),
            Arrays.asList((Object) null))) invalid.add(with("outputs", outputs));
    for (Object revision : List.of(-1, 1.5, "1", true)) invalid.add(with("revision", revision));
    for (Object threshold :
        List.of(
            new BigDecimal("-0.000001"),
            new BigDecimal("1.000001"),
            new BigDecimal("0.1234567"),
            "0.5",
            true)) invalid.add(with("outputs", List.of(output("child", threshold))));
    for (var override : invalid) {
      var body = save(1, "유효 이름", "원문", List.of());
      body.putAll(override);
      call(post(promptsPath(id)), body, 400);
    }
    for (String field : List.of("name", "outputs", "revision")) {
      var body = save(1, "유효 이름", "원문", List.of());
      body.remove(field);
      call(post(promptsPath(id)), body, 400);
      body.put(field, null);
      call(post(promptsPath(id)), body, 400);
    }
    for (String extra : List.of("id", "tags", "tagIds", "status", "jevThreshold")) {
      var body = save(1, "유효 이름", "원문", List.of());
      body.put(extra, "unknown");
      call(post(promptsPath(id)), body, 400);
    }
    for (String surrogate : List.of("\\ud800", "\\udc00"))
      raw(
          post(promptsPath(id)),
          "{\"revision\":1,\"name\":\"유효 이름\",\"prompt\":\"" + surrogate + "\",\"outputs\":[]}",
          400);
    for (String threshold : List.of("NaN", "Infinity", "-Infinity", "\"NaN\"", "{}", "[]"))
      raw(
          post(promptsPath(id)),
          "{\"revision\":1,\"name\":\"유효"
              + " 이름\",\"prompt\":\"\",\"outputs\":[{\"tagId\":\"child\",\"threshold\":"
              + threshold
              + "}]}",
          400);
    assertThat(call(get(versionPath(id)), null, 200)).isEqualTo(before);
  }

  @Test
  void acceptsMaximumUnicodePromptAndNameAndRejectsMoreThanThousandOutputs() throws Exception {
    var before = catalog();
    String id = before.path("id").asText();
    String maximum = "😀".repeat(12000);
    var saved = call(post(promptsPath(id)), save(1, "x".repeat(80), maximum, List.of()), 201);
    assertThat(saved.at("/jevPrompts/0/prompt").asText()).isEqualTo(maximum);
    assertThat(saved.at("/jevPrompts/0/name").asText()).hasSize(80);
    var outputs = new ArrayList<Map<String, Object>>();
    for (int i = 0; i <= 1000; i++) outputs.add(output("tag-" + i, null));
    call(post(promptsPath(id)), save(2, "한도 초과", "", outputs), 400);
    assertThat(call(get(versionPath(id)), null, 200)).isEqualTo(saved);
  }

  @Test
  void missingReferencesAndLaterInvalidOutputsRollBackPromptThresholdAndRevision()
      throws Exception {
    var before = catalog();
    String id = before.path("id").asText();
    var saved =
        call(
            post(promptsPath(id)),
            save(1, "기존 판단", "기존 원문", List.of(output("root", new BigDecimal("0.1")))),
            201);
    String promptId = saved.at("/jevPrompts/0/id").asText();
    assertThat(
            call(put(promptsPath(id) + "/missing"), save(2, "없는 판단", "", List.of()), 404)
                .path("code")
                .asText())
        .isEqualTo("JEV_PROMPT_NOT_FOUND");
    call(delete(promptsPath(id) + "/missing"), Map.of("revision", 2), 404);
    call(post(promptsPath("missing")), save(0, "없는 버전", "", List.of()), 404);
    assertThat(
            call(
                    put(promptsPath(id) + "/" + promptId),
                    save(
                        2,
                        "실패해야 함",
                        "바뀌면 안 됨",
                        List.of(
                            output("root", new BigDecimal("0.9")),
                            output("missing", BigDecimal.ONE))),
                    400)
                .path("code")
                .asText())
        .isEqualTo("INVALID_INPUT");
    call(
        put(promptsPath(id) + "/" + promptId),
        save(
            2,
            "실패",
            "실패",
            List.of(
                output("root", new BigDecimal("0.9")),
                output("child", new BigDecimal("0.1234567")))),
        400);
    call(
        post(promptsPath(id)),
        save(
            2,
            "생성 실패",
            "실패",
            List.of(output("root", new BigDecimal("0.9")), output("missing", BigDecimal.ONE))),
        400);
    assertThat(call(get(versionPath(id)), null, 200)).isEqualTo(saved);
    call(post(promptsPath(id)), save(1, "오래된 생성", "", List.of()), 409);
    call(put(promptsPath(id) + "/" + promptId), save(1, "오래된 수정", "", List.of()), 409);
    call(delete(promptsPath(id) + "/" + promptId), Map.of("revision", 1), 409);
    assertThat(call(get(versionPath(id)), null, 200)).isEqualTo(saved);
  }

  @Test
  void concurrentPromptAndTagUpdatesShareVersionRevision() throws Exception {
    var before = catalog();
    String id = before.path("id").asText();
    var barrier = new CyclicBarrier(2);
    try (var pool = Executors.newFixedThreadPool(2)) {
      List<Callable<Integer>> tasks =
          List.of(
              () ->
                  concurrent(
                      barrier,
                      post(promptsPath(id)),
                      save(1, "경합 판단", "", List.of(output("child", BigDecimal.ONE)))),
              () ->
                  concurrent(
                      barrier,
                      put(versionPath(id) + "/tags/child"),
                      Map.of("revision", 1, "name", "경합 태그")));
      var statuses = new ArrayList<Integer>();
      for (var future : pool.invokeAll(tasks)) statuses.add(future.get());
      assertThat(statuses).contains(409);
      assertThat(statuses.stream().filter(value -> value == 200 || value == 201).count())
          .isEqualTo(1);
    }
    var changed = call(get(versionPath(id)), null, 200);
    assertThat(changed.path("revision").asInt()).isEqualTo(2);
    assertThat(structuralSnapshot(changed)).isEqualTo(structuralSnapshot(before));
  }

  @Test
  void limitsStandalonePromptsToHundredAndAllowsEditingDeletionAndReplacementAtCapacity()
      throws Exception {
    var before = catalog();
    String id = before.path("id").asText();
    JsonNode latest = before;
    for (int i = 0; i < 100; i++)
      latest = call(post(promptsPath(id)), save(i + 1, "판단 " + i, "", List.of()), 201);
    assertThat(latest.path("jevPrompts").size()).isEqualTo(100);
    assertThat(latest.path("revision").asInt()).isEqualTo(101);
    assertThat(latest.path("tags")).isEqualTo(before.path("tags"));
    var rejected = call(post(promptsPath(id)), save(101, "한도 초과", "", List.of()), 400);
    assertThat(rejected.path("code").asText()).isEqualTo("INVALID_INPUT");
    assertThat(call(get(versionPath(id)), null, 200)).isEqualTo(latest);
    String promptId = latest.at("/jevPrompts/0/id").asText();
    call(put(promptsPath(id) + "/" + promptId), save(101, "한도에서 수정", "변경", List.of()), 200);
    call(delete(promptsPath(id) + "/" + promptId), Map.of("revision", 102), 200);
    var replacement = call(post(promptsPath(id)), save(103, "교체 판단", "", List.of()), 201);
    assertThat(replacement.path("jevPrompts").size()).isEqualTo(100);
    assertThat(replacement.path("revision").asInt()).isEqualTo(104);
  }

  @Test
  void documentsSeparatePromptAndOutputContracts() throws Exception {
    var api = call(get("/v3/api-docs"), null, 200);
    assertThat(
            api.at("/paths/~1api~1v1~1config-versions~1{versionId}~1jev-prompts/post")
                .isMissingNode())
        .isFalse();
    assertThat(api.at("/components/schemas/ConfigVersion/properties/jevPrompts").isMissingNode())
        .isFalse();
    assertThat(api.at("/components/schemas/JevPrompt/properties/tagIds").isMissingNode()).isFalse();
    assertThat(api.at("/components/schemas/JevPrompt/properties/prompt/maxLength").asInt())
        .isEqualTo(12000);
    assertThat(api.at("/components/schemas/SaveJevPrompt/properties/outputs/maxItems").asInt())
        .isEqualTo(1000);
    assertThat(api.at("/components/schemas/Tag/properties/jevPrompt").isMissingNode()).isTrue();
  }

  private JsonNode catalog() throws Exception {
    var draft = call(post("/api/v1/config-versions"), Map.of("name", "트리"), 201);
    return call(
        put(versionPath(draft.path("id").asText())),
        Map.of(
            "revision",
            0,
            "name",
            "트리",
            "tags",
            List.of(
                Map.of("id", "root", "name", "부모", "order", 10, "pythonRegex", "(?P<unfinished>["),
                Map.of("id", "child", "name", "자식", "parentId", "root", "order", 20),
                Map.of("id", "sibling", "name", "다른 자식", "parentId", "root", "order", 30)),
            "policyStates",
            List.of(Map.of("id", "review", "name", "검토"))),
        200);
  }

  private List<Map<String, JsonNode>> structuralSnapshot(JsonNode version) {
    var result = new ArrayList<Map<String, JsonNode>>();
    for (var tag : version.path("tags"))
      result.add(
          Map.of(
              "id", tag.path("id"), "parentId", tag.path("parentId"), "order", tag.path("order")));
    return result;
  }

  private Map<String, Object> save(long revision, String name, String prompt, Object outputs) {
    var body = new LinkedHashMap<String, Object>();
    body.put("revision", revision);
    body.put("name", name);
    body.put("prompt", prompt);
    body.put("outputs", outputs);
    return body;
  }

  private Map<String, Object> output(String tagId, Object threshold) {
    var value = new LinkedHashMap<String, Object>();
    value.put("tagId", tagId);
    value.put("threshold", threshold);
    return value;
  }

  private Map<String, Object> with(String name, Object value) {
    var override = new LinkedHashMap<String, Object>();
    override.put(name, value);
    return override;
  }

  private String versionPath(String id) {
    return "/api/v1/config-versions/" + id;
  }

  private String promptsPath(String id) {
    return versionPath(id) + "/jev-prompts";
  }

  private JsonNode find(JsonNode items, String id) {
    for (var item : items) if (item.path("id").asText().equals(id)) return item;
    throw new AssertionError("Missing item " + id);
  }

  private int concurrent(CyclicBarrier barrier, MockHttpServletRequestBuilder request, Object body)
      throws Exception {
    request.contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body));
    barrier.await(10, java.util.concurrent.TimeUnit.SECONDS);
    return mvc.perform(request).andReturn().getResponse().getStatus();
  }

  private void raw(MockHttpServletRequestBuilder request, String body, int expectedStatus)
      throws Exception {
    mvc.perform(request.contentType(MediaType.APPLICATION_JSON).content(body))
        .andExpect(status().is(expectedStatus));
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
