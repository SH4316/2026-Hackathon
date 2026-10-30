package com.example.securitydashboard;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
class SpaController {
    // Explicit routes only: unknown APIs, assets and arbitrary paths retain real 404s.
    @GetMapping({"/", "/events", "/events/{id:[0-9]+}", "/people", "/people/{id:[A-Za-z0-9_-]+}", "/settings/monitoring"})
    String frontend() { return "forward:/index.html"; }
}
