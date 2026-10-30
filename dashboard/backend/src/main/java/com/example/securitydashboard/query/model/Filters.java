package com.example.securitydashboard.query.model;

public record Filters(
    String from,
    String to,
    String versionId,
    String service,
    String personId,
    String tagId,
    String policyStateId,
    String hasDetections,
    String q,
    String interval,
    String unmapped) {}
