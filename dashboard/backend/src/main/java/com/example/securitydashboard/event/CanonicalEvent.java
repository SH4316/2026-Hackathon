package com.example.securitydashboard.event;

import com.example.securitydashboard.api.ApiModels;
import com.example.securitydashboard.common.ApiException;
import com.example.securitydashboard.common.InputValidation;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.*;

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
    List<Span> detections) {
  public record Span(int start, int end, String text, List<String> tagIds) {}

  public static CanonicalEvent from(ApiModels.CreateEvent request, Clock clock) {
    return from(request, clock, false);
  }

  // InspectResponse permits empty text when there are no findings. Legacy /events does not.
  public static CanonicalEvent from(
      ApiModels.CreateEvent request, Clock clock, boolean allowEmptyText) {
    String prompt = request.prompt();
    if (!allowEmptyText && prompt.isBlank()) throw ApiException.invalid("prompt", "프롬프트를 입력해 주세요.");
    int length = prompt.codePointCount(0, prompt.length());
    if (length > 200000) throw ApiException.invalid("prompt", "프롬프트는 유니코드 문자 200000자 이하여야 합니다.");
    if (InputValidation.hasUnpairedSurrogate(prompt))
      throw ApiException.invalid("prompt", "올바른 유니코드 문자열을 입력해 주세요.");
    Instant time = null;
    if (request.occurredAt() != null) {
      time = InputValidation.parseInstant(request.occurredAt(), "occurredAt");
      if (time.isAfter(clock.instant().plus(5, ChronoUnit.MINUTES)))
        throw ApiException.invalid("occurredAt", "현재 시각보다 5분 이상 미래인 이벤트는 등록할 수 없습니다.");
      InputValidation.validateTime(time, "occurredAt");
      time = time.truncatedTo(ChronoUnit.MICROS);
    }
    String model = request.model() == null ? null : request.model().strip();
    if (model != null && model.isEmpty()) model = null;
    if (model != null
        && (model.codePointCount(0, model.length()) > 120
            || InputValidation.hasUnpairedSurrogate(model)))
      throw ApiException.invalid("model", "모델명은 120자 이하여야 합니다.");
    if (request.policyStateId() != null)
      InputValidation.validateId(request.policyStateId(), "policyStateId");
    var merged =
        new TreeMap<Range, TreeSet<String>>(
            Comparator.comparingInt(Range::start).thenComparingInt(Range::end));
    var texts = new HashMap<Range, String>();
    for (var detection : request.detections()) {
      if (detection.start() < 0 || detection.end() <= detection.start() || detection.end() > length)
        throw ApiException.invalid("detections", "탐지 범위는 프롬프트의 유니코드 문자 범위 안에 있어야 합니다.");
      String actual =
          prompt.substring(
              prompt.offsetByCodePoints(0, detection.start()),
              prompt.offsetByCodePoints(0, detection.end()));
      if (!actual.equals(detection.text()))
        throw ApiException.invalid("detections", "탐지 원문이 프롬프트의 지정 범위와 일치하지 않습니다.");
      Range range = new Range(detection.start(), detection.end());
      texts.put(range, actual);
      var tags = merged.computeIfAbsent(range, key -> new TreeSet<>());
      for (String tag : detection.tagIds()) {
        InputValidation.validateId(tag, "tagIds");
        tags.add(tag);
      }
    }
    List<Span> spans =
        merged.entrySet().stream()
            .map(
                e ->
                    new Span(
                        e.getKey().start(),
                        e.getKey().end(),
                        texts.get(e.getKey()),
                        List.copyOf(e.getValue())))
            .toList();
    return new CanonicalEvent(
        request.sourceId(),
        request.eventId(),
        request.personId(),
        request.versionId(),
        prompt,
        time,
        request.service() == null
            ? "unspecified"
            : InputValidation.normalizeService(request.service()),
        model,
        request.policyStateId(),
        spans);
  }

  private record Range(int start, int end) {}

  boolean matches(ApiModels.Event event) {
    List<Span> spans =
        event.detections().stream()
            .map(
                d ->
                    new Span(
                        d.start(),
                        d.end(),
                        d.text(),
                        d.tags().stream().map(ApiModels.DetectionTag::id).sorted().toList()))
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
