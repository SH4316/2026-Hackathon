package com.example.securitydashboard.connector.model;

import java.util.Map;

public record UpdateDetectorSettings(
    Integer revision,
    String reportText,
    Map<String, String> tagMap,
    String tagAction,
    Boolean jevEnabled) {}
