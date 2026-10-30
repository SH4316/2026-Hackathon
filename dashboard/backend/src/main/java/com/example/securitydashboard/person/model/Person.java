package com.example.securitydashboard.person.model;

import java.time.Instant;

public record Person(
    String id, String name, long eventCount, long findingCount, Instant lastEventAt) {}
