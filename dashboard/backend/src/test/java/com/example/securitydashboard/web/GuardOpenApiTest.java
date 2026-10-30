package com.example.securitydashboard.web;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.example.securitydashboard.DashboardApplication;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.PlatformTransactionManager;

@SpringBootTest(
    classes = DashboardApplication.class,
    properties = {
      "spring.autoconfigure.exclude=org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration,org.springframework.boot.autoconfigure.flyway.FlywayAutoConfiguration",
      "guard.server-url=",
      "guard.admin-key="
    })
@AutoConfigureMockMvc
class GuardOpenApiTest {
  @MockitoBean JdbcTemplate jdbc;
  @MockitoBean NamedParameterJdbcTemplate namedJdbc;
  @MockitoBean PlatformTransactionManager transactionManager;
  @Autowired MockMvc mvc;
  @Autowired ObjectMapper json;

  @Test
  void openApiDescribesConcreteGuardRoutesAndNewEventFieldsWithoutARealDatabase() throws Exception {
    var response =
        mvc.perform(get("/v3/api-docs"))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString();
    JsonNode api = json.readTree(response);
    assertThat(
            api.at(
                "/paths/~1api~1v1~1guard~1runtime/put/requestBody/content/application~1json/schema/properties/model_mode/enum"))
        .containsExactly(
            json.valueToTree("disabled"),
            json.valueToTree("optional"),
            json.valueToTree("required"));
    assertThat(
            api.at("/paths/~1api~1v1~1guard~1custom-rules~1{id}/put/responses/503/description")
                .asText())
        .contains("GUARD_UNAVAILABLE");
    assertThat(api.at("/paths/~1api~1v1~1guard~1clients~1{id}/patch").isObject()).isTrue();
    assertThat(api.at("/components/schemas/Event/properties").has("sendAction")).isTrue();
    assertThat(api.at("/components/schemas/Event/properties").has("fileCount")).isTrue();
    assertThat(api.at("/components/schemas/Event/properties").has("imageCount")).isTrue();
    assertThat(api.at("/components/schemas/CreateDetectorEvent/properties/send_action/enum"))
        .contains(json.valueToTree("forced"));
    mvc.perform(get("/api/v1/guard/runtime"))
        .andExpect(status().isServiceUnavailable())
        .andExpect(jsonPath("$.code").value("GUARD_UNAVAILABLE"));
  }
}
