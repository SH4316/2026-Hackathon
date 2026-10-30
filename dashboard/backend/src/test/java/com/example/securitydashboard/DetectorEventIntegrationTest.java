package com.example.securitydashboard;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Consumer;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.*;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

@SpringBootTest
@AutoConfigureMockMvc
@EnabledIfEnvironmentVariable(named = "TEST_DB_URL", matches = ".+")
class DetectorEventIntegrationTest {
  private static final String ENDPOINT = "/api/v1/detector-events";
  private static final int MIB = 1024 * 1024;
  private static final byte[] PNG = Base64.getDecoder().decode(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/B0AAAAASUVORK5CYII=");

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper json;
  @Autowired JdbcTemplate jdbc;

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
  void openApiDocumentsScalarInputVersionAndRequiredVersusOptionalNullableFields() throws Exception {
    JsonNode schemas = call(get("/v3/api-docs"), null, 200).path("components").path("schemas");
    JsonNode inputVersion = schemas.at("/InspectResponse/properties/input_version");
    assertThat(inputVersion.has("$ref")).isFalse();
    assertThat(inputVersion.path("oneOf").size()).isEqualTo(2);
    Set<String> inputTypes = new HashSet<>();
    inputVersion.path("oneOf").forEach(option -> {
      assertThat(option.has("$ref")).isFalse();
      inputTypes.add(option.path("type").asText());
    });
    assertThat(inputTypes).containsExactlyInAnyOrder("integer", "string");
    JsonNode destination = schemas.path("Destination");
    assertThat(destination.path("required")).contains(TextNode.valueOf("basis"));
    assertThat(destination.at("/properties/basis/type"))
        .containsExactlyInAnyOrder(TextNode.valueOf("string"), TextNode.valueOf("null"));
    JsonNode finding = schemas.path("Finding");
    assertThat(finding.path("required")).doesNotContain(TextNode.valueOf("replacement"));
    assertThat(finding.at("/properties/replacement/type"))
        .containsExactlyInAnyOrder(TextNode.valueOf("string"), TextNode.valueOf("null"));
  }

  @Test
  void actualProducerResultOriginalImageAndUnicodeFilenamesRoundTripIntoDashboard() throws Exception {
    String version = ready();
    ObjectNode body = request(version);
    body.put("occurred_at", "2026-10-20T01:00:00.123456Z");
    body.put("service", "prompt-guard");
    body.put("model", "local-model-v1");
    body.put("policy_state_id", "review");
    body.putArray("files").addObject().put("name", "연구 자료 😀.pdf");
    addImage(body, "원본 😀.png", PNG);
    JsonNode result = body.path("result").deepCopy();
    JsonNode created = call(post(ENDPOINT), body, 201);
    long id = created.path("id").asLong();
    assertThat(id).isPositive();
    assertThat(created.path("event_id").asText()).matches("d_[0-9a-f]{64}");
    assertThat(created.path("result")).isEqualTo(result);
    assertThat(created.path("text").asText()).isEqualTo(body.path("text").asText());
    assertThat(created.at("/files/0/name").asText()).isEqualTo("연구 자료 😀.pdf");
    assertThat(created.path("service").asText()).isEqualTo("prompt-guard");
    assertThat(created.path("model").asText()).isEqualTo("local-model-v1");
    assertThat(created.path("policy_state_id").asText()).isEqualTo("review");
    assertThat(created.at("/event/id").asLong()).isEqualTo(id);
    assertThat(created.at("/event/eventId").asText()).isEqualTo(created.path("event_id").asText());
    assertThat(created.at("/event/findingCount").asInt()).isEqualTo(2);
    assertThat(created.at("/event/detections/0/start").asInt()).isEqualTo(7);
    assertThat(created.at("/event/detections/0/end").asInt()).isEqualTo(23);
    assertThat(created.at("/event/detections/0/text").asText()).isEqualTo("hong@example.com");
    assertThat(created.at("/event/detections/0/tags/0/id").asText()).isEqualTo("email");
    assertThat(created.at("/event/detections/1/tags")).isEmpty();
    assertThat(call(get(ENDPOINT + "/" + id), null, 200)).isEqualTo(created);
    assertThat(call(post(ENDPOINT), body, 200)).isEqualTo(created);

    JsonNode image = created.path("images").get(0);
    assertThat(image.path("name").asText()).isEqualTo("원본 😀.png");
    assertThat(image.path("media_type").asText()).isEqualTo("image/png");
    assertThat(image.path("size_bytes").asInt()).isEqualTo(PNG.length);
    String download = ENDPOINT + "/" + id + "/images/" + image.path("id").asLong();
    assertThat(image.path("download_path").asText()).isEqualTo(download);
    var downloaded = mvc.perform(get(download))
        .andExpect(status().isOk())
        .andExpect(content().contentType(MediaType.APPLICATION_OCTET_STREAM))
        .andReturn().getResponse();
    assertThat(downloaded.getContentAsByteArray()).containsExactly(PNG);
    assertThat(downloaded.getHeader("Content-Disposition")).startsWith("attachment;");
    mvc.perform(get(ENDPOINT + "/" + (id + 1) + "/images/" + image.path("id").asLong()))
        .andExpect(status().isNotFound());
    JsonNode metrics = metrics();
    assertThat(metrics.at("/summary/eventCount").asInt()).isEqualTo(1);
    assertThat(metrics.at("/summary/findingCount").asInt()).isEqualTo(2);
    assertThat(metrics.at("/unmapped/count").asInt()).isEqualTo(1);
    JsonNode event = call(get("/api/v1/events/" + id), null, 200);
    assertThat(event).isEqualTo(created.path("event"));
  }

  @Test
  void explicitMappingUsesConfiguredTagAndUnknownMappingRollsBackEverything() throws Exception {
    String version = ready();
    ObjectNode invalid = request(version);
    invalid.putObject("tag_map").put("phone", "absent");
    invalid.putArray("files").addObject().put("name", "unchanged.txt");
    addImage(invalid, "original.png", PNG);
    call(post(ENDPOINT), invalid, 422);
    assertEmpty();
    ((ObjectNode) invalid.path("tag_map")).put("phone", "classified");
    JsonNode created = call(post(ENDPOINT), invalid, 201);
    assertThat(created.at("/event/detections/1/tags/0/id").asText()).isEqualTo("classified");
    assertThat(metrics().at("/unmapped/count").asInt()).isZero();
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM detection_tags", Long.class)).isEqualTo(2);
  }

  @Test
  void replaySurvivesActivationButNewEventRequiresCurrentVersionAndRegisteredPerson() throws Exception {
    String version = ready();
    ObjectNode body = request(version);
    JsonNode created = call(post(ENDPOINT), body, 201);
    String next = publishVersion(false);
    call(post("/api/v1/config-versions/" + next + "/activate"), null, 200);
    assertThat(call(post(ENDPOINT), body, 200)).isEqualTo(created);
    requestId(body, "new-stale");
    call(post(ENDPOINT), body, 409);
    body.put("version_id", next);
    body.put("person_id", "missing");
    call(post(ENDPOINT), body, 422);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM security_events", Long.class)).isEqualTo(1);
  }

  @Test
  void identityPreservesArbitrary128CharacterRequestIdsAndTypedInputVersions() throws Exception {
    String version = ready();
    ObjectNode body = request(version);
    String requestId = "한".repeat(126) + "😀/";
    requestId(body, requestId);
    Set<String> ids = new HashSet<>();
    List<JsonNode> versions = List.of(IntNode.valueOf(3), TextNode.valueOf("3"),
        BigIntegerNode.valueOf(new BigInteger("18446744073709551616")),
        BigIntegerNode.valueOf(new BigInteger("123456789012345678901234567890")),
        BigIntegerNode.valueOf(new BigInteger("9".repeat(400))), TextNode.valueOf("v / 한글😀"));
    for (JsonNode inputVersion : versions) {
      result(body).set("input_version", inputVersion);
      JsonNode created = call(post(ENDPOINT), body, 201);
      assertThat(created.at("/result/request_id").asText()).isEqualTo(requestId);
      assertThat(created.at("/result/input_version")).isEqualTo(inputVersion);
      assertThat(call(post(ENDPOINT), body, 200)).isEqualTo(created);
      assertThat(ids.add(created.path("event_id").asText())).isTrue();
    }
    body.put("source_id", "second-source");
    call(post(ENDPOINT), body, 201);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM security_events", Long.class)).isEqualTo(7);
  }

  @Test
  void changedMetadataResultFilenameAndOriginalImageBytesConflictWithoutPartialWrites() throws Exception {
    String version = ready();
    ObjectNode original = request(version);
    original.putArray("files").addObject().put("name", "원본.txt");
    addImage(original, "original.png", PNG);
    JsonNode created = call(post(ENDPOINT), original, 201);
    List<Consumer<ObjectNode>> changes = List.of(
        b -> b.put("model", "changed"), b -> b.put("person_id", "another-person"),
        b -> b.put("service", "changed"), b -> b.put("occurred_at", "2026-10-20T00:00:00Z"),
        b -> result(b).put("policy_version", "changed"),
        b -> ((ObjectNode) b.at("/files/0")).put("name", "바뀜.txt"),
        b -> ((ObjectNode) b.at("/images/0")).put("data_base64", Base64.getEncoder().encodeToString(new byte[] {0, 1, -1})),
        b -> b.putObject("tag_map").put("phone", "classified"));
    for (Consumer<ObjectNode> change : changes) {
      ObjectNode changed = original.deepCopy();
      change.accept(changed);
      call(post(ENDPOINT), changed, 409);
      assertThat(call(get(ENDPOINT + "/" + created.path("id").asLong()), null, 200)).isEqualTo(created);
    }
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM security_events", Long.class)).isEqualTo(1);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM detector_event_images", Long.class)).isEqualTo(1);
  }

  @Test
  void emptyTextNoFindingsAndOptionalNullableProducerFieldsAreAcceptedExactly() throws Exception {
    String version = ready();
    ObjectNode body = request(version);
    body.put("text", "");
    result(body).putArray("findings");
    result(body).put("decision", "allow").put("signal", "green");
    result(body).remove("notices");
    JsonNode created = call(post(ENDPOINT), body, 201);
    assertThat(created.path("result")).isEqualTo(body.path("result"));
    assertThat(created.at("/event/prompt").asText()).isEmpty();
    assertThat(created.at("/event/findingCount").asInt()).isZero();
    assertThat(created.at("/event/detections")).isEmpty();
    requestId(body, "optional-replacement");
    ObjectNode fixture = request(version);
    body.set("text", fixture.path("text"));
    result(body).set("findings", result(fixture).path("findings"));
    ((ObjectNode) body.at("/result/findings/0")).remove("replacement");
    ((ObjectNode) body.at("/result/findings/1")).putNull("replacement");
    assertThat(call(post(ENDPOINT), body, 201).path("result")).isEqualTo(body.path("result"));
  }

  @Test
  void rejectsMissingRequiredNullableBasisInvalidEnumsAndMalformedTypedProducerFields() throws Exception {
    String version = ready();
    List<Consumer<ObjectNode>> changes = List.of(
        b -> ((ObjectNode) b.at("/result/destination")).remove("basis"),
        b -> ((ObjectNode) b.at("/result/destination")).put("verified", "false"),
        b -> result(b).put("status", "unknown"),
        b -> result(b).put("signal", 1),
        b -> result(b).put("input_version", 3.5),
        b -> result(b).put("input_version", true),
        b -> result(b).putNull("request_id"),
        b -> result(b).putNull("notices"),
        b -> result(b).put("unknown", "secret-example"),
        b -> ((ObjectNode) b.at("/result/findings/0")).remove("reason"),
        b -> ((ObjectNode) b.at("/result/findings/0")).put("detector", "remote"),
        b -> ((ObjectNode) b.at("/result/findings/0/span")).put("start", "7"));
    for (Consumer<ObjectNode> change : changes) {
      ObjectNode body = request(version);
      change.accept(body);
      JsonNode error = call(post(ENDPOINT), body, 400);
      assertThat(error.toString()).doesNotContain("secret-example", "hong@example.com", "010-1234-5678");
      assertEmpty();
    }
  }

  @Test
  void rejectsInconsistentCodePointUtf16AndOutOfRangeSpansAtomically() throws Exception {
    String version = ready();
    List<Map<String, Integer>> invalidSpans = List.of(
        Map.of("start", -1), Map.of("end", 1000), Map.of("start", 23),
        Map.of("start_utf16", 7), Map.of("end_utf16", 23),
        Map.of("start", 0, "end", 1, "start_utf16", 0, "end_utf16", 1));
    for (Map<String, Integer> offsets : invalidSpans) {
      ObjectNode body = request(version);
      ObjectNode span = (ObjectNode) body.at("/result/findings/0/span");
      offsets.forEach(span::put);
      body.putArray("files").addObject().put("name", "never-saved.txt");
      addImage(body, "never-saved.png", PNG);
      call(post(ENDPOINT), body, 400);
      assertEmpty();
    }
  }

  @Test
  void databaseFailureDuringImageInsertRollsBackEventDetectionsEnvelopeAndEveryImage() throws Exception {
    String version = ready();
    ObjectNode body = request(version);
    body.putArray("files").addObject().put("name", "atomic.txt");
    addImage(body, "first-image.png", PNG);
    addImage(body, "rollback.png", PNG);
    jdbc.execute("ALTER TABLE detector_event_images ADD CONSTRAINT detector_test_rollback CHECK (name <> 'rollback.png')");
    try {
      call(post(ENDPOINT), body, 500);
      assertEmpty();
    } finally {
      jdbc.execute("ALTER TABLE detector_event_images DROP CHECK detector_test_rollback");
    }
    JsonNode created = call(post(ENDPOINT), body, 201);
    assertThat(created.path("images").size()).isEqualTo(2);
    assertThat(created.at("/event/findingCount").asInt()).isEqualTo(2);
  }

  @Test
  void rejectsMalformedBase64UnsafeNamesAndAttachmentCountLimitsAtomically() throws Exception {
    String version = ready();
    for (String base64 : List.of("not@base64", "AA=A", "A")) {
      ObjectNode body = request(version);
      addImage(body, "test.png", PNG);
      ((ObjectNode) body.at("/images/0")).put("data_base64", base64);
      call(post(ENDPOINT), body, 400);
      assertEmpty();
    }
    for (String name : List.of("../secret.png", "dir/file.png", "dir\\file.png", ".", "..", "bad\nname.png", "x".repeat(256))) {
      ObjectNode body = request(version);
      body.putArray("files").addObject().put("name", name);
      call(post(ENDPOINT), body, 400);
      assertEmpty();
    }
    ObjectNode files = request(version);
    ArrayNode fileList = files.putArray("files");
    for (int i = 0; i < 101; i++) fileList.addObject().put("name", i + ".txt");
    call(post(ENDPOINT), files, 400);
    ObjectNode images = request(version);
    for (int i = 0; i < 21; i++) addImage(images, i + ".png", PNG);
    call(post(ENDPOINT), images, 400);
    assertEmpty();
  }

  @Test
  void acceptsAttachmentCountAndUnicodeNameBoundaries() throws Exception {
    String version = ready();
    ObjectNode body = request(version);
    ArrayNode files = body.putArray("files");
    files.addObject().put("name", "😀".repeat(251) + ".txt");
    for (int i = 1; i < 100; i++) files.addObject().put("name", i + ".txt");
    for (int i = 0; i < 20; i++) addImage(body, i + ".png", PNG);
    JsonNode created = call(post(ENDPOINT), body, 201);
    assertThat(created.path("files").size()).isEqualTo(100);
    assertThat(created.path("images").size()).isEqualTo(20);
    assertThat(created.at("/files/0/name").asText()).isEqualTo("😀".repeat(251) + ".txt");
  }

  @Test
  void allowsFiveMiBImageAndTenMiBTotalButRejectsDecodedSizeExcess() throws Exception {
    String version = ready();
    byte[] data = new byte[5 * MIB];
    new Random(731).nextBytes(data);
    ObjectNode body = request(version);
    addImage(body, "first.png", data);
    addImage(body, "second.png", data);
    JsonNode created = call(post(ENDPOINT), body, 201);
    assertThat(created.at("/images/0/size_bytes").asInt()).isEqualTo(data.length);
    var downloaded = mvc.perform(get(created.at("/images/0/download_path").asText()))
        .andExpect(status().isOk()).andReturn().getResponse();
    assertThat(downloaded.getContentAsByteArray()).containsExactly(data);
    requestId(body, "too-much-total");
    addImage(body, "extra.png", new byte[] {1});
    call(post(ENDPOINT), body, 400);
    ObjectNode oversized = request(version);
    requestId(oversized, "too-much-image");
    addImage(oversized, "large.png", new byte[5 * MIB + 1]);
    call(post(ENDPOINT), oversized, 400);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM security_events", Long.class)).isEqualTo(1);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM detector_event_images", Long.class)).isEqualTo(2);
  }

  @Test
  void sixteenMiBBodyLimitAppliesOnlyToDetectorPostAndAlsoChecksChunkedBodies() throws Exception {
    byte[] oversized = ("{\"text\":\"" + "x".repeat(16 * MIB) + "\"}").getBytes(StandardCharsets.UTF_8);
    mvc.perform(post(ENDPOINT).contentType(MediaType.APPLICATION_JSON).content(oversized))
        .andExpect(status().isPayloadTooLarge());
    mvc.perform(post(ENDPOINT).contentType(MediaType.APPLICATION_JSON).content(oversized).with(request ->
        new org.springframework.mock.web.MockHttpServletRequest() {
          {
            setMethod("POST"); setRequestURI(ENDPOINT); setContentType("application/json"); setContent(oversized);
          }
          @Override public long getContentLengthLong() { return -1; }
        })).andExpect(status().isPayloadTooLarge());
    byte[] oldLimit = ("{\"name\":\"" + "x".repeat(MIB) + "\"}").getBytes(StandardCharsets.UTF_8);
    mvc.perform(post("/api/v1/people").contentType(MediaType.APPLICATION_JSON).content(oldLimit))
        .andExpect(status().isPayloadTooLarge());
    assertEmpty();
  }

  @Test
  void concurrentIdenticalAndConflictingRequestsProduceExactlyOneAtomicRecord() throws Exception {
    String version = ready();
    ObjectNode body = request(version);
    body.putArray("files").addObject().put("name", "concurrent.txt");
    addImage(body, "concurrent.png", PNG);
    String payload = json.writeValueAsString(body);
    List<Integer> results = concurrent(Collections.nCopies(6, payload));
    assertThat(results).containsOnly(200, 201);
    assertThat(results.stream().filter(s -> s == 201).count()).isEqualTo(1);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM detector_events", Long.class)).isEqualTo(1);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM detector_event_images", Long.class)).isEqualTo(1);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM detections", Long.class)).isEqualTo(2);
    requestId(body, "conflicting-race");
    ObjectNode other = body.deepCopy();
    other.put("model", "different-model");
    assertThat(concurrent(List.of(json.writeValueAsString(body), json.writeValueAsString(other))))
        .containsExactlyInAnyOrder(201, 409);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM security_events", Long.class)).isEqualTo(2);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM detector_events", Long.class)).isEqualTo(2);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM detector_event_images", Long.class)).isEqualTo(2);
  }

  private List<Integer> concurrent(List<String> payloads) throws Exception {
    CyclicBarrier barrier = new CyclicBarrier(payloads.size());
    try (var pool = Executors.newFixedThreadPool(payloads.size())) {
      List<Callable<Integer>> calls = new ArrayList<>();
      for (String payload : payloads) calls.add(() -> {
        barrier.await(20, TimeUnit.SECONDS);
        return mvc.perform(post(ENDPOINT).contentType(MediaType.APPLICATION_JSON).content(payload))
            .andReturn().getResponse().getStatus();
      });
      List<Integer> statuses = new ArrayList<>();
      for (var result : pool.invokeAll(calls)) statuses.add(result.get(30, TimeUnit.SECONDS));
      return statuses;
    }
  }

  private void assertEmpty() {
    for (String table : List.of("security_events", "detections", "detection_tags", "detector_events", "detector_event_images"))
      assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM " + table, Long.class)).as(table).isZero();
  }

  private JsonNode metrics() throws Exception {
    return call(get("/api/v1/metrics").param("from", "2026-01-01T00:00:00Z")
        .param("to", "2027-01-01T00:00:00Z"), null, 200);
  }

  private String ready() throws Exception {
    call(post("/api/v1/people"), Map.of("id", "detector-person", "name", "검사 담당자"), 201);
    String version = publishVersion(true);
    call(post("/api/v1/config-versions/" + version + "/activate"), null, 200);
    return version;
  }

  private String publishVersion(boolean configured) throws Exception {
    String id = call(post("/api/v1/config-versions"), Map.of("name", "탐지기 설정"), 201).path("id").asText();
    if (configured) call(put("/api/v1/config-versions/" + id), Map.of(
        "revision", 0, "name", "탐지기 설정",
        "tags", List.of(Map.of("id", "email", "name", "이메일"), Map.of("id", "classified", "name", "분류됨")),
        "policyStates", List.of(Map.of("id", "review", "name", "확인 필요"))), 200);
    call(post("/api/v1/config-versions/" + id + "/publish"), Map.of("revision", configured ? 1 : 0), 200);
    return id;
  }

  /** Executed origin/main e2021df's server Pipeline.inspect with its draft4 policy, no model. */
  private ObjectNode request(String version) throws Exception {
    JsonNode fixture;
    try (var input = getClass().getResourceAsStream("/detector/producer-inspect.json")) {
      fixture = json.readTree(Objects.requireNonNull(input));
    }
    ObjectNode body = json.createObjectNode();
    body.put("source_id", "prompt-guard").put("person_id", "detector-person").put("version_id", version);
    body.set("text", fixture.path("text"));
    body.set("result", fixture.path("result"));
    return body;
  }

  private ObjectNode result(ObjectNode body) { return (ObjectNode) body.path("result"); }
  private void requestId(ObjectNode body, String id) { result(body).put("request_id", id); }

  private void addImage(ObjectNode body, String name, byte[] data) {
    ArrayNode images = body.has("images") ? (ArrayNode) body.path("images") : body.putArray("images");
    images.addObject().put("name", name).put("media_type", "image/png")
        .put("data_base64", Base64.getEncoder().encodeToString(data));
  }

  private JsonNode call(MockHttpServletRequestBuilder request, Object body, int expected) throws Exception {
    if (body != null) request.contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsBytes(body));
    return json.readTree(mvc.perform(request).andExpect(status().is(expected)).andReturn().getResponse().getContentAsString());
  }
}
