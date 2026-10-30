package com.example.securitydashboard.configuration;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.example.securitydashboard.DashboardApplication;
import com.example.securitydashboard.common.ApiException;
import com.example.securitydashboard.configuration.model.Tag;
import com.example.securitydashboard.configuration.model.VersionSummary;
import com.example.securitydashboard.guard.GuardProxyService;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;

@SpringBootTest(classes = DashboardApplication.class, properties = {
  "spring.autoconfigure.exclude=org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration,org.springframework.boot.autoconfigure.flyway.FlywayAutoConfiguration"
})
@AutoConfigureMockMvc
class ConfigurationRegexApiTest {
  @MockitoBean JdbcTemplate jdbc;
  @MockitoBean NamedParameterJdbcTemplate namedJdbc;
  @MockitoBean PlatformTransactionManager transactions;
  @MockitoBean ConfigurationRepository repository;
  @MockitoBean GuardProxyService guard;
  @Autowired MockMvc mvc;
  @Autowired ObjectMapper json;

  @BeforeEach
  void setup() {
    when(transactions.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
    when(repository.findVersion("v1")).thenReturn(Optional.of(
        new VersionSummary("v1", "설정", "DRAFT", false, 3, Instant.EPOCH, null)));
    when(repository.tags("v1")).thenReturn(List.of(
        new Tag("tag", "사번", "", List.of(), "", null, "before", "#123456", null, 0, true)));
    when(repository.policies("v1")).thenReturn(List.of());
    when(repository.lockVersion("v1")).thenReturn(Optional.of(new VersionState("DRAFT", 3)));
    when(guard.isServerConfigured()).thenReturn(true);
  }

  @ParameterizedTest
  @ValueSource(booleans = {false, true})
  void rejectedRegexReturns400WithKoreanFieldErrorsAndNoWrites(boolean details) throws Exception {
    when(guard.forward(eq("org/regex/check"), isNull(), eq(HttpMethod.POST), any(), isNull()))
        .thenReturn(ResponseEntity.ok(json.writeValueAsBytes(Map.of("results", List.of(
            Map.of("tag_id", "tag", "ok", false, "reason", "matches_empty"))))));
    mvc.perform(put(path(details)).contentType(MediaType.APPLICATION_JSON)
            .content(json.writeValueAsBytes(body(details))))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("INVALID_INPUT"))
        .andExpect(jsonPath("$.fieldErrors['tags.tag.pythonRegex']")
            .value("빈 문자열과 일치하는 정규식은 사용할 수 없습니다."));
    verify(guard).forward(eq("org/regex/check"), isNull(), eq(HttpMethod.POST), argThat(bytes -> {
      try {
        assertThat(json.readTree(bytes)).isEqualTo(json.valueToTree(
            Map.of("patterns", List.of(Map.of("tag_id", "tag", "pattern", "x*")))));
        return true;
      } catch (Exception exception) {
        return false;
      }
    }), isNull());
    assertNoWrites();
  }

  @ParameterizedTest
  @ValueSource(booleans = {false, true})
  void unavailableGuardReturns503WithoutSaving(boolean details) throws Exception {
    when(guard.forward(eq("org/regex/check"), isNull(), eq(HttpMethod.POST), any(), isNull()))
        .thenThrow(new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "GUARD_UNAVAILABLE", "검사 서버에 연결할 수 없습니다."));
    mvc.perform(put(path(details)).contentType(MediaType.APPLICATION_JSON)
            .content(json.writeValueAsBytes(body(details))))
        .andExpect(status().isServiceUnavailable())
        .andExpect(jsonPath("$.code").value("GUARD_UNAVAILABLE"));
    assertNoWrites();
  }

  @ParameterizedTest
  @ValueSource(booleans = {false, true})
  void unsetServerUrlAllowsSaveWithoutRegexValidation(boolean details) throws Exception {
    when(guard.isServerConfigured()).thenReturn(false);
    mvc.perform(put(path(details)).contentType(MediaType.APPLICATION_JSON)
            .content(json.writeValueAsBytes(body(details))))
        .andExpect(status().isOk());
    verify(guard, never()).forward(anyString(), any(), any(), any(), any());
    if (details) verify(repository).updateTagDetails(eq("v1"), any());
    else verify(repository).replaceCatalog(eq("v1"), anyList(), anyList());
  }

  private String path(boolean details) {
    return "/api/v1/config-versions/v1" + (details ? "/tags/tag" : "");
  }

  private Map<String, Object> body(boolean details) {
    if (details) return Map.of("revision", 3, "name", "사번", "pythonRegex", "x*");
    return Map.of("revision", 3, "name", "설정", "tags",
        List.of(Map.of("id", "tag", "name", "사번", "pythonRegex", "x*")), "policyStates", List.of());
  }

  private void assertNoWrites() {
    verify(repository, never()).lockActiveId();
    verify(repository, never()).replaceCatalog(anyString(), anyList(), anyList());
    verify(repository, never()).updateTagDetails(anyString(), any());
    verify(repository, never()).updateVersionName(anyString(), anyString());
  }
}
