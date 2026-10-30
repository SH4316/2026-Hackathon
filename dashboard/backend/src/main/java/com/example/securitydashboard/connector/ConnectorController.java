package com.example.securitydashboard.connector;

import com.example.securitydashboard.connector.model.Connector;
import com.example.securitydashboard.connector.model.CreateConnector;
import com.example.securitydashboard.connector.model.CreateEnrollment;
import com.example.securitydashboard.connector.model.CreatedConnector;
import com.example.securitydashboard.connector.model.Enrollment;
import com.example.securitydashboard.connector.model.RedeemEnrollment;
import com.example.securitydashboard.connector.model.RedeemedEnrollment;
import com.example.securitydashboard.connector.model.DetectorSettings;
import com.example.securitydashboard.connector.model.UpdateDetectorSettings;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import java.net.URI;
import java.util.List;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.support.ServletUriComponentsBuilder;

@RestController
@RequestMapping("/api/v1")
@Tag(name = "검사 서버 연결")
class ConnectorController {
  private final ConnectorService service;

  ConnectorController(ConnectorService service) {
    this.service = service;
  }

  @Operation(summary = "검사 서버 연결 목록", description = "비밀값은 포함하지 않습니다.")
  @GetMapping("/connectors")
  List<Connector> connectors() {
    return service.list();
  }

  @Operation(
      summary = "검사 서버 연결 URL 발급",
      description =
          "connectionUrl(<대시보드 주소>/api/v1/connectors/<id>#<secret>)은 이 응답에서만 볼 수 있습니다. 검사 서버의"
              + " PG_DASHBOARD_CONNECTION에 넣습니다. 연결을 처음 발급한 뒤부터 /classifier-config와 /detector-events는"
              + " 유효한 연결의 Authorization: Bearer <secret>이 필요합니다.")
  @PostMapping("/connectors")
  ResponseEntity<CreatedConnector> create(
      @RequestBody(required = false) CreateConnector input, HttpServletRequest request) {
    String base = ServletUriComponentsBuilder.fromContextPath(request).build().toUriString();
    var created = service.create(input == null ? new CreateConnector(null, null, null) : input, base);
    return ResponseEntity.created(URI.create("/api/v1/connectors/" + created.connector().id()))
        .body(created);
  }

  @Operation(summary = "연결 해지", description = "해지한 연결의 비밀값은 즉시 거부됩니다.")
  @DeleteMapping("/connectors/{id}")
  ResponseEntity<Void> revoke(@PathVariable String id) {
    service.revoke(id);
    return ResponseEntity.noContent().build();
  }

  @Operation(
      summary = "연결 확인(검사 서버용)",
      description = "연결 URL 자체입니다. 그 연결의 Authorization: Bearer <secret>이 필요합니다.")
  @GetMapping("/connectors/{id}")
  Map<String, Object> check(@PathVariable String id) {
    return Map.of("id", id, "connected", true);
  }

  @Tag(name = "사용자")
  @Operation(
      summary = "확장프로그램 연결 코드 발급",
      description =
          "그 사람의 일회용 코드(XXXX-XXXX)를 발급합니다. 코드는 이 응답에서만 볼 수 있습니다. 검사 서버 주소가 등록된 연결이"
              + " 있으면 connectionInfo(<검사 서버 주소>#<code>)를 함께 돌려줍니다. 사용자는 확장 설정의 대시보드 연결에 넣습니다.")
  @PostMapping("/people/{id}/enrollments")
  ResponseEntity<Enrollment> enroll(
      @PathVariable String id, @RequestBody(required = false) CreateEnrollment input) {
    return ResponseEntity.status(201).body(service.createEnrollment(id, input));
  }

  @Operation(
      summary = "연결 코드 사용(검사 서버용)",
      description = "연결 인증이 필요합니다. 없음·만료·이미 사용한 코드는 모두 404 ENROLLMENT_INVALID입니다.")
  @PostMapping("/enrollments/redeem")
  RedeemedEnrollment redeem(@RequestBody RedeemEnrollment input, HttpServletRequest request) {
    return service.redeem(
        input == null ? null : input.code(), (String) request.getAttribute(ConnectorAuthFilter.CONNECTOR_ID));
  }

  @Operation(
      summary = "검사 서버 조직 설정",
      description =
          "reportText(masked|full|off), tagMap(검사 서버 탐지 유형 → 태그 ID), tagAction(warn|mask|block), jevEnabled."
              + " 연결된 검사 서버가 활성 분류 설정과 함께 가져갑니다.")
  @GetMapping("/detector-settings")
  DetectorSettings settings() {
    return service.settings();
  }

  @Operation(summary = "검사 서버 조직 설정 저장", description = "revision이 다르면 409 REVISION_CONFLICT입니다.")
  @PutMapping("/detector-settings")
  DetectorSettings updateSettings(@RequestBody UpdateDetectorSettings input) {
    return service.updateSettings(input);
  }
}
