package com.example.securitydashboard.event.model;

import java.time.Instant;
import java.util.List;

public record Event(
    long id,
    String sourceId,
    String eventId,
    String versionId,
    String personId,
    String personName,
    String prompt,
    Instant occurredAt,
    Instant receivedAt,
    String service,
    String model,
    String policyStateId,
    String policyStateName,
    List<Detection> detections,
    long findingCount,
    String sendAction,
    int fileCount,
    int imageCount) {}
