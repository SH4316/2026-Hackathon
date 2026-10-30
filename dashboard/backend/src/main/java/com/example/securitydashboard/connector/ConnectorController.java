package com.example.securitydashboard.connector;

import com.example.securitydashboard.connector.model.Connector;
import com.example.securitydashboard.connector.model.CreateConnector;
import com.example.securitydashboard.connector.model.CreatedConnector;
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
    var created = service.create(input == null ? new CreateConnector(null, null) : input, base);
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
