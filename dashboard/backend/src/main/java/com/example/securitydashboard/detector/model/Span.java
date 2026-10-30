package com.example.securitydashboard.detector.model;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import jakarta.validation.constraints.NotNull;

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public record Span(
    @NotNull Integer start,
    @NotNull Integer end,
    @NotNull Integer startUtf16,
    @NotNull Integer endUtf16) {}
