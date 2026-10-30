package com.example.securitydashboard.detector.model;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public record ImageInput(
    @NotNull String name,
    @Schema(description = "image/* MIME 형식. 메타데이터로 보존하며 원본을 변환하지 않습니다.") @NotNull String mediaType,
    @Schema(description = "원본 바이트의 표준 Base64. data URI 금지. 원본 한 장 최대 5MiB.") @NotNull
        String dataBase64) {}
