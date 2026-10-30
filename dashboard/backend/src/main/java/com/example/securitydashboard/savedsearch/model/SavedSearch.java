package com.example.securitydashboard.savedsearch.model;

import com.example.securitydashboard.query.model.Filters;
import java.time.Instant;

public record SavedSearch(
    String id,
    String name,
    String versionId,
    Instant createdAt,
    Filters filters,
    long eventCount,
    long findingCount) {}
