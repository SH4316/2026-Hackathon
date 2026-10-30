package com.example.securitydashboard.event;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.example.securitydashboard.common.ApiException;
import com.example.securitydashboard.event.model.CreateDetection;
import com.example.securitydashboard.event.model.CreateEvent;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.api.Test;

class CanonicalEventTest {
  private final Clock clock = Clock.fixed(Instant.parse("2026-10-30T12:00:00Z"), ZoneOffset.UTC);

  private CreateEvent input(String prompt, List<CreateDetection> detections, String time) {
    return new CreateEvent(
        "source",
        "event",
        "person",
        "version",
        prompt,
        detections,
        time,
        " ChatGPT ",
        " model ",
        null);
  }

  @Test
  void mergesUnicodeRangesAndTagsWithoutChangingPrompt() {
    var value =
        CanonicalEvent.from(
            input(
                " A😀BC ",
                List.of(
                    new CreateDetection(2, 3, "😀", List.of("b", "a")),
                    new CreateDetection(2, 3, "😀", List.of("c", "a")),
                    new CreateDetection(2, 4, "😀B", List.of("b"))),
                null),
            clock);
    assertThat(value.prompt()).isEqualTo(" A😀BC ");
    assertThat(value.service()).isEqualTo("chatgpt");
    assertThat(value.model()).isEqualTo("model");
    assertThat(value.occurredAt()).isNull();
    assertThat(value.detections())
        .containsExactly(
            new CanonicalSpan(2, 3, "😀", List.of("a", "b", "c")),
            new CanonicalSpan(2, 4, "😀B", List.of("b")));
  }

  @Test
  void rejectsUtf16OffsetsAndNormalizingSourceText() {
    assertThatThrownBy(
            () ->
                CanonicalEvent.from(
                    input("A😀BC", List.of(new CreateDetection(1, 3, "😀", List.of("a"))), null),
                    clock))
        .isInstanceOf(ApiException.class);
    assertThatThrownBy(
            () ->
                CanonicalEvent.from(
                    input(" é ", List.of(new CreateDetection(1, 3, "é", List.of("a"))), null),
                    clock))
        .isInstanceOf(ApiException.class);
  }

  @Test
  void normalizesMicrosecondsAndAllowsZeroDetections() {
    var value =
        CanonicalEvent.from(input("안전", List.of(), "2026-10-30T09:00:00.123456789+09:00"), clock);
    assertThat(value.occurredAt()).isEqualTo(Instant.parse("2026-10-30T00:00:00.123456Z"));
    assertThat(value.detections()).isEmpty();
    assertThatThrownBy(
            () -> CanonicalEvent.from(input("a", List.of(), "2099-01-01T00:00:00Z"), clock))
        .isInstanceOf(ApiException.class);
  }
}
