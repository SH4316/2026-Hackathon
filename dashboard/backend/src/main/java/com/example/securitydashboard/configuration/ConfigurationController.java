package com.example.securitydashboard.configuration;

import com.example.securitydashboard.configuration.model.ConfigVersion;
import com.example.securitydashboard.configuration.model.CreateVersion;
import com.example.securitydashboard.configuration.model.PublishVersion;
import com.example.securitydashboard.configuration.model.UpdateTagDetails;
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
      description =
          "baseVersionId를 생략하면 빈 초안입니다. 복제 시 태그·정책·Jev 프롬프트와 출력 연결을 복사하며"
              + " 논리 ID와 태그·Jev 프롬프트의 enabled 값을 유지합니다.")
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
          "revision이 최신 값과 다르면 409 REVISION_CONFLICT입니다. 트리 구조와 정책은 초안에서만 저장할 수 있습니다."
              + " 태그의 jevThreshold는 0~1 또는 null이며 Python 정규식은 부모와 독립적입니다."
              + " 태그의 enabled를 생략하거나 null로 보내면 같은 ID의 기존 값을 유지하고 새 태그는 true입니다."
              + " enabled는 태그마다 독립적이며 부모·자식이나 Jev 출력 연결을 변경하지 않습니다."
              + " Jev 판단 프롬프트는 전용 API에서 수정합니다.")
  @PutMapping("/config-versions/{id}")
  ConfigVersion updateVersion(@PathVariable String id, @Valid @RequestBody UpdateVersion input) {
    return configs.update(id, input);
  }

  @Tag(name = "설정 버전")
  @Operation(
      summary = "선택한 버전의 태그 상세 저장",
      description =
          "초안과 게시 버전 모두 기존 태그의 이름·설명·예시·가이드·Jev 임계값·Python 정규식·색상·enabled를 수정할 수 있습니다."
              + " 선택한 버전에만 적용하며 같은 논리 ID를 사용하는 다른 버전은 바꾸지 않습니다."
              + " enabled를 생략하거나 null로 보내면 기존 값을 유지하며 부모·자식의 값과 Jev 출력 연결은 유지합니다."
              + " 버전 ID, 상태, 활성 여부, 트리의 태그 구성·부모·순서와 정책은 유지합니다."
              + " revision은 필수이며 최신 값과 다르면 409 REVISION_CONFLICT입니다."
              + " 성공하면 같은 버전의 revision이 1 증가하고 현재 전체 설정을 반환합니다.")
  @PutMapping("/config-versions/{id}/tags/{tagId}")
  ConfigVersion updateTagDetails(
      @PathVariable String id,
      @PathVariable String tagId,
      @Valid @RequestBody UpdateTagDetails input) {
    return configs.updateTagDetails(id, tagId, input);
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
          "트리, 예시, 가이드, 태그별 Jev 임계값·Python 정규식, 독립적인 Jev 판단 프롬프트·출력 태그와 정책 정의를 반환합니다."
              + " 게시 후 수정한 현재 태그 상세와 revision을 포함합니다."
              + " 비활성 항목도 제외하지 않으며 모든 태그와 Jev 프롬프트의 enabled 값을 반환합니다."
              + " 프롬프트와 정규식은 저장·조회만 하며 실행하지 않습니다. 최초 실행에는 404 NO_ACTIVE_VERSION입니다.")
  @GetMapping("/classifier-config")
  ConfigVersion classifier() {
    return configs.classifier();
  }
}
