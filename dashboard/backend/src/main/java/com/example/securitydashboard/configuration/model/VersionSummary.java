package com.example.securitydashboard.configuration.model;

import java.time.Instant;

public record VersionSummary(
    String id,
    String name,
    String status,
    boolean isActive,
    long revision,
    Instant createdAt,
    Instant publishedAt) {}
