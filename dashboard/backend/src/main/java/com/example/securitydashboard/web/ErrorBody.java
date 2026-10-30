package com.example.securitydashboard.web;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.Map;

@JsonInclude(JsonInclude.Include.NON_EMPTY)
record ErrorBody(String code, String message, Map<String, String> fieldErrors) {}
