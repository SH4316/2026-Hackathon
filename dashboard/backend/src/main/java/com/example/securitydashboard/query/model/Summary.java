package com.example.securitydashboard.query.model;

public record Summary(
    long eventCount, long findingCount, long personCount, long detectedEventCount) {}
