package com.example.securitydashboard.detector;

import com.example.securitydashboard.event.CanonicalEvent;
import java.util.List;

record NormalizedEvent(
    CanonicalEvent event, String envelope, String contentHash, List<DecodedImage> images) {}
