package com.example.securitydashboard.detector;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.example.securitydashboard.common.ApiException;
import com.example.securitydashboard.configuration.ConfigurationService;
import com.example.securitydashboard.detector.model.CreateDetectorEvent;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.validation.Validation;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;

class DetectorSendActionTest {
  private final ObjectMapper json = new ObjectMapper().findAndRegisterModules();

  private ObjectNode payload() throws Exception {
    try (var input = getClass().getResourceAsStream("/detector/producer-inspect.json")) {
      var fixture = json.readTree(input);
      var body =
          json.createObjectNode()
              .put("source_id", "demo")
              .put("person_id", "demo")
              .put("version_id", "demo")
              .put("text", fixture.path("text").asText());
      body.set("result", fixture.path("result"));
      return body;
    }
  }

  @Test
  void sendActionIsOptionalValidatedAndPartOfReplayIdentity() throws Exception {
    try (var factory = Validation.buildDefaultValidatorFactory()) {
      var normalizer =
          new DetectorEventNormalizer(
              json,
              factory.getValidator(),
              mock(ConfigurationService.class),
              Clock.fixed(Instant.parse("2026-10-30T00:00:00Z"), ZoneOffset.UTC));
      var body = payload();
      var omitted = normalizer.normalize(json.treeToValue(body, CreateDetectorEvent.class));
      body.putNull("send_action");
      var explicitNull = normalizer.normalize(json.treeToValue(body, CreateDetectorEvent.class));
      assertThat(explicitNull.contentHash()).isEqualTo(omitted.contentHash());
      for (String action : new String[] {"normal", "confirmed", "forced"}) {
        body.put("send_action", action);
        var normalized = normalizer.normalize(json.treeToValue(body, CreateDetectorEvent.class));
        assertThat(json.readTree(normalized.envelope()).path("send_action").asText())
            .isEqualTo(action);
        assertThat(normalized.contentHash()).isNotEqualTo(omitted.contentHash());
      }
      body.put("send_action", "unsupported");
      assertThatThrownBy(
              () -> normalizer.normalize(json.treeToValue(body, CreateDetectorEvent.class)))
          .isInstanceOf(ApiException.class);
    }
  }
}
