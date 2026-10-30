package com.example.securitydashboard.query;

import java.time.Instant;

record TimeBucket(String label, Instant from, Instant to) {}
