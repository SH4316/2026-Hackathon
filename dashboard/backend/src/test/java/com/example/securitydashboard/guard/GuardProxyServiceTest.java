package com.example.securitydashboard.guard;

import static org.assertj.core.api.Assertions.*;

import com.example.securitydashboard.common.ApiException;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.HttpMethod;
import org.springframework.web.client.RestClient;

class GuardProxyServiceTest {
  private HttpServer server;
  private String base;
  private final AtomicReference<String> received = new AtomicReference<>();

  @BeforeEach
  void start() throws Exception {
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext(
        "/",
        exchange -> {
          received.set(
              exchange.getRequestMethod()
                  + " "
                  + exchange.getRequestURI()
                  + " "
                  + exchange.getRequestHeaders().getFirst("X-Admin-Key")
                  + " "
                  + exchange.getRequestHeaders().getFirst("If-Match")
                  + " "
                  + new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
          exchange.getResponseHeaders().set("Content-Type", "application/json");
          exchange.getResponseHeaders().set("ETag", "\"8\"");
          exchange.getResponseHeaders().set("X-Admin-Key", "synthetic-first");
          int status = exchange.getRequestURI().getPath().endsWith("/runtime") ? 412 : 200;
          byte[] response = "{\"detail\":\"synthetic-first\"}".getBytes(StandardCharsets.UTF_8);
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

  private GuardProxyService proxy() {
    return new GuardProxyService(
        RestClient.builder(), base + "/", " synthetic-first,synthetic-second ");
  }

  @ParameterizedTest
  @ValueSource(strings = {"GET", "PUT", "POST", "PATCH", "DELETE"})
  void forwardsMethodBodyQueryAndRevisionUsingOnlyFirstManagementKey(String method) {
    var result =
        proxy()
            .forward(
                "clients/demo_1",
                "include_revoked=true",
                HttpMethod.valueOf(method),
                "{\"label\":\"데모\"}".getBytes(StandardCharsets.UTF_8),
                "\"7\"");
    assertThat(received.get())
        .isEqualTo(
            method
                + " /v1/admin/clients/demo_1?include_revoked=true synthetic-first \"7\""
                + " {\"label\":\"데모\"}");
    assertThat(result.getStatusCode().value()).isEqualTo(200);
    assertThat(result.getHeaders().getETag()).isEqualTo("\"8\"");
    assertThat(result.getHeaders()).doesNotContainKey("X-Admin-Key");
    assertThat(new String(result.getBody(), StandardCharsets.UTF_8))
        .isEqualTo("{\"detail\":\"[REDACTED]\"}");
  }

  @Test
  void preservesUpstreamConflict() {
    var result =
        proxy()
            .forward(
                "runtime", null, HttpMethod.PUT, "{}".getBytes(StandardCharsets.UTF_8), "\"3\"");
    assertThat(result.getStatusCode().value()).isEqualTo(412);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "ruleset",
        "ruleset/history",
        "modules",
        "custom-rules",
        "custom-rules/test",
        "context-detectors",
        "context-detectors/test",
        "prompt",
        "org/settings",
        "org/status",
        "org/refresh",
        "runtime",
        "enrollments",
        "clients",
        "audit/events",
        "audit/summary",
        "custom-rules/example",
        "context-detectors/example"
      })
  void allowsOnlyContractRoutes(String path) {
    assertThat(proxy().forward(path, null, HttpMethod.GET, null, null).getStatusCode().value())
        .isIn(200, 412);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "healthz",
        "../inspect",
        "ruleset/other",
        "org",
        "clients/a/b",
        "clients/%2e%2e",
        "clients/..",
        "custom-rules/test/other",
        "http://example.test"
      })
  void rejectsUnknownOrEscapedPathsWithoutConnecting(String path) {
    assertThatThrownBy(() -> proxy().forward(path, null, HttpMethod.GET, null, null))
        .isInstanceOfSatisfying(
            ApiException.class, error -> assertThat(error.status().value()).isEqualTo(404));
    assertThat(received.get()).isNull();
  }

  @Test
  void absentSettingsAndConnectionFailureHaveSafe503() {
    for (var service :
        new GuardProxyService[] {
          new GuardProxyService(RestClient.builder(), "", "synthetic-first"),
          new GuardProxyService(RestClient.builder(), base, ""),
          new GuardProxyService(RestClient.builder(), base, ",synthetic-second")
        }) {
      assertUnavailable(service);
    }
    server.stop(0);
    assertUnavailable(proxy());
  }

  private void assertUnavailable(GuardProxyService service) {
    assertThatThrownBy(() -> service.forward("runtime", null, HttpMethod.GET, null, null))
        .isInstanceOfSatisfying(
            ApiException.class,
            error -> {
              assertThat(error.status().value()).isEqualTo(503);
              assertThat(error.code()).isEqualTo("GUARD_UNAVAILABLE");
              assertThat(error.getMessage()).doesNotContain("synthetic");
            });
  }
}
