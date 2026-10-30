package com.example.securitydashboard.event;

import com.example.securitydashboard.event.model.Event;

public record EventIngestResult(Event event, boolean created) {}
