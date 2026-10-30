package com.example.securitydashboard;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
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
class DetectionEnabledIntegrationTest {
  @Autowired MockMvc mvc;
  @Autowired ObjectMapper json;
  @Autowired JdbcTemplate jdbc;

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    String url = System.getenv("TEST_DB_URL");
    if (url == null || !url.matches("jdbc:mysql://[^/]+/[A-Za-z0-9_]+_test(?:\\?.*)?"))
      throw new IllegalStateException("TEST_DB_URL must point to a separate schema ending in _test");
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
  void newTagsAndPromptsDefaultToEnabledAndExplicitFalseIsIndependentOfParent()
      throws Exception {
    var version = catalog();
    String id = version.path("id").asText();
    assertEnabled(version, "tags", "root", true);
    assertEnabled(version, "tags", "child", true);

    var tags = (ArrayNode) version.path("tags").deepCopy();
    ((ObjectNode) find(tags, "root")).put("enabled", false);
    ((ObjectNode) find(tags, "child")).putNull("enabled");
    tags.addObject().put("id", "disabled").put("name", "비활성 새 태그").put("enabled", false);
    var saved = replace(version, tags);
    assertEnabled(saved, "tags", "root", false);
    assertEnabled(saved, "tags", "child", true);
    assertEnabled(saved, "tags", "disabled", false);

    var omitted = call(post(promptsPath(id)), prompt(saved, "기본 판단"), 201);
    assertThat(omitted.at("/jevPrompts/0/enabled").isBoolean()).isTrue();
    assertThat(omitted.at("/jevPrompts/0/enabled").asBoolean()).isTrue();
    var nullable = prompt(omitted, "null 판단");
    nullable.put("enabled", null);
    var withNull = call(post(promptsPath(id)), nullable, 201);
    assertThat(withNull.at("/jevPrompts/1/enabled").asBoolean()).isTrue();
    var disabled = prompt(withNull, "비활성 판단");
    disabled.put("enabled", false);
    var withFalse = call(post(promptsPath(id)), disabled, 201);
    assertThat(withFalse.at("/jevPrompts/2/enabled").asBoolean()).isFalse();
    assertThat(call(get(versionPath(id)), null, 200)).isEqualTo(withFalse);
  }

  @Test
  void detailAndFullDraftSavesPreserveDisabledTagsWhenEnabledIsOmittedOrNull()
      throws Exception {
    var version = catalog();
    String id = version.path("id").asText();
    var disable = tagDetails(version, "부모");
    disable.put("enabled", false);
    version = call(put(versionPath(id) + "/tags/root"), disable, 200);
    assertEnabled(version, "tags", "root", false);
    assertEnabled(version, "tags", "child", true);

    for (boolean explicitNull : List.of(false, true)) {
      var details = tagDetails(version, "부모 상세 수정");
      if (explicitNull) details.put("enabled", null);
      version = call(put(versionPath(id) + "/tags/root"), details, 200);
      assertEnabled(version, "tags", "root", false);
      var tags = (ArrayNode) version.path("tags").deepCopy();
      var root = (ObjectNode) find(tags, "root");
      if (explicitNull) root.putNull("enabled");
      else root.remove("enabled");
      tags.addObject().put("id", "new-" + explicitNull).put("name", "새 태그");
      if (explicitNull) ((ObjectNode) tags.get(tags.size() - 1)).putNull("enabled");
      version = replace(version, tags);
      assertEnabled(version, "tags", "root", false);
      assertEnabled(version, "tags", "child", true);
      assertEnabled(version, "tags", "new-" + explicitNull, true);
    }
    assertThat(call(put(versionPath(id) + "/tags/root"), disable, 409).path("code").asText())
        .isEqualTo("REVISION_CONFLICT");
    var stale = replacement(version, version.path("tags"));
    stale.put("revision", 1);
    assertThat(call(put(versionPath(id)), stale, 409).path("code").asText())
        .isEqualTo("REVISION_CONFLICT");
    assertThat(call(get(versionPath(id)), null, 200)).isEqualTo(version);
  }

