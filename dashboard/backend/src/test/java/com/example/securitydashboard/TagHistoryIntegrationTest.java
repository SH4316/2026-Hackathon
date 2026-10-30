package com.example.securitydashboard;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.doAnswer;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.example.securitydashboard.configuration.ConfigurationService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
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
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.DefaultTransactionDefinition;

@SpringBootTest
@AutoConfigureMockMvc
@EnabledIfEnvironmentVariable(named = "TEST_DB_URL", matches = ".+")
class TagHistoryIntegrationTest {
  private static final String FROM = "2026-10-20T00:00:00Z";
  private static final String TO = "2026-10-22T00:00:00Z";

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper json;
  @Autowired JdbcTemplate jdbc;
  @Autowired PlatformTransactionManager transactions;
  @MockitoSpyBean ConfigurationService configs;

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    String url = System.getenv("TEST_DB_URL");
    if (url == null || !url.matches("jdbc:mysql://[^/]+/[A-Za-z0-9_]+_test(?:\\?.*)?"))
      throw new IllegalStateException("TEST_DB_URL must point to a separate MySQL schema ending in _test");
    registry.add("spring.datasource.url", () -> url);
    registry.add("spring.datasource.username", () -> System.getenv().getOrDefault("TEST_DB_USERNAME", "dashboard"));
    registry.add("spring.datasource.password", () -> System.getenv().getOrDefault("TEST_DB_PASSWORD", "dashboard-local"));
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
  void metadataEditsPreserveEventsDetectorReplaysAndSavedSearchesButRefreshMetricCaptions()
      throws Exception {
    String version = ready();
    var legacyRequest = event(version, "before");
    var legacy = call(post("/api/v1/events"), legacyRequest, 201);
    var detectorRequest = detector(version);
    var detector = call(post("/api/v1/detector-events"), detectorRequest, 201);
    var saved =
        call(
            post("/api/v1/saved-searches"),
            Map.of("name", "원래 표시 저장", "filters", Map.of("from", FROM, "to", TO, "tagId", "root")),
            201);
    assertThat(saved.path("eventCount").asInt()).isEqualTo(2);
    var beforeMetrics = call(range(get("/api/v1/metrics")), null, 200);
    var closure = jdbc.queryForList("SELECT * FROM config_tag_closure ORDER BY 1,2,3");

    edit(version, "새 이메일 😀", "#ABCDEF");

    assertThat(call(get("/api/v1/events/" + legacy.path("id").asLong()), null, 200)).isEqualTo(legacy);
    assertThat(call(post("/api/v1/events"), legacyRequest, 200)).isEqualTo(legacy);
    assertThat(call(get("/api/v1/detector-events/" + detector.path("id").asLong()), null, 200))
        .isEqualTo(detector);
    assertThat(call(post("/api/v1/detector-events"), detectorRequest, 200)).isEqualTo(detector);
    var stored = call(get("/api/v1/saved-searches/" + saved.path("id").asText() + "/events"), null, 200);
    assertThat(stored.path("totalElements").asInt()).isEqualTo(2);
    for (var item : stored.path("items")) assertCapturedTag(item, "원래 이메일", "#123456");
    var afterMetrics = call(range(get("/api/v1/metrics")), null, 200);
    assertThat(afterMetrics.path("summary")).isEqualTo(beforeMetrics.path("summary"));
    var beforeTag = findTag(beforeMetrics, "email");
    var afterTag = findTag(afterMetrics, "email");
    assertThat(afterTag.path("count")).isEqualTo(beforeTag.path("count"));
    assertThat(afterTag.path("eventCount")).isEqualTo(beforeTag.path("eventCount"));
    assertThat(afterTag.path("name").asText()).isEqualTo("새 이메일 😀");
    assertThat(afterTag.path("color").asText()).isEqualTo("#ABCDEF");
    assertThat(jdbc.queryForList("SELECT * FROM config_tag_closure ORDER BY 1,2,3")).isEqualTo(closure);

    var newEvent = call(post("/api/v1/events"), event(version, "after"), 201);
    assertCapturedTag(newEvent, "새 이메일 😀", "#ABCDEF");
    ((ObjectNode) detectorRequest.path("result")).put("request_id", "after-edit");
    var newDetector = call(post("/api/v1/detector-events"), detectorRequest, 201);
    assertCapturedTag(newDetector.path("event"), "새 이메일 😀", "#ABCDEF");
    var savedAgain = call(get("/api/v1/saved-searches/" + saved.path("id").asText() + "/events"), null, 200);
    assertThat(savedAgain).isEqualTo(stored);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM detector_events", Long.class)).isEqualTo(2);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM detector_event_images", Long.class)).isEqualTo(2);
  }

  @Test
  void ingestionWaitingForMetadataCommitCapturesTheNewNameAndColorTogether() throws Exception {
    String version = ready();
    var attempted = new CountDownLatch(1);
    var executor = Executors.newSingleThreadExecutor();
    var editing = transactions.getTransaction(new DefaultTransactionDefinition());
    try {
      jdbc.queryForObject("SELECT version_id FROM active_config WHERE singleton_id=1 FOR UPDATE", String.class);
      edit(version, "커밋된 이름", "#FEDCBA");
      doAnswer(
              invocation -> {
                attempted.countDown();
                return invocation.callRealMethod();
              })
          .when(configs)
          .lockActiveId();
      var waiting = executor.submit(() -> call(post("/api/v1/events"), event(version, "waiting"), 201));
      assertThat(attempted.await(10, TimeUnit.SECONDS)).isTrue();
      assertThat(waiting.isDone()).isFalse();
      transactions.commit(editing);
      var created = waiting.get(10, TimeUnit.SECONDS);
      assertCapturedTag(created, "커밋된 이름", "#FEDCBA");
      assertThat(
              jdbc.queryForMap(
                  "SELECT captured_name,captured_color FROM detection_tags dt JOIN detections d"
                      + " ON d.id=dt.detection_id WHERE d.event_id=?",
                  created.path("id").asLong()))
          .containsEntry("captured_name", "커밋된 이름")
          .containsEntry("captured_color", "#FEDCBA");
    } finally {
      if (!editing.isCompleted()) transactions.rollback(editing);
      executor.shutdownNow();
    }
  }

  private String ready() throws Exception {
    call(post("/api/v1/people"), Map.of("id", "history-person", "name", "담당자"), 201);
    String version = call(post("/api/v1/config-versions"), Map.of("name", "이력 설정"), 201).path("id").asText();
    call(
        put("/api/v1/config-versions/" + version),
        Map.of(
            "revision", 0, "name", "이력 설정",
            "tags", List.of(
                Map.of("id", "root", "name", "부모"),
                Map.of("id", "email", "name", "원래 이메일", "color", "#123456", "parentId", "root")),
            "policyStates", List.of()),
        200);
    call(post("/api/v1/config-versions/" + version + "/publish"), Map.of("revision", 1), 200);
    call(post("/api/v1/config-versions/" + version + "/activate"), null, 200);
    return version;
  }

  private void edit(String version, String name, String color) throws Exception {
    long revision = call(get("/api/v1/config-versions/" + version), null, 200).path("revision").asLong();
    call(
        put("/api/v1/config-versions/" + version + "/tags/email"),
        Map.of("revision", revision, "name", name, "color", color),
        200);
  }

  private Map<String, Object> event(String version, String eventId) {
    return Map.of(
        "sourceId", "history", "eventId", eventId, "personId", "history-person", "versionId", version,
        "prompt", "user@example.com", "occurredAt", "2026-10-20T01:00:00Z",
        "detections", List.of(Map.of("start", 0, "end", 16, "text", "user@example.com", "tagIds", List.of("email"))));
  }

  private ObjectNode detector(String version) throws Exception {
    JsonNode fixture;
    try (var input = getClass().getResourceAsStream("/detector/producer-inspect.json")) {
      fixture = json.readTree(Objects.requireNonNull(input));
    }
    var body = json.createObjectNode();
    body.put("source_id", "history-detector").put("person_id", "history-person").put("version_id", version);
    body.put("occurred_at", "2026-10-20T02:00:00Z");
    body.set("text", fixture.path("text"));
    body.set("result", fixture.path("result"));
    body.putArray("images").addObject().put("name", "원본.png").put("media_type", "image/png")
        .put("data_base64", "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/B0AAAAASUVORK5CYII=");
    return body;
  }

  private void assertCapturedTag(JsonNode event, String name, String color) {
    var tag = event.at("/detections/0/tags/0");
    assertThat(tag.path("id").asText()).isEqualTo("email");
    assertThat(tag.path("name").asText()).isEqualTo(name);
    assertThat(tag.path("color").asText()).isEqualTo(color);
  }

  private JsonNode findTag(JsonNode metrics, String id) {
    for (var tag : metrics.path("tags")) if (id.equals(tag.path("id").asText())) return tag;
    throw new AssertionError("Missing metric tag: " + id);
  }

  private MockHttpServletRequestBuilder range(MockHttpServletRequestBuilder request) {
    return request.param("from", FROM).param("to", TO);
  }

  private JsonNode call(MockHttpServletRequestBuilder request, Object body, int expected) throws Exception {
    if (body != null) request.contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsBytes(body));
    return json.readTree(mvc.perform(request).andExpect(status().is(expected)).andReturn().getResponse().getContentAsString());
  }
}
