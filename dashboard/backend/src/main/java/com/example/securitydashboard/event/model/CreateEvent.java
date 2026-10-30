package com.example.securitydashboard.event.model;

import static com.example.securitydashboard.common.InputValidation.ID_PATTERN;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.List;

public record CreateEvent(
    @NotNull @Pattern(regexp = ID_PATTERN) String sourceId,
    @NotNull @Pattern(regexp = ID_PATTERN) String eventId,
    @NotNull @Pattern(regexp = ID_PATTERN) String personId,
    @NotNull @Pattern(regexp = ID_PATTERN) String versionId,
    @NotBlank String prompt,
    @NotNull @Size(max = 1000) List<@NotNull @Valid CreateDetection> detections,
    String occurredAt,
    String service,
    String model,
    String policyStateId) {}
