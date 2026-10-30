package com.example.securitydashboard.web;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.example.securitydashboard.common.ApiException;
import com.example.securitydashboard.guard.GuardProxyService;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class GuardProxyControllerTest {
  @Test
  void controllerForwardsRawPathBodyAndIfMatch() throws Exception {
    var service = mock(GuardProxyService.class);
    when(service.forward(
            eq("clients/demo"),
            eq("include_revoked=true"),
            eq(HttpMethod.PATCH),
            any(),
            eq("\"4\"")))
        .thenReturn(ResponseEntity.status(201).eTag("\"5\"").body("{}".getBytes()));
    var mvc = MockMvcBuilders.standaloneSetup(new GuardProxyController(service)).build();
    mvc.perform(
            patch("/api/v1/guard/clients/demo?include_revoked=true")
                .contentType("application/json")
                .header("If-Match", "\"4\"")
                .content("{}"))
        .andExpect(status().isCreated())
        .andExpect(header().string("ETag", "\"5\""));
    verify(service)
        .forward(
            eq("clients/demo"),
            eq("include_revoked=true"),
            eq(HttpMethod.PATCH),
            eq("{}".getBytes()),
            eq("\"4\""));
  }

  @Test
  void unavailableUsesDashboardErrorEnvelope() throws Exception {
    var service = mock(GuardProxyService.class);
    when(service.forward(eq("runtime"), isNull(), eq(HttpMethod.GET), isNull(), isNull()))
        .thenThrow(
            new ApiException(
                HttpStatus.SERVICE_UNAVAILABLE, "GUARD_UNAVAILABLE", "검사 서버에 연결할 수 없습니다."));
    MockMvcBuilders.standaloneSetup(new GuardProxyController(service))
        .setControllerAdvice(new ApiExceptionHandler())
        .build()
        .perform(get("/api/v1/guard/runtime"))
        .andExpect(status().isServiceUnavailable())
        .andExpect(jsonPath("$.code").value("GUARD_UNAVAILABLE"))
        .andExpect(jsonPath("$.message").value("검사 서버에 연결할 수 없습니다."));
  }

  @Test
  void servesGuardSpaRouteOnly() throws Exception {
    var mvc = MockMvcBuilders.standaloneSetup(new SpaController()).build();
    mvc.perform(get("/settings/guard")).andExpect(forwardedUrl("/index.html"));
    mvc.perform(get("/settings/guard/unknown")).andExpect(status().isNotFound());
  }
}
