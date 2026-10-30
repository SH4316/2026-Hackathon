package com.example.securitydashboard.configuration;

import com.example.securitydashboard.configuration.model.ConfigVersion;
import com.example.securitydashboard.configuration.model.CreateVersion;
import com.example.securitydashboard.configuration.model.PublishVersion;
import com.example.securitydashboard.configuration.model.UpdateVersion;
import com.example.securitydashboard.configuration.model.VersionSummary;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.net.URI;
import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
class ConfigurationController {
  private final ConfigurationService configs;

  ConfigurationController(ConfigurationService configs) {
    this.configs = configs;
  }

  @Tag(name = "설정 버전")
  @Operation(summary = "버전 목록")
  @GetMapping("/config-versions")
  List<VersionSummary> versions() {
    return configs.list();
  }

  @Tag(name = "설정 버전")
  @Operation(
      summary = "빈 초안 또는 버전 복제",
      description = "baseVersionId를 생략하면 빈 초안입니다. 복제 시 태그와 정책의 논리 ID를 유지합니다.")
  @PostMapping("/config-versions")
  ResponseEntity<ConfigVersion> createVersion(@RequestBody CreateVersion input) {
    var value = configs.create(input);
    return ResponseEntity.created(URI.create("/api/v1/config-versions/" + value.id())).body(value);
  }

  @Tag(name = "설정 버전")
  @GetMapping("/config-versions/{id}")
  ConfigVersion version(@PathVariable String id) {
    return configs.get(id);
  }

  @Tag(name = "설정 버전")
  @Operation(
      summary = "초안 저장",
      description =
          "revision이 최신 값과 다르면 409 REVISION_CONFLICT입니다. 게시 버전은 수정할 수 없습니다."
              + " 태그별 jevPrompt와 pythonRegex는 부모와 독립적이며 생략하거나 null이면 빈 문자열로 저장합니다.")
  @PutMapping("/config-versions/{id}")
  ConfigVersion updateVersion(@PathVariable String id, @Valid @RequestBody UpdateVersion input) {
    return configs.update(id, input);
  }

  @Tag(name = "설정 버전")
  @PostMapping("/config-versions/{id}/publish")
  ConfigVersion publish(@PathVariable String id, @Valid @RequestBody PublishVersion input) {
    return configs.publish(id, input.revision());
  }

  @Tag(name = "설정 버전")
  @Operation(summary = "게시 버전 활성화", description = "활성 포인터는 단 하나이며 활성화와 새 이벤트 등록은 원자적으로 조정됩니다.")
  @PostMapping("/config-versions/{id}/activate")
  ConfigVersion activate(@PathVariable String id) {
    return configs.activate(id);
  }

  @Tag(name = "설정 버전")
  @DeleteMapping("/config-versions/{id}")
  ResponseEntity<Void> deleteVersion(@PathVariable String id) {
    configs.delete(id);
    return ResponseEntity.noContent().build();
  }

  @Tag(name = "분류 연동")
  @Operation(
      summary = "활성 분류 설정",
      description =
          "트리, 예시, 가이드, 태그별 Jev 판단 프롬프트·Python 정규식과 정책 정의를 반환합니다."
              + " 프롬프트와 정규식은 저장·조회만 하며 실행하지 않습니다. 최초 실행에는 404 NO_ACTIVE_VERSION입니다.")
  @GetMapping("/classifier-config")
  ConfigVersion classifier() {
    return configs.classifier();
  }
}
