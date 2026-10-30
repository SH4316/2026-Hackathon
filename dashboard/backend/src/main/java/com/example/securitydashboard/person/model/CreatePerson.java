package com.example.securitydashboard.person.model;

import static com.example.securitydashboard.common.InputValidation.ID_PATTERN;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

public record CreatePerson(
    @NotNull @Pattern(regexp = ID_PATTERN) String id, @NotBlank String name) {}
