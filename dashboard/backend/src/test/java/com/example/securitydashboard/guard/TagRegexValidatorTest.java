package com.example.securitydashboard.guard;

import static org.assertj.core.api.Assertions.*;

import com.example.securitydashboard.common.ApiException;
import com.example.securitydashboard.configuration.model.Tag;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import java.util.stream.IntStream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.web.client.RestClient;

class TagRegexValidatorTest {
  private final ObjectMapper json = new ObjectMapper();
  private final AtomicReference<JsonNode> received = new AtomicReference<>();
  private final AtomicReference<String> method = new AtomicReference<>();
  private final AtomicReference<String> key = new AtomicReference<>();
  private HttpServer server;
  private String base;
  private String reply = "{\"results\":[{\"tag_id\":\"changed\",\"ok\":true,\"reason\":null}]}";
  private int status = 200;

  @BeforeEach
  void start() throws Exception {
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/v1/admin/org/regex/check", exchange -> {
      received.set(json.readTree(exchange.getRequestBody()));
      method.set(exchange.getRequestMethod());
      key.set(exchange.getRequestHeaders().getFirst("X-Admin-Key"));
      byte[] response = reply.getBytes(StandardCharsets.UTF_8);
      exchange.getResponseHeaders().set("Content-Type", "application/json");
      exchange.sendResponseHeaders(status, response.length);
      exchange.getResponseBody().write(response);
      exchange.close();
    });
    server.start();
    base = "http://127.0.0.1:" + server.getAddress().getPort();
  }

  @AfterEach
  void stop() {
    server.stop(0);
  }

  private TagRegexValidator validator(String url, String adminKey) {
    return new TagRegexValidator(new GuardProxyService(RestClient.builder(), url, adminKey), json);
  }

  private TagRegexValidator validator() {
    return validator(base, "synthetic-key");
  }

  private Tag tag(String id, String pattern) {
    return new Tag(id, id, "", List.of(), "", null, pattern, "#123456", null, 0, true);
  }

  @Test
  void checksOnlyChangedNonemptyPatternsAndPreservesPythonSource() {
    String pattern = "(?im)^(?P<label>내부😀)\\w+$\n  ";
    validator().validateChanged(
        List.of(tag("changed", pattern), tag("old", "["), tag("cleared", ""), tag("new_empty", "")),
        List.of(tag("changed", "before"), tag("old", "["), tag("cleared", "old")));
    assertThat(method.get()).isEqualTo("POST");
    assertThat(key.get()).isEqualTo("synthetic-key");
    assertThat(received.get()).isEqualTo(json.valueToTree(
        Map.of("patterns", List.of(Map.of("tag_id", "changed", "pattern", pattern)))));
  }

  @Test
  void skipsUnchangedAndEmptyRulesEvenWhenKeyIsMissing() {
    validator(base, "").validateChanged(
        List.of(tag("old", "["), tag("empty", "")), List.of(tag("old", "[")));
    assertThat(received.get()).isNull();
  }

  @Test
  void skipsRemoteValidationOnlyWhenServerUrlIsUnset() {
    validator("", "").validateChanged(List.of(tag("changed", "[")), List.of());
    assertThat(received.get()).isNull();
    assertUnavailable(validator(base, ""));
    server.stop(0);
    assertUnavailable(validator());
  }

  @ParameterizedTest
  @CsvSource({
    "too_long, '정규식은 최대 4,000자입니다.'",
    "nested_quantifier, '중첩된 반복 수량자는 사용할 수 없습니다.'",
    "syntax_error, 'Python 정규식 문법이 올바르지 않습니다.'",
    "matches_empty, '빈 문자열과 일치하는 정규식은 사용할 수 없습니다.'"
  })
  void translatesServerRejectionsIntoTagSpecificFieldErrors(String reason, String message) {
    reply = "{\"results\":[{\"tag_id\":\"changed\",\"ok\":false,\"reason\":\"" + reason + "\"}]}";
    assertThatThrownBy(() -> validator().validateChanged(List.of(tag("changed", "pattern")), List.of()))
        .isInstanceOfSatisfying(ApiException.class, error -> {
          assertThat(error.status().value()).isEqualTo(400);
          assertThat(error.code()).isEqualTo("INVALID_INPUT");
          assertThat(error.fields()).containsExactly(Map.entry("tags.changed.pythonRegex", message));
        });
  }

  @Test
  void returnsAllRejectedTagFieldsWithoutRelyingOnResultOrder() {
    reply = "{\"results\":[{\"tag_id\":\"b\",\"ok\":false,\"reason\":\"matches_empty\"},"
        + "{\"tag_id\":\"a\",\"ok\":false,\"reason\":\"syntax_error\"}]}";
    assertThatThrownBy(() -> validator().validateChanged(
        List.of(tag("a", "["), tag("b", "x*")), List.of()))
        .isInstanceOfSatisfying(ApiException.class, error ->
            assertThat(error.fields()).containsOnlyKeys("tags.a.pythonRegex", "tags.b.pythonRegex"));
  }

  @Test
  void validatesMaximumCatalogInOneRequest() throws Exception {
    var tags = IntStream.range(0, 1000).mapToObj(i -> tag("tag_" + i, "pattern")).toList();
    reply = json.writeValueAsString(Map.of("results", tags.stream()
        .map(tag -> Map.of("tag_id", tag.id(), "ok", true))
        .map(result -> {
          var node = json.valueToTree(result);
          ((com.fasterxml.jackson.databind.node.ObjectNode) node).putNull("reason");
          return node;
        }).toList()));
    validator().validateChanged(tags, List.of());
    assertThat(received.get().path("patterns")).hasSize(1000);
  }

  @ParameterizedTest
  @ValueSource(strings = {"not-json", "null", "{}", "{\"results\":[]}",
    "{\"results\":[{\"tag_id\":\"other\",\"ok\":true,\"reason\":null}]}",
    "{\"results\":[{\"tag_id\":\"changed\",\"ok\":\"true\",\"reason\":null}]}",
    "{\"results\":[{\"tag_id\":\"changed\",\"ok\":true}]}",
    "{\"results\":[{\"tag_id\":\"changed\",\"ok\":false,\"reason\":\"unknown\"}]}"})
  void rejectsIncompleteOrMalformedValidationResponses(String body) {
    reply = body;
    assertUnavailable(validator());
  }

  @ParameterizedTest
  @ValueSource(ints = {307, 400, 401, 403, 404, 500, 503})
  void rejectsUnavailableValidationServiceWithoutExposingUpstreamBody(int code) {
    status = code;
    reply = "synthetic-key";
    assertUnavailable(validator());
  }

  private void assertUnavailable(TagRegexValidator validator) {
    assertThatThrownBy(() -> validator.validateChanged(List.of(tag("changed", "[")), List.of()))
        .isInstanceOfSatisfying(ApiException.class, error -> {
          assertThat(error.status().value()).isEqualTo(503);
          assertThat(error.code()).isEqualTo("GUARD_UNAVAILABLE");
          assertThat(error.getMessage()).doesNotContain("synthetic-key");
        });
  }
}
