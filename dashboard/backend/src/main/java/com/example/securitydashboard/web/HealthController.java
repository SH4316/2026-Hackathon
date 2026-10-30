package com.example.securitydashboard.web;

import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.*;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1")
class HealthController {
  @Tag(name = "상태")
  @GetMapping("/health")
  Map<String, String> health() {
    return Map.of("status", "UP");
  }
}
