package com.example.securitydashboard.event.model;

import java.util.List;

public record Detection(long id, int start, int end, String text, List<DetectionTag> tags) {}
