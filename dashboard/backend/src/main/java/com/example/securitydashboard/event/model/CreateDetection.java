package com.example.securitydashboard.event.model;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import java.util.List;

public record CreateDetection(
    @NotNull @PositiveOrZero Integer start,
    @NotNull @Positive Integer end,
    @NotNull String text,
    @NotNull @Size(min = 1, max = 1000) List<@NotNull String> tagIds) {}
