package com.example.securitydashboard.configuration.model;

import java.math.BigDecimal;
import java.util.List;

public record Tag(
    String id,
    String name,
    String description,
    List<String> examples,
    String guidance,
    BigDecimal jevThreshold,
    String pythonRegex,
    String color,
    String parentId,
    Integer order) {}
