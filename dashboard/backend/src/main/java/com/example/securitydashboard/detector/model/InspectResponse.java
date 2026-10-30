package com.example.securitydashboard.detector.model;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.math.BigInteger;
import java.util.List;
import java.util.Map;

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public record InspectResponse(
    @Schema(description = "유니코드 문자 1~128자. 대시보드 ID 패턴으로 제한하지 않습니다.", minLength = 1, maxLength = 128)
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
