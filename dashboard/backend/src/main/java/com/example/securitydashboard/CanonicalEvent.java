package com.example.securitydashboard;

import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Objects;

record CanonicalEvent(String sourceId, String eventId, String personId, Instant occurredAt, String service,
                      String model, PolicyState policyState, List<ApiModels.Finding> findings) {
    static CanonicalEvent from(ApiModels.CreateEvent request, Clock clock) {
        Instant time = parseInstant(request.occurredAt(), "occurredAt");
        if (time.isAfter(clock.instant().plus(5, ChronoUnit.MINUTES))) {
            throw ApiException.invalid("occurredAt", "현재 시각보다 5분 이상 미래인 이벤트는 등록할 수 없습니다.");
        }
        // MySQL DATETIME supports years 1000 through 9999.
        if (time.isBefore(Instant.parse("1000-01-01T00:00:00Z")) || !time.isBefore(Instant.parse("+10000-01-01T00:00:00Z"))) {
            throw ApiException.invalid("occurredAt", "1000년부터 9999년 사이의 시각을 입력해 주세요.");
        }
        var findings = request.findings() == null ? List.<ApiModels.CreateFinding>of() : request.findings();
        if (findings.isEmpty() && request.policyState() == null) {
            throw ApiException.invalid("findings", "탐지 항목 또는 학습 정책 상태를 하나 이상 입력해 주세요.");
        }
        var seen = new HashSet<Category>();
        for (var finding : findings) {
            if (!seen.add(finding.category())) {
                throw ApiException.invalid("findings", "동일한 탐지 유형은 한 번만 입력할 수 있습니다.");
            }
        }
        String model = request.model() == null ? null : request.model().strip();
        if (model != null && model.isEmpty()) model = null;
        if (model != null && model.codePointCount(0, model.length()) > 120) {
            throw ApiException.invalid("model", "모델명은 120자 이하여야 합니다.");
        }
        var normalized = findings.stream().map(f -> new ApiModels.Finding(f.category(), f.quantity()))
            .sorted(Comparator.comparing(ApiModels.Finding::category)).toList();
        return new CanonicalEvent(request.sourceId(), request.eventId(), request.personId(),
            time.truncatedTo(ChronoUnit.MICROS), normalizeService(request.service()), model, request.policyState(), normalized);
    }

    static String normalizeService(String value) {
        String service = value.strip().toLowerCase(Locale.ROOT);
        if (!service.matches("[a-z0-9_-]{1,64}")) {
            throw ApiException.invalid("service", "서비스는 영문 소문자, 숫자, 하이픈, 밑줄로 1~64자여야 합니다.");
        }
        return service;
    }

    static Instant parseInstant(String value, String field) {
        try {
            return OffsetDateTime.parse(value).toInstant();
        } catch (DateTimeParseException | ArithmeticException exception) {
            throw ApiException.invalid(field, "시간대가 포함된 ISO 8601 시각을 입력해 주세요.");
        }
    }

    boolean matches(ApiModels.Event event) {
        return sourceId.equals(event.sourceId()) && eventId.equals(event.eventId())
            && personId.equals(event.personId()) && occurredAt.equals(event.occurredAt())
            && service.equals(event.service()) && Objects.equals(model, event.model())
            && policyState == event.policyState() && findings.equals(event.findings());
    }
}
