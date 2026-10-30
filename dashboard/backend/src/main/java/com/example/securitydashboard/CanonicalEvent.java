package com.example.securitydashboard;

import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.util.*;

record CanonicalEvent(
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
  record Span(int start, int end, String text, List<String> tagIds) {}

  static CanonicalEvent from(ApiModels.CreateEvent request, Clock clock) {
    String prompt = request.prompt();
    if (prompt.isBlank()) throw ApiException.invalid("prompt", "프롬프트를 입력해 주세요.");
    int length = prompt.codePointCount(0, prompt.length());
    if (length > 200000) throw ApiException.invalid("prompt", "프롬프트는 유니코드 문자 200000자 이하여야 합니다.");
    if (hasUnpairedSurrogate(prompt))
      throw ApiException.invalid("prompt", "올바른 유니코드 문자열을 입력해 주세요.");
    Instant time = null;
    if (request.occurredAt() != null) {
      time = parseInstant(request.occurredAt(), "occurredAt");
      if (time.isAfter(clock.instant().plus(5, ChronoUnit.MINUTES)))
        throw ApiException.invalid("occurredAt", "현재 시각보다 5분 이상 미래인 이벤트는 등록할 수 없습니다.");
      validateTime(time, "occurredAt");
      time = time.truncatedTo(ChronoUnit.MICROS);
    }
    String model = request.model() == null ? null : request.model().strip();
    if (model != null && model.isEmpty()) model = null;
    if (model != null
        && (model.codePointCount(0, model.length()) > 120 || hasUnpairedSurrogate(model)))
      throw ApiException.invalid("model", "모델명은 120자 이하여야 합니다.");
    if (request.policyStateId() != null)
      EventFilter.validateId(request.policyStateId(), "policyStateId");
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
        EventFilter.validateId(tag, "tagIds");
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
        request.service() == null ? "unspecified" : normalizeService(request.service()),
        model,
        request.policyStateId(),
        spans);
  }

  private record Range(int start, int end) {}

  static boolean hasUnpairedSurrogate(String value) {
    for (int i = 0; i < value.length(); i++) {
      char c = value.charAt(i);
      if (Character.isHighSurrogate(c)) {
        if (i + 1 >= value.length() || !Character.isLowSurrogate(value.charAt(++i))) return true;
      } else if (Character.isLowSurrogate(c)) return true;
    }
    return false;
  }

  static String normalizeService(String value) {
    String service = value.strip().toLowerCase(Locale.ROOT);
    if (!service.matches("[a-z0-9_-]{1,64}"))
      throw ApiException.invalid("service", "서비스는 영문 소문자, 숫자, 하이픈, 밑줄로 1~64자여야 합니다.");
    return service;
  }

  static Instant parseInstant(String value, String field) {
    try {
      return OffsetDateTime.parse(value).toInstant();
    } catch (DateTimeParseException | ArithmeticException exception) {
      throw ApiException.invalid(field, "시간대가 포함된 ISO 8601 시각을 입력해 주세요.");
    }
  }

  static void validateTime(Instant time, String field) {
    if (time.isBefore(Instant.parse("1000-01-01T00:00:00Z"))
        || !time.isBefore(Instant.parse("+10000-01-01T00:00:00Z")))
      throw ApiException.invalid(field, "1000년부터 9999년 사이의 시각을 입력해 주세요.");
  }

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
