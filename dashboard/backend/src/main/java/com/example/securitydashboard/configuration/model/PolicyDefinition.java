package com.example.securitydashboard.configuration.model;

public record PolicyDefinition(
    String id, String name, String description, String color, Integer order) {}
