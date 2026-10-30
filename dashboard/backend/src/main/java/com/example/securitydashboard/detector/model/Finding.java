package com.example.securitydashboard.detector.model;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

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
