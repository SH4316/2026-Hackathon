package com.example.securitydashboard.detector;

import com.example.securitydashboard.api.ApiModels;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigInteger;
import java.time.Instant;
import java.util.List;
import java.util.Map;

/** The detector's snake_case wire contract is scoped to these DTOs only. */
public final class DetectorModels {
  private DetectorModels() {}

  @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
  @Schema(name = "CreateDetectorEvent", description = "InspectResponse 원본과 대시보드 사용자/설정 버전의 수집 봉투")
  public record CreateDetectorEvent(
      @NotNull @Pattern(regexp = ApiModels.ID_PATTERN) String sourceId,
      @NotNull @Pattern(regexp = ApiModels.ID_PATTERN) String personId,
      @Schema(description = "활성 대시보드 설정 ID. result.policy_version과 별개입니다.")
          @NotNull
          @Pattern(regexp = ApiModels.ID_PATTERN)
          String versionId,
      @NotNull String text,
      @Schema(implementation = InspectResponse.class) @NotNull JsonNode result,
      String occurredAt,
      @Schema(description = "생략하면 result.destination.provider 사용") String service,
      @Schema(description = "명시적으로 제공한 대상 모델명. detector_versions.model에서 추론하지 않습니다.") String model,
      String policyStateId,
      @Schema(description = "탐지 type → 설정 태그 ID. 생략 시 같은 ID인 태그로 연결하며 없는 유형은 미분류로 보관합니다.")
          Map<String, String> tagMap,
      @Size(max = 100) List<@NotNull @Valid FileName> files,
      @Size(max = 20) List<@NotNull @Valid ImageInput> images) {}

  @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
  public record FileName(@NotNull String name) {}

  @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
  public record ImageInput(
      @NotNull String name,
      @Schema(description = "image/* MIME 형식. 메타데이터로 보존하며 원본을 변환하지 않습니다.") @NotNull
          String mediaType,
      @Schema(description = "원본 바이트의 표준 Base64. data URI 금지. 원본 한 장 최대 5MiB.") @NotNull
          String dataBase64) {}

  @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
  public record InspectResponse(
      @Schema(
              description = "유니코드 문자 1~128자. 대시보드 ID 패턴으로 제한하지 않습니다.",
              minLength = 1,
              maxLength = 128)
          @NotNull
          String requestId,
      @Schema(oneOf = {BigInteger.class, String.class}) @NotNull JsonNode inputVersion,
      @NotNull Status status,
      @NotNull Decision decision,
      @NotNull Signal signal,
      @NotNull List<@NotNull @Valid Finding> findings,
      @NotNull String policyVersion,
      @NotNull @Valid Destination destination,
      @NotNull Map<@NotNull String, @NotNull String> detectorVersions,
      List<@NotNull String> notices) {}

  @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
  public record Finding(
      @NotNull String findingId,
      @NotNull String type,
      @NotNull String category,
      @NotNull String ruleId,
      @NotNull Detector detector,
      @NotNull Confidence confidence,
      @NotNull Severity severity,
      @NotNull Action action,
      @NotNull @Valid Span span,
      @NotNull String reason,
      String replacement) {}

  @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
  public record Span(
      @NotNull Integer start,
      @NotNull Integer end,
      @NotNull Integer startUtf16,
      @NotNull Integer endUtf16) {}

  @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
  public record Destination(
      @NotNull String provider,
      @NotNull String channel,
      @NotNull String tier,
      @NotNull Boolean verified,
      @JsonProperty(required = true) String basis) {}

  public enum Status {
    complete,
    incomplete,
    error
  }

  public enum Decision {
    allow,
    warn,
    block
  }

  public enum Signal {
    green,
    yellow,
    red,
    gray
  }

  public enum Confidence {
    high,
    medium,
    low
  }

  public enum Severity {
    critical,
    high,
    medium,
    low,
    info
  }

  public enum Action {
    block,
    mask,
    warn,
    allow
  }

  public enum Detector {
    rule,
    model
  }

  @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
  public record StoredDetectorEvent(
      long id,
      String eventId,
      ApiModels.Event event,
      String sourceId,
      String personId,
      String versionId,
      String text,
      @Schema(implementation = InspectResponse.class) JsonNode result,
      Instant occurredAt,
      String service,
      String model,
      String policyStateId,
      Map<String, String> tagMap,
      List<FileName> files,
      List<ImageMetadata> images) {}

  @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
  public record ImageMetadata(
      long id, String name, String mediaType, long sizeBytes, String downloadPath) {}
}
