package com.example.securitydashboard.configuration.model;

import java.util.List;

public record JevPrompt(String id, String name, String prompt, List<String> tagIds) {}
