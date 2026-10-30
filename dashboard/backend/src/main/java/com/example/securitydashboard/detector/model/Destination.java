package com.example.securitydashboard.detector.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import jakarta.validation.constraints.NotNull;

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public record Destination(
    @NotNull String provider,
    @NotNull String channel,
    @NotNull String tier,
    @NotNull Boolean verified,
    @JsonProperty(required = true) String basis) {}
