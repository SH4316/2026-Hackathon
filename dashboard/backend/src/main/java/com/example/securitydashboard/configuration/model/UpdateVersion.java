package com.example.securitydashboard.configuration.model;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import java.util.List;

public record UpdateVersion(
    @NotNull @PositiveOrZero Long revision,
    String name,
    List<Tag> tags,
    List<PolicyDefinition> policyStates) {}