  @Test
  void promptUpdatesPreserveFalseWhenEnabledIsOmittedOrNullAndShareRevisionConflicts()
      throws Exception {
    var version = catalog();
    String id = version.path("id").asText();
    var disabled = prompt(version, "비활성 판단");
    disabled.put("enabled", false);
    version = call(post(promptsPath(id)), disabled, 201);
    String promptId = version.at("/jevPrompts/0/id").asText();
    for (boolean explicitNull : List.of(false, true)) {
      var update = prompt(version, "수정된 비활성 판단");
      if (explicitNull) update.put("enabled", null);
      version = call(put(promptsPath(id) + "/" + promptId), update, 200);
      assertEnabled(version, "jevPrompts", promptId, false);
    }
    assertThat(
            call(put(promptsPath(id) + "/" + promptId), disabled, 409).path("code").asText())
        .isEqualTo("REVISION_CONFLICT");
    assertThat(call(get(versionPath(id)), null, 200)).isEqualTo(version);
  }

  @Test
  void publishedTogglesRetainFullClassifierDataAndOnlyChangeSelectedVersionIncludingClones()
      throws Exception {
    var version = catalog();
    String id = version.path("id").asText();
    var createPrompt = prompt(version, "연결된 판단");
    String raw = "  판단 원문 😀\r\n\t보존\n ";
    createPrompt.put("prompt", raw);
    createPrompt.put(
        "outputs", List.of(Map.of("tagId", "root", "threshold", new BigDecimal("0.123456"))));
    version = call(post(promptsPath(id)), createPrompt, 201);
    String promptId = version.at("/jevPrompts/0/id").asText();
    version =
        call(post(versionPath(id) + "/publish"), Map.of("revision", revision(version)), 200);
    version = call(post(versionPath(id) + "/activate"), null, 200);
    var original = version.deepCopy();
    var other = cloneVersion(id, "변경 전 복제");
    var closure = jdbc.queryForList("SELECT * FROM config_tag_closure WHERE version_id=?", id);

    var details = tagDetails(version, "부모");
    details.put("enabled", false);
    version = call(put(versionPath(id) + "/tags/root"), details, 200);
    var disablePrompt = prompt(version, "연결된 판단");
    disablePrompt.put("prompt", raw);
    disablePrompt.put("outputs", createPrompt.get("outputs"));
    disablePrompt.put("enabled", false);
    version = call(put(promptsPath(id) + "/" + promptId), disablePrompt, 200);

    assertThat(version.path("status").asText()).isEqualTo("PUBLISHED");
    assertThat(version.path("isActive").asBoolean()).isTrue();
    assertEnabled(version, "tags", "root", false);
    assertEnabled(version, "tags", "child", true);
    assertEnabled(version, "jevPrompts", promptId, false);
    assertThat(find(version.path("tags"), "root").path("pythonRegex"))
        .isEqualTo(find(original.path("tags"), "root").path("pythonRegex"));
    assertThat(find(version.path("tags"), "root").path("jevThreshold").decimalValue())
        .isEqualByComparingTo("0.123456");
    assertThat(version.at("/jevPrompts/0/prompt").asText()).isEqualTo(raw);
    assertThat(version.at("/jevPrompts/0/tagIds")).containsExactly(json.valueToTree("root"));
    assertThat(call(get("/api/v1/classifier-config"), null, 200)).isEqualTo(version);
    assertThat(call(get(versionPath(other.path("id").asText())), null, 200)).isEqualTo(other);
    assertThat(jdbc.queryForList("SELECT * FROM config_tag_closure WHERE version_id=?", id))
        .isEqualTo(closure);
    var disabledClone = cloneVersion(id, "비활성 상태 복제");
    assertThat(disabledClone.path("tags")).isEqualTo(version.path("tags"));
    assertThat(disabledClone.path("jevPrompts")).isEqualTo(version.path("jevPrompts"));

    details = tagDetails(version, "부모");
    details.put("enabled", true);
    version = call(put(versionPath(id) + "/tags/root"), details, 200);
    var enablePrompt = prompt(version, "연결된 판단");
    enablePrompt.put("prompt", raw);
    enablePrompt.put("outputs", createPrompt.get("outputs"));
    enablePrompt.put("enabled", true);
    version = call(put(promptsPath(id) + "/" + promptId), enablePrompt, 200);
    assertThat(version.path("tags")).isEqualTo(original.path("tags"));
    assertThat(version.path("jevPrompts")).isEqualTo(original.path("jevPrompts"));
    assertThat(call(get(versionPath(disabledClone.path("id").asText())), null, 200))
        .isEqualTo(disabledClone);
  }

