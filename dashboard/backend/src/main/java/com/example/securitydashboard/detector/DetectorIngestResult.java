package com.example.securitydashboard.detector;

import com.example.securitydashboard.detector.model.StoredDetectorEvent;

record DetectorIngestResult(StoredDetectorEvent event, boolean created) {}
