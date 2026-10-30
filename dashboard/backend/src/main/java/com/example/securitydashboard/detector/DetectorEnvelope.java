package com.example.securitydashboard.detector;

import com.example.securitydashboard.detector.model.FileName;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;
import java.util.Map;

record DetectorEnvelope(JsonNode result, Map<String, String> tagMap, List<FileName> files) {}
