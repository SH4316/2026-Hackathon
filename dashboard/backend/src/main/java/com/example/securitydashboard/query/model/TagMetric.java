package com.example.securitydashboard.query.model;

public record TagMetric(
    String id,
    String parentId,
    String name,
    String color,
    int order,
    long count,
    long eventCount) {}
