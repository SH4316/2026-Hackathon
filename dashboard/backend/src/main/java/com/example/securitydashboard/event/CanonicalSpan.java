package com.example.securitydashboard.event;

import java.util.List;

record CanonicalSpan(int start, int end, String text, List<String> tagIds) {}
