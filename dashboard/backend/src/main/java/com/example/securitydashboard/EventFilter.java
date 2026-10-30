package com.example.securitydashboard;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.Set;
import org.springframework.util.MultiValueMap;

record EventFilter(Instant from, Instant to, String service, String personId, Category category, PolicyState policyState) {
    static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
    private static final Set<String> COMMON = Set.of("from", "to", "service", "personId", "category", "policyState");

    static EventFilter parse(MultiValueMap<String, String> query, Clock clock, Set<String> extra) {
        query.forEach((name, values) -> {
            if (!COMMON.contains(name) && !extra.contains(name)) {
                throw ApiException.invalid(name, "지원하지 않는 검색 조건입니다.");
            }
            if (values.size() != 1) throw ApiException.invalid(name, "검색 조건은 한 번만 입력해 주세요.");
        });
        var today = clock.instant().atZone(SEOUL).toLocalDate();
        String fromText = value(query, "from"), toText = value(query, "to");
        Instant from = fromText == null ? today.minusDays(6).atStartOfDay(SEOUL).toInstant() : CanonicalEvent.parseInstant(fromText, "from");
        Instant to = toText == null ? today.plusDays(1).atStartOfDay(SEOUL).toInstant() : CanonicalEvent.parseInstant(toText, "to");
        if (!from.isBefore(to)) throw ApiException.invalid("to", "종료 시각은 시작 시각보다 뒤여야 합니다.");
        if (Duration.between(from, to).compareTo(Duration.ofDays(366)) > 0) {
            throw ApiException.invalid("to", "검색 기간은 최대 366일입니다.");
        }
        // Keep parameters representable by MySQL without overflowing JDBC timestamps.
        if (from.isBefore(Instant.parse("1000-01-01T00:00:00Z")) || !to.isBefore(Instant.parse("+10000-01-01T00:00:00Z"))) {
            throw ApiException.invalid("from", "검색 시각은 1000년부터 9999년 사이여야 합니다.");
        }
        String service = value(query, "service");
        String personId = value(query, "personId");
        if (personId != null) validateId(personId, "personId");
        return new EventFilter(from, to, service == null ? null : CanonicalEvent.normalizeService(service), personId,
            enumeration(query, "category", Category.class), enumeration(query, "policyState", PolicyState.class));
    }

    static String value(MultiValueMap<String, String> query, String name) {
        String value = query.getFirst(name);
        return value == null || value.isBlank() ? null : value.strip();
    }

    static void validateId(String id, String field) {
        if (!id.matches(ApiModels.ID_PATTERN)) throw ApiException.invalid(field, "ID는 영문, 숫자, 하이픈, 밑줄로 1~80자여야 합니다.");
    }

    private static <T extends Enum<T>> T enumeration(MultiValueMap<String, String> query, String name, Class<T> type) {
        String value = value(query, name);
        if (value == null) return null;
        try {
            return Enum.valueOf(type, value);
        } catch (IllegalArgumentException exception) {
            throw ApiException.invalid(name, "지원하지 않는 검색 값입니다.");
        }
    }
}
