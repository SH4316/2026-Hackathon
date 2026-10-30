package com.example.securitydashboard.configuration.model;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import java.util.List;

public record SaveJevPrompt(
    @NotNull @PositiveOrZero Long revision,
    String name,
    String prompt,
    List<JevOutput> outputs,
    Boolean enabled) {}
