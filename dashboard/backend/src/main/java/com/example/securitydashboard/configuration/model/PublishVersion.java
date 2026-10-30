package com.example.securitydashboard.configuration.model;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;

public record PublishVersion(@NotNull @PositiveOrZero Long revision) {}
