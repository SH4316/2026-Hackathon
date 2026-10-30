package com.example.securitydashboard;

import static org.assertj.core.api.Assertions.*;

import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;

class CanonicalEventTest {
  private final Clock clock = Clock.fixed(Instant.parse("2026-10-30T12:00:00Z"), ZoneOffset.UTC);

  private ApiModels.CreateEvent input(
      String prompt, List<ApiModels.CreateDetection> detections, String time) {
    return new ApiModels.CreateEvent(
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
                    new ApiModels.CreateDetection(2, 3, "😀", List.of("b", "a")),
                    new ApiModels.CreateDetection(2, 3, "😀", List.of("c", "a")),
                    new ApiModels.CreateDetection(2, 4, "😀B", List.of("b"))),
                null),
            clock);
    assertThat(value.prompt()).isEqualTo(" A😀BC ");
    assertThat(value.service()).isEqualTo("chatgpt");
    assertThat(value.model()).isEqualTo("model");
    assertThat(value.occurredAt()).isNull();
    assertThat(value.detections())
        .containsExactly(
            new CanonicalEvent.Span(2, 3, "😀", List.of("a", "b", "c")),
            new CanonicalEvent.Span(2, 4, "😀B", List.of("b")));
  }

  @Test
  void rejectsUtf16OffsetsAndNormalizingSourceText() {
    assertThatThrownBy(
            () ->
                CanonicalEvent.from(
                    input(
                        "A😀BC",
                        List.of(new ApiModels.CreateDetection(1, 3, "😀", List.of("a"))),
                        null),
                    clock))
        .isInstanceOf(ApiException.class);
    assertThatThrownBy(
            () ->
                CanonicalEvent.from(
                    input(
                        " é ",
                        List.of(new ApiModels.CreateDetection(1, 3, "é", List.of("a"))),
                        null),
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

  @Test
  void validatesTreeAndDefaultsWithoutInferringMeaning() {
    var normalized =
        ConfigurationService.normalizeTags(
            List.of(
                new ApiModels.Tag("root", "정책", null, null, null, null, null, null),
                new ApiModels.Tag("child", "같은 이름", null, null, null, "#abcdef", "root", 1)));
    assertThat(normalized.getFirst().examples()).isEmpty();
    assertThat(normalized.getFirst().color()).isEqualTo("#64748B");
    assertThat(normalized.get(1).color()).isEqualTo("#ABCDEF");
    assertThatThrownBy(
            () ->
                ConfigurationService.normalizeTags(
                    List.of(
                        new ApiModels.Tag("a", "A", null, null, null, null, "b", 0),
                        new ApiModels.Tag("b", "B", null, null, null, null, "a", 0))))
        .isInstanceOf(ApiException.class);
    assertThatThrownBy(
            () ->
                ConfigurationService.normalizeTags(
                    List.of(new ApiModels.Tag("a", "A", null, null, null, null, "missing", 0))))
        .isInstanceOf(ApiException.class);
    var deep = new ArrayList<ApiModels.Tag>();
    for (int i = 0; i < 33; i++)
      deep.add(
          new ApiModels.Tag(
              "n" + i, "N", null, null, null, null, i == 0 ? null : "n" + (i - 1), i));
    assertThatThrownBy(() -> ConfigurationService.normalizeTags(deep))
        .isInstanceOf(ApiException.class);
  }
}
