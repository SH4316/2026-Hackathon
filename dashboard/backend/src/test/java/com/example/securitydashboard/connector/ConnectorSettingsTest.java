package com.example.securitydashboard.connector;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.example.securitydashboard.common.ApiException;
import com.example.securitydashboard.connector.model.DetectorSettings;
import com.example.securitydashboard.connector.model.UpdateDetectorSettings;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.PlatformTransactionManager;

class ConnectorSettingsTest {
  @Test
  void sharedPolicyMapIsNormalizedAndOmittedMapPreservesExistingSettings() {
    var repository = mock(ConnectorRepository.class);
    var now = Instant.parse("2026-10-30T00:00:00Z");
    var policies = new LinkedHashMap<String, String>();
    policies.put("allow", null);
    policies.put("warn", "review");
    policies.put("block", null);
    var current = new DetectorSettings("full", Map.of(), "mask", true, policies, 4, now);
    when(repository.settings(anyBoolean())).thenReturn(current);
    var service = new ConnectorService(repository, Clock.fixed(now, ZoneOffset.UTC),
        mock(PlatformTransactionManager.class));
    service.updateSettings(new UpdateDetectorSettings(4, "off", Map.of(), "warn", false, null));
    verify(repository).updateSettings("off", Map.of(), "warn", false, policies, 5, now);

    service.updateSettings(new UpdateDetectorSettings(4, "full", Map.of(), "mask", true,
        Map.of("warn", "review")));
    verify(repository).updateSettings("full", Map.of(), "mask", true, policies, 5, now);
  }

  @Test
  void invalidPolicyMapAndStaleRevisionNeverWriteSettings() {
    var repository = mock(ConnectorRepository.class);
    when(repository.settings(true)).thenReturn(
        new DetectorSettings("full", Map.of(), "mask", true, Map.of(), 4, null));
    var service = new ConnectorService(repository, Clock.systemUTC(), mock(PlatformTransactionManager.class));
    for (var map : java.util.List.of(Map.of("other", "state"), Map.of("block", "invalid id"))) {
      assertThatThrownBy(() -> service.updateSettings(
          new UpdateDetectorSettings(4, "full", Map.of(), "mask", true, map)))
          .isInstanceOfSatisfying(ApiException.class, error -> assertThat(error.status().value()).isEqualTo(400));
    }
    assertThatThrownBy(() -> service.updateSettings(
        new UpdateDetectorSettings(3, "full", Map.of(), "mask", true, Map.of())))
        .isInstanceOfSatisfying(ApiException.class, error -> assertThat(error.status().value()).isEqualTo(409));
    verify(repository, never()).updateSettings(anyString(), anyMap(), anyString(), anyBoolean(), anyMap(), anyInt(), any());
  }
}