  @Test
  void enabledRejectsNonBooleanValuesWithoutMutationAcrossAllWriteContracts() throws Exception {
    var version = catalog();
    String id = version.path("id").asText();
    version = call(post(promptsPath(id)), prompt(version, "기존 판단"), 201);
    String promptId = version.at("/jevPrompts/0/id").asText();
    for (Object invalid : List.of("false", "", 0, 1, List.of(), Map.of())) {
      var details = tagDetails(version, "부모");
      details.put("enabled", invalid);
      call(put(versionPath(id) + "/tags/root"), details, 400);
      var prompt = prompt(version, "잘못된 상태");
      prompt.put("enabled", invalid);
      call(post(promptsPath(id)), prompt, 400);
      call(put(promptsPath(id) + "/" + promptId), prompt, 400);
      var tags = (ArrayNode) version.path("tags").deepCopy();
      ((ObjectNode) find(tags, "root")).set("enabled", json.valueToTree(invalid));
      call(put(versionPath(id)), replacement(version, tags), 400);
    }
    assertThat(call(get(versionPath(id)), null, 200)).isEqualTo(version);
  }

  private JsonNode catalog() throws Exception {
    var draft = call(post("/api/v1/config-versions"), Map.of("name", "탐지 활성 설정"), 201);
    return call(
        put(versionPath(draft.path("id").asText())),
        Map.of(
            "revision", 0,
            "name", "탐지 활성 설정",
            "tags", List.of(
                Map.of("id", "root", "name", "부모", "pythonRegex", "(?im)raw[\\r\\n "),
                Map.of("id", "child", "name", "자식", "parentId", "root")),
            "policyStates", List.of(Map.of("id", "review", "name", "검토"))),
        200);
  }

  private Map<String, Object> tagDetails(JsonNode version, String name) {
    var body = new LinkedHashMap<String, Object>();
    var root = find(version.path("tags"), "root");
    for (String field :
        List.of("description", "examples", "guidance", "jevThreshold", "pythonRegex", "color"))
      body.put(field, root.path(field));
    body.put("revision", revision(version));
    body.put("name", name);
    return body;
  }

  private Map<String, Object> prompt(JsonNode version, String name) {
    var body = new LinkedHashMap<String, Object>();
    body.put("revision", revision(version));
    body.put("name", name);
    body.put("prompt", "판단 원문");
    body.put("outputs", List.of());
    return body;
  }

  private JsonNode replace(JsonNode version, JsonNode tags) throws Exception {
    return call(put(versionPath(version.path("id").asText())), replacement(version, tags), 200);
  }

  private Map<String, Object> replacement(JsonNode version, JsonNode tags) {
    var body = new LinkedHashMap<String, Object>();
    body.put("revision", revision(version));
    body.put("name", version.path("name"));
    body.put("tags", tags);
    body.put("policyStates", version.path("policyStates"));
    return body;
  }

  private JsonNode cloneVersion(String source, String name) throws Exception {
    return call(
        post("/api/v1/config-versions"), Map.of("name", name, "baseVersionId", source), 201);
  }

  private long revision(JsonNode version) {
    return version.path("revision").asLong();
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

  private void assertEnabled(JsonNode version, String collection, String id, boolean enabled) {
    var value = find(version.path(collection), id).path("enabled");
    assertThat(value.isBoolean()).as(collection + "/" + id + "/enabled").isTrue();
    assertThat(value.asBoolean()).isEqualTo(enabled);
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
