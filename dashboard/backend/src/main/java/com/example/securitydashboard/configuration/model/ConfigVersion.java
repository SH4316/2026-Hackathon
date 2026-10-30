package com.example.securitydashboard.configuration.model;

import java.time.Instant;
import java.util.List;

public record ConfigVersion(
    String id,
    String name,
    String status,
    boolean isActive,
    long revision,
    Instant createdAt,
    Instant publishedAt,
    List<Tag> tags,
    List<PolicyDefinition> policyStates,
    List<JevPrompt> jevPrompts) {}
