package com.example.securitydashboard.event;

import com.example.securitydashboard.common.ApiException;
import com.example.securitydashboard.common.InputValidation;
import com.example.securitydashboard.event.model.CreateDetection;
import com.example.securitydashboard.event.model.CreateEvent;
import com.example.securitydashboard.event.model.DetectionTag;
import com.example.securitydashboard.event.model.Event;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Objects;
import java.util.TreeMap;
import java.util.TreeSet;

public record CanonicalEvent(
    String sourceId,
    String eventId,
    String personId,
    String versionId,
    String prompt,
    Instant occurredAt,
    String service,
    String model,
    String policyStateId,
    List<CanonicalSpan> detections) {
  public static CanonicalEvent from(CreateEvent request, Clock clock) {
    return from(request, clock, false);
  }

  // InspectResponse permits empty text when there are no findings. Legacy /events does not.
  public static CanonicalEvent from(CreateEvent request, Clock clock, boolean allowEmptyText) {
    String prompt = request.prompt();
    validatePrompt(prompt, allowEmptyText);
    Instant occurredAt = normalizeTime(request.occurredAt(), clock);
    String model = normalizeModel(request.model());
    if (request.policyStateId() != null) {
      InputValidation.validateId(request.policyStateId(), "policyStateId");
    }
    List<CanonicalSpan> spans = mergeDetections(prompt, request.detections());
    return new CanonicalEvent(
        request.sourceId(),
        request.eventId(),
        request.personId(),
        request.versionId(),
        prompt,
        occurredAt,
        request.service() == null
            ? "unspecified"
            : InputValidation.normalizeService(request.service()),
        model,
        request.policyStateId(),
        spans);
  }

  private static void validatePrompt(String prompt, boolean allowEmptyText) {
    if (!allowEmptyText && prompt.isBlank()) {
      throw ApiException.invalid("prompt", "프롬프트를 입력해 주세요.");
    }
    if (prompt.codePointCount(0, prompt.length()) > 200000) {
      throw ApiException.invalid("prompt", "프롬프트는 유니코드 문자 200000자 이하여야 합니다.");
    }
    if (InputValidation.hasUnpairedSurrogate(prompt)) {
      throw ApiException.invalid("prompt", "올바른 유니코드 문자열을 입력해 주세요.");
    }
  }

  private static Instant normalizeTime(String occurredAt, Clock clock) {
    if (occurredAt == null) {
      return null;
    }
    Instant time = InputValidation.parseInstant(occurredAt, "occurredAt");
    if (time.isAfter(clock.instant().plus(5, ChronoUnit.MINUTES))) {
      throw ApiException.invalid("occurredAt", "현재 시각보다 5분 이상 미래인 이벤트는 등록할 수 없습니다.");
    }
    InputValidation.validateTime(time, "occurredAt");
    return time.truncatedTo(ChronoUnit.MICROS);
  }

  private static String normalizeModel(String value) {
    String model = value == null ? null : value.strip();
    if (model != null && model.isEmpty()) {
      return null;
    }
    if (model != null
        && (model.codePointCount(0, model.length()) > 120
            || InputValidation.hasUnpairedSurrogate(model))) {
      throw ApiException.invalid("model", "모델명은 120자 이하여야 합니다.");
    }
    return model;
  }

  private static List<CanonicalSpan> mergeDetections(
      String prompt, List<CreateDetection> detections) {
    int length = prompt.codePointCount(0, prompt.length());
    var merged =
        new TreeMap<DetectionRange, TreeSet<String>>(
            Comparator.comparingInt(DetectionRange::start).thenComparingInt(DetectionRange::end));
    var texts = new HashMap<DetectionRange, String>();
    for (var detection : detections) {
      if (detection.start() < 0
          || detection.end() <= detection.start()
          || detection.end() > length) {
        throw ApiException.invalid("detections", "탐지 범위는 프롬프트의 유니코드 문자 범위 안에 있어야 합니다.");
      }
      String actual =
          prompt.substring(
              prompt.offsetByCodePoints(0, detection.start()),
              prompt.offsetByCodePoints(0, detection.end()));
      if (!actual.equals(detection.text())) {
        throw ApiException.invalid("detections", "탐지 원문이 프롬프트의 지정 범위와 일치하지 않습니다.");
      }
      DetectionRange range = new DetectionRange(detection.start(), detection.end());
      texts.put(range, actual);
      var tags = merged.computeIfAbsent(range, key -> new TreeSet<>());
      for (String tag : detection.tagIds()) {
        InputValidation.validateId(tag, "tagIds");
        tags.add(tag);
      }
    }
    return merged.entrySet().stream()
        .map(
            entry ->
                new CanonicalSpan(
                    entry.getKey().start(),
                    entry.getKey().end(),
                    texts.get(entry.getKey()),
                    List.copyOf(entry.getValue())))
        .toList();
  }

  boolean matches(Event event) {
    List<CanonicalSpan> spans =
        event.detections().stream()
            .map(
                detection ->
                    new CanonicalSpan(
                        detection.start(),
                        detection.end(),
                        detection.text(),
                        detection.tags().stream().map(DetectionTag::id).sorted().toList()))
            .toList();
    return sourceId.equals(event.sourceId())
        && eventId.equals(event.eventId())
        && personId.equals(event.personId())
        && versionId.equals(event.versionId())
        && prompt.equals(event.prompt())
        && (occurredAt == null || occurredAt.equals(event.occurredAt()))
        && service.equals(event.service())
        && Objects.equals(model, event.model())
        && Objects.equals(policyStateId, event.policyStateId())
        && detections.equals(spans);
  }
}
