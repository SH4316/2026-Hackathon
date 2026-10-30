package com.example.securitydashboard.detector.model;

import com.example.securitydashboard.event.model.Event;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.Instant;
import java.util.List;
import java.util.Map;

@JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
public record StoredDetectorEvent(
    long id,
    String eventId,
    Event event,
    String sourceId,
    String personId,
    String versionId,
    String text,
    @Schema(implementation = InspectResponse.class) JsonNode result,
    Instant occurredAt,
    String service,
    String model,
    String policyStateId,
    String sendAction,
    Map<String, String> tagMap,
    List<FileName> files,
    List<ImageMetadata> images) {}
