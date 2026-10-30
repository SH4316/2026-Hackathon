package com.example.securitydashboard.web;

import com.example.securitydashboard.guard.GuardProxyService;
import io.swagger.v3.oas.annotations.Operation;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;

@RestController
class GuardProxyController {
  private final GuardProxyService service;

  GuardProxyController(GuardProxyService service) {
    this.service = service;
  }

  @Operation(
      summary = "검사 서버 관리 프록시",
      description =
          "허용된 /v1/admin 경로에 요청과 If-Match를 전달합니다. 관리 키는 백엔드에만 보관하며 "
              + "응답 상태·본문·ETag를 유지합니다. 설정 누락 또는 연결 실패는 503 GUARD_UNAVAILABLE입니다.")
  @RequestMapping(
      value = "/api/v1/guard/**",
      method = {
        RequestMethod.GET,
        RequestMethod.POST,
        RequestMethod.PUT,
        RequestMethod.PATCH,
        RequestMethod.DELETE
      })
  ResponseEntity<byte[]> forward(
      HttpServletRequest request,
      @RequestBody(required = false) byte[] body,
      @RequestHeader(value = "If-Match", required = false) String ifMatch) {
    String prefix = request.getContextPath() + "/api/v1/guard/";
    return service.forward(
        request.getRequestURI().substring(prefix.length()),
        request.getQueryString(),
        HttpMethod.valueOf(request.getMethod()),
        body,
        ifMatch);
  }
}
