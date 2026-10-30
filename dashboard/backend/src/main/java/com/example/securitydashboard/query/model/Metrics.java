package com.example.securitydashboard.query.model;

import java.util.List;

public record Metrics(
    String versionId,
    Summary summary,
    List<Series> series,
    List<TagMetric> tags,
    Unmapped unmapped,
    List<PolicyMetric> policies,
    List<ServiceMetric> services) {}
