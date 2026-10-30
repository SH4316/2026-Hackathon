package com.example.securitydashboard.connector;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * 검사 서버 전용 엔드포인트의 연결 인증.
 *
 * <ul>
 *   <li>GET /api/v1/classifier-config, /api/v1/detector-events/**: 연결을 한 번이라도 발급했으면 유효한 연결 필요
 *   <li>GET /api/v1/connectors/{id}: 항상 그 연결의 비밀값 필요(연결 확인)
 * </ul>
 *
 * 대시보드 화면이 쓰는 나머지 API는 기존처럼 로컬 무인증입니다.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 5)
class ConnectorAuthFilter extends OncePerRequestFilter {
  static final String CONNECTOR_ID = ConnectorAuthFilter.class.getName() + ".connectorId";
  private final ConnectorService connectors;
  private final ObjectMapper mapper;

  ConnectorAuthFilter(ConnectorService connectors, ObjectMapper mapper) {
    this.connectors = connectors;
    this.mapper = mapper;
  }

  private static String path(HttpServletRequest request) {
    return request.getRequestURI().substring(request.getContextPath().length());
  }

  private static String checkedConnector(HttpServletRequest request) {
    String path = path(request);
    if (!request.getMethod().equals("GET") || !path.startsWith(ConnectorService.CONNECTOR_PATH)) return null;
    String id = path.substring(ConnectorService.CONNECTOR_PATH.length());
    return id.isEmpty() || id.contains("/") ? null : id;
  }

  private static boolean detectorEndpoint(HttpServletRequest request) {
    String path = path(request);
    return (request.getMethod().equals("GET") && path.equals("/api/v1/classifier-config"))
        || path.equals("/api/v1/detector-events")
        || path.startsWith("/api/v1/detector-events/");
  }

  @Override
  protected boolean shouldNotFilter(HttpServletRequest request) {
    return checkedConnector(request) == null && !detectorEndpoint(request);
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {
    String expected = checkedConnector(request);
    if (expected == null && !connectors.authRequired()) {
      chain.doFilter(request, response);
      return;
    }
    String header = request.getHeader("Authorization");
    String secret =
        header != null && header.regionMatches(true, 0, "Bearer ", 0, 7) ? header.substring(7).trim() : null;
    var id = connectors.authenticate(secret);
    if (id.isEmpty() || (expected != null && !expected.equals(id.get()))) {
      response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
      response.setContentType("application/json");
      response.setCharacterEncoding(StandardCharsets.UTF_8.name());
      response.setHeader("WWW-Authenticate", "Bearer");
      mapper.writeValue(
          response.getOutputStream(),
          Map.of(
              "code", "CONNECTOR_AUTH_REQUIRED",
              "message", "대시보드에서 발급한 유효한 검사 서버 연결이 필요합니다."));
      return;
    }
    request.setAttribute(CONNECTOR_ID, id.get());
    chain.doFilter(request, response);
  }
}
