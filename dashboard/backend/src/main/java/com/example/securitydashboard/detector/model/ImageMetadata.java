package com.example.securitydashboard.detector.model;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public record ImageMetadata(
    long id, String name, String mediaType, long sizeBytes, String downloadPath) {}
