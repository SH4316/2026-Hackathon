package com.example.securitydashboard.guard;

import com.example.securitydashboard.common.ApiException;
import java.net.URI;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Set;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

@Service
public class GuardProxyService {
  private static final Set<String> PATHS =
      Set.of(
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
          "audit/summary");
  private final RestClient client;
  private final String serverUrl;
  private final String adminKey;

  public GuardProxyService(
      RestClient.Builder builder,
      @Value("${guard.server-url:}") String serverUrl,
      @Value("${guard.admin-key:}") String adminKeys) {
    this.serverUrl = serverUrl.strip().replaceAll("/+$", "");
    this.adminKey = adminKeys.split(",", -1)[0].strip();
    var factory =
        new JdkClientHttpRequestFactory(
            HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(3))
                .followRedirects(HttpClient.Redirect.NEVER)
                .build());
    factory.setReadTimeout(Duration.ofSeconds(150));
    this.client = builder.requestFactory(factory).build();
  }

  public ResponseEntity<byte[]> forward(
      String path, String query, HttpMethod method, byte[] body, String ifMatch) {
    if (!PATHS.contains(path)
        && !path.matches("(?:custom-rules|context-detectors|clients)/[A-Za-z0-9_-]{1,80}")) {
      throw new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "허용되지 않은 검사 서버 관리 경로입니다.");
    }
    if (serverUrl.isEmpty() || adminKey.isEmpty()) throw unavailable();
    try {
      URI uri = URI.create(serverUrl + "/v1/admin/" + path + (query == null ? "" : "?" + query));
      var request =
          client
              .method(method)
              .uri(uri)
              .header("X-Admin-Key", adminKey)
              .header(HttpHeaders.ACCEPT, "application/json");
      if (ifMatch != null) request.header(HttpHeaders.IF_MATCH, ifMatch);
      if (body != null && body.length > 0) {
        request.header(HttpHeaders.CONTENT_TYPE, "application/json").body(body);
      }
      return request.exchange(
          (sent, response) -> {
            var headers = new HttpHeaders();
            if (response.getHeaders().getContentType() != null)
              headers.setContentType(response.getHeaders().getContentType());
            String etag = response.getHeaders().getETag();
            if (etag != null && !etag.contains(adminKey)) headers.setETag(etag);
            byte[] bytes = response.getBody().readAllBytes();
            // Never expose a reflected management credential, even on upstream errors.
            bytes =
                new String(bytes, StandardCharsets.UTF_8)
                    .replace(adminKey, "[REDACTED]")
                    .getBytes(StandardCharsets.UTF_8);
            return new ResponseEntity<>(bytes, headers, response.getStatusCode());
          });
    } catch (RestClientException | IllegalArgumentException exception) {
      throw unavailable();
    }
  }

  private static ApiException unavailable() {
    return new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        "GUARD_UNAVAILABLE",
        "검사 서버에 연결할 수 없습니다. 서버 연결과 관리 키 설정을 확인한 뒤 다시 시도해 주세요.");
  }
}
