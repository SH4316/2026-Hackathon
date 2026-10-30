package com.example.securitydashboard.configuration.model;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import java.math.BigDecimal;
import java.util.List;

public record UpdateTagDetails(
    @NotNull @PositiveOrZero Long revision,
    String name,
    String description,
    List<String> examples,
    String guidance,
    BigDecimal jevThreshold,
    String pythonRegex,
    String color,
    Boolean enabled) {}
