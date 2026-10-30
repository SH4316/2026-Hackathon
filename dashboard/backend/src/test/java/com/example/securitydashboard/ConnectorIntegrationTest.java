package com.example.securitydashboard;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.*;
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
class ConnectorIntegrationTest {
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

  // 다른 테스트 클래스는 연결 테이블을 비우지 않으므로 앞뒤로 정리해 무인증 동작을 되돌린다.
  @BeforeEach
  @AfterEach
  void reset() {
    jdbc.update("DELETE FROM person_enrollments");
    jdbc.update("DELETE FROM people WHERE id LIKE 'enroll-test-%'");
    jdbc.update("DELETE FROM detector_connectors");
    jdbc.update(
        "UPDATE detector_settings SET report_text='masked',tag_action='mask',jev_enabled=TRUE,"
            + "tag_map=JSON_OBJECT(),revision=0,updated_at=NULL WHERE id=1");
    jdbc.update("UPDATE active_config SET version_id=NULL");
  }

  private JsonNode call(MockHttpServletRequestBuilder request, Object body, int status) throws Exception {
    if (body != null) request.contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsBytes(body));
    var response = mvc.perform(request).andExpect(status().is(status)).andReturn().getResponse();
    String text = response.getContentAsString(StandardCharsets.UTF_8);
    return text.isEmpty() ? json.nullNode() : json.readTree(text);
  }

  private static String secret(String url) {
    return url.substring(url.indexOf('#') + 1);
  }

  @Test
  void detectorEndpointsStayOpenUntilTheFirstConnectionIsIssued() throws Exception {
    assertThat(call(get("/api/v1/classifier-config"), null, 404).path("code").asText())
        .isEqualTo("NO_ACTIVE_VERSION");
  }

  @Test
  void issuedConnectionUrlAuthenticatesDetectorEndpointsUntilRevoked() throws Exception {
    JsonNode created =
        call(post("/api/v1/connectors"), java.util.Map.of("name", "본사 검사 서버"), 201);
    String id = created.at("/connector/id").asText();
    String url = created.path("connectionUrl").asText();
    assertThat(url).matches("http://localhost/api/v1/connectors/" + id + "#sk_[A-Za-z0-9_-]{43}");
    assertThat(id).matches("c_[A-Za-z0-9_-]{12}");
    String bearer = "Bearer " + secret(url);

    JsonNode list = call(get("/api/v1/connectors"), null, 200);
    assertThat(list.toString()).doesNotContain(secret(url));
    assertThat(list.get(0).path("name").asText()).isEqualTo("본사 검사 서버");
    assertThat(jdbc.queryForObject("SELECT secret_hash FROM detector_connectors", String.class))
        .hasSize(64)
        .doesNotContain(secret(url));

    // 발급 이후: 비밀값 없이는 거부, 비밀값이 있으면 기존 응답(활성 버전 없음 404)
    assertThat(call(get("/api/v1/classifier-config"), null, 401).path("code").asText())
        .isEqualTo("CONNECTOR_AUTH_REQUIRED");
    call(get("/api/v1/classifier-config").header("Authorization", "Bearer sk_wrong"), null, 401);
    call(get("/api/v1/classifier-config").header("Authorization", bearer), null, 404);
    call(post("/api/v1/detector-events"), java.util.Map.of(), 401);
    // 연결 확인은 그 연결의 비밀값만 통과
    assertThat(call(get(url.substring("http://localhost".length(), url.indexOf('#')))
            .header("Authorization", bearer), null, 200).path("connected").asBoolean())
        .isTrue();
    JsonNode other = call(post("/api/v1/connectors"), java.util.Map.of("name", "지사"), 201);
    call(get("/api/v1/connectors/" + other.at("/connector/id").asText()).header("Authorization", bearer), null, 401);
    assertThat(jdbc.queryForObject(
            "SELECT last_used_at IS NOT NULL FROM detector_connectors WHERE id=?", Boolean.class, id))
        .isTrue();
    // 대시보드 화면이 쓰는 API는 그대로 무인증
    call(get("/api/v1/config-versions"), null, 200);
    call(get("/api/v1/detector-settings"), null, 200);

    call(delete("/api/v1/connectors/" + id), null, 204);
    call(delete("/api/v1/connectors/" + id), null, 404);
    call(get("/api/v1/classifier-config").header("Authorization", bearer), null, 401);
    assertThat(call(get("/api/v1/connectors"), null, 200).get(1).path("revokedAt").isNull()).isFalse();
  }

  @Test
  void connectionUrlCanUseTheAddressTheServerReaches() throws Exception {
    JsonNode created = call(post("/api/v1/connectors"),
        java.util.Map.of("name", "컨테이너", "dashboardUrl", "http://host.docker.internal:8080/"), 201);
    assertThat(created.path("connectionUrl").asText())
        .startsWith("http://host.docker.internal:8080/api/v1/connectors/c_");
    for (String bad : new String[] {"ftp://x", "http://user:pw@x", "http://x?a=1", "not a url"}) {
      assertThat(call(post("/api/v1/connectors"), java.util.Map.of("name", "x", "dashboardUrl", bad), 400)
              .at("/fieldErrors/dashboardUrl").isMissingNode())
          .as(bad).isFalse();
    }
    call(post("/api/v1/connectors"), java.util.Map.of("name", ""), 400);
  }

  @Test
  void detectorSettingsAreRevisionedAndValidated() throws Exception {
    JsonNode initial = call(get("/api/v1/detector-settings"), null, 200);
    assertThat(initial.path("reportText").asText()).isEqualTo("masked");
    assertThat(initial.path("tagAction").asText()).isEqualTo("mask");
    assertThat(initial.path("jevEnabled").asBoolean()).isTrue();
    assertThat(initial.path("revision").asInt()).isZero();

    var body = new java.util.LinkedHashMap<String, Object>();
    body.put("revision", 0);
    body.put("reportText", "full");
    body.put("tagAction", "warn");
    body.put("jevEnabled", false);
    body.put("tagMap", java.util.Map.of("email", "pii-3", "aws_access_key_id", "security-1"));
    JsonNode saved = call(put("/api/v1/detector-settings"), body, 200);
    assertThat(saved.path("revision").asInt()).isEqualTo(1);
    assertThat(saved.at("/tagMap/email").asText()).isEqualTo("pii-3");
    assertThat(saved.path("updatedAt").isNull()).isFalse();
    assertThat(call(put("/api/v1/detector-settings"), body, 409).path("code").asText())
        .isEqualTo("REVISION_CONFLICT");

    body.put("revision", 1);
    body.put("reportText", "everything");
    call(put("/api/v1/detector-settings"), body, 400);
    body.put("reportText", "off");
    body.put("tagMap", java.util.Map.of("email", "bad id!"));
    call(put("/api/v1/detector-settings"), body, 400);
  }

  @Test
  void personEnrollmentCodesAreIssuedHereAndRedeemedOnceByAConnectedServer() throws Exception {
    jdbc.update("INSERT INTO people(id,name) VALUES('enroll-test-1','홍길동')");
    call(post("/api/v1/people/nobody-here/enrollments"), null, 404);
    call(post("/api/v1/people/enroll-test-1/enrollments"), java.util.Map.of("ttlMinutes", 1), 400);

    // 검사 서버 주소가 등록된 연결이 없으면 코드만
    JsonNode bare = call(post("/api/v1/people/enroll-test-1/enrollments"), null, 201);
    assertThat(bare.path("code").asText()).matches("[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}");
    assertThat(bare.path("connectionInfo").isNull()).isTrue();

    JsonNode created = call(post("/api/v1/connectors"),
        java.util.Map.of("name", "본사", "serverUrl", "https://guard.example.org/"), 201);
    assertThat(created.at("/connector/serverUrl").asText()).isEqualTo("https://guard.example.org");
    String bearer = "Bearer " + secret(created.path("connectionUrl").asText());
    JsonNode issued = call(post("/api/v1/people/enroll-test-1/enrollments"), null, 201);
    String code = issued.path("code").asText();
    assertThat(issued.path("connectionInfo").asText()).isEqualTo("https://guard.example.org#" + code);
    assertThat(issued.path("personId").asText()).isEqualTo("enroll-test-1");
    assertThat(jdbc.queryForList("SELECT code_hash FROM person_enrollments", String.class))
        .noneMatch(h -> h.contains(code.replace("-", "")));

    // 연결 인증이 없으면 거부, 있으면 한 번만 사용(대소문자·구분자 무관)
    call(post("/api/v1/enrollments/redeem"), java.util.Map.of("code", code), 401);
    JsonNode redeemed = call(post("/api/v1/enrollments/redeem").header("Authorization", bearer),
        java.util.Map.of("code", code.toLowerCase().replace("-", " ")), 200);
    assertThat(redeemed.path("personId").asText()).isEqualTo("enroll-test-1");
    assertThat(redeemed.path("name").asText()).isEqualTo("홍길동");
    assertThat(call(post("/api/v1/enrollments/redeem").header("Authorization", bearer),
            java.util.Map.of("code", code), 404).path("code").asText())
        .isEqualTo("ENROLLMENT_INVALID");
    assertThat(jdbc.queryForObject("SELECT used_by FROM person_enrollments WHERE used_at IS NOT NULL", String.class))
        .isEqualTo(created.at("/connector/id").asText());

    // 만료된 코드
    String expired = bare.path("code").asText();
    jdbc.update("UPDATE person_enrollments SET expires_at='2000-01-01' WHERE used_at IS NULL");
    call(post("/api/v1/enrollments/redeem").header("Authorization", bearer),
        java.util.Map.of("code", expired), 404);
    call(post("/api/v1/connectors"), java.util.Map.of("name", "x", "serverUrl", "ftp://x"), 400);
  }
}
