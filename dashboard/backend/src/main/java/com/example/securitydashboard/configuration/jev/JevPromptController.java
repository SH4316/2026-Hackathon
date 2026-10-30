package com.example.securitydashboard.configuration.jev;

import com.example.securitydashboard.configuration.model.ConfigVersion;
import com.example.securitydashboard.configuration.model.DeleteJevPrompt;
import com.example.securitydashboard.configuration.model.SaveJevPrompt;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.net.URI;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/config-versions/{versionId}/jev-prompts")
@Tag(name = "Jev 설정")
class JevPromptController {
  private final JevPromptService prompts;

  JevPromptController(JevPromptService prompts) {
    this.prompts = prompts;
  }

  @Operation(
      summary = "선택한 버전에 Jev 판단 프롬프트 추가",
      description =
          "초안과 게시 버전 모두 수정할 수 있습니다. outputs는 같은 버전의 기존 태그를 선택합니다."
              + " threshold는 해당 태그의 공통 임계값이며 null은 임계값 사용 안 함, 0은 유효한 임계값입니다."
              + " 한 버전에 새 프롬프트는 최대 100개까지 추가할 수 있습니다."
              + " enabled를 생략하거나 null로 보내면 true로 생성하며 출력 태그의 enabled 값은 바꾸지 않습니다."
              + " 저장 시 revision이 한 번 증가하며 Jev를 실행하지 않습니다.")
  @PostMapping
  ResponseEntity<ConfigVersion> create(
      @PathVariable String versionId, @Valid @RequestBody SaveJevPrompt input) {
    var result = prompts.create(versionId, input);
    return ResponseEntity.created(URI.create("/api/v1/config-versions/" + versionId)).body(result);
  }

  @Operation(
      summary = "선택한 버전의 Jev 판단 프롬프트 저장",
      description =
          "이름·판단 프롬프트·출력 태그와 임계값을 함께 저장합니다. 같은 태그를 여러 프롬프트가 참조할 수 있으며"
              + " 임계값은 해당 버전의 태그에 공통으로 적용됩니다. 출력에서 태그를 제외해도 태그와 임계값은 유지합니다."
              + " enabled는 선택한 버전의 프롬프트에만 적용하며 생략하거나 null로 보내면 기존 값을 유지합니다."
              + " 프롬프트나 출력 태그의 enabled 값은 서로 독립적이며 출력 연결은 유지합니다."
              + " revision이 최신 값과 다르면 409 REVISION_CONFLICT입니다.")
  @PutMapping("/{promptId}")
  ConfigVersion update(
      @PathVariable String versionId,
      @PathVariable String promptId,
      @Valid @RequestBody SaveJevPrompt input) {
    return prompts.update(versionId, promptId, input);
  }

  @Operation(
      summary = "선택한 버전의 Jev 판단 프롬프트 삭제",
      description = "요청 본문의 revision이 필수입니다. 태그와 임계값은 유지하며 수정된 전체 설정을 반환합니다.")
  @DeleteMapping("/{promptId}")
  ConfigVersion delete(
      @PathVariable String versionId,
      @PathVariable String promptId,
      @Valid @RequestBody DeleteJevPrompt input) {
    return prompts.delete(versionId, promptId, input);
  }
}
