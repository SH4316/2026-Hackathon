package com.example.securitydashboard.detector.model;

import static com.example.securitydashboard.common.InputValidation.ID_PATTERN;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Map;

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
@Schema(name = "CreateDetectorEvent", description = "InspectResponse 원본과 대시보드 사용자/설정 버전의 수집 봉투")
public record CreateDetectorEvent(
    @NotNull @Pattern(regexp = ID_PATTERN) String sourceId,
    @NotNull @Pattern(regexp = ID_PATTERN) String personId,
    @Schema(description = "활성 대시보드 설정 ID. result.policy_version과 별개입니다.")
        @NotNull
        @Pattern(regexp = ID_PATTERN)
        String versionId,
    @NotNull String text,
    @Schema(implementation = InspectResponse.class) @NotNull JsonNode result,
    String occurredAt,
    @Schema(description = "생략하면 result.destination.provider 사용") String service,
    @Schema(description = "명시적으로 제공한 대상 모델명. detector_versions.model에서 추론하지 않습니다.") String model,
    String policyStateId,
    @Schema(
            description = "실제 전송 방식. 생략 시 null",
            allowableValues = {"normal", "confirmed", "forced"})
        @Pattern(regexp = "normal|confirmed|forced")
        String sendAction,
    @Schema(description = "탐지 type → 설정 태그 ID. 생략 시 같은 ID인 태그로 연결하며 없는 유형은 미분류로 보관합니다.")
        Map<String, String> tagMap,
    @Size(max = 100) List<@NotNull @Valid FileName> files,
    @Size(max = 20) List<@NotNull @Valid ImageInput> images) {}
