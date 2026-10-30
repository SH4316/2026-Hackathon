package com.example.securitydashboard;

import java.time.*;
import java.util.*;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;

record EventFilter(
    Instant from,
    Instant to,
    String versionId,
    String service,
    String personId,
    String tagId,
    String policyStateId,
    Boolean hasDetections,
    String q,
    String interval,
    boolean unmapped) {
  static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
  private static final Set<String> COMMON =
      Set.of(
          "from",
          "to",
          "versionId",
          "service",
          "personId",
          "tagId",
          "policyStateId",
          "hasDetections",
          "q",
          "interval",
          "unmapped");

  static EventFilter parse(MultiValueMap<String, String> query, Clock clock, Set<String> extra) {
    query.forEach(
        (name, values) -> {
          if (!COMMON.contains(name) && !extra.contains(name))
            throw ApiException.invalid(name, "지원하지 않는 검색 조건입니다.");
          if (values.size() != 1) throw ApiException.invalid(name, "검색 조건은 한 번만 입력해 주세요.");
        });
    var today = clock.instant().atZone(SEOUL).toLocalDate();
    String fromText = value(query, "from"), toText = value(query, "to");
    Instant from =
        fromText == null
            ? today.minusDays(6).atStartOfDay(SEOUL).toInstant()
            : CanonicalEvent.parseInstant(fromText, "from");
    Instant to =
        toText == null
            ? today.plusDays(1).atStartOfDay(SEOUL).toInstant()
            : CanonicalEvent.parseInstant(toText, "to");
    if (!from.isBefore(to)) throw ApiException.invalid("to", "종료 시각은 시작 시각보다 뒤여야 합니다.");
    if (Duration.between(from, to).compareTo(Duration.ofDays(366)) > 0)
      throw ApiException.invalid("to", "검색 기간은 최대 366일입니다.");
    CanonicalEvent.validateTime(from, "from");
    CanonicalEvent.validateTime(to, "to");
    String interval = value(query, "interval");
    if (interval == null) interval = "day";
    if (!Set.of("day", "hour").contains(interval))
      throw ApiException.invalid("interval", "집계 간격은 day 또는 hour여야 합니다.");
    if (interval.equals("hour") && Duration.between(from, to).compareTo(Duration.ofDays(31)) > 0)
      throw ApiException.invalid("to", "시간별 집계 기간은 최대 31일입니다.");
    String version = id(query, "versionId"),
        person = id(query, "personId"),
        tag = id(query, "tagId"),
        policy = id(query, "policyStateId");
    Boolean has = bool(query, "hasDetections");
    String unmapped = value(query, "unmapped");
    if (unmapped != null && !unmapped.equals("true"))
      throw ApiException.invalid("unmapped", "미분류 조건은 true만 사용할 수 있습니다.");
    if (tag != null && unmapped != null)
      throw ApiException.invalid("unmapped", "태그와 미분류 조건을 동시에 사용할 수 없습니다.");
    String q = query.getFirst("q");
    if (q != null && q.isEmpty()) q = null;
    if (q != null) ConfigurationService.text(q, 4000, "q");
    String service = value(query, "service");
    return new EventFilter(
        from,
        to,
        version,
        service == null ? null : CanonicalEvent.normalizeService(service),
        person,
        tag,
        policy,
        has,
        q,
        interval,
        unmapped != null);
  }

  static EventFilter parse(ApiModels.Filters input, Clock clock) {
    var query = new LinkedMultiValueMap<String, String>();
    if (input != null) {
      add(query, "from", input.from());
      add(query, "to", input.to());
      add(query, "versionId", input.versionId());
      add(query, "service", input.service());
      add(query, "personId", input.personId());
      add(query, "tagId", input.tagId());
      add(query, "policyStateId", input.policyStateId());
      add(query, "hasDetections", input.hasDetections());
      add(query, "q", input.q());
      add(query, "interval", input.interval());
      add(query, "unmapped", input.unmapped());
    }
    return parse(query, clock, Set.of());
  }

  EventFilter withVersion(String id) {
    return new EventFilter(
        from,
        to,
        id,
        service,
        personId,
        tagId,
        policyStateId,
        hasDetections,
        q,
        interval,
        unmapped);
  }

  ApiModels.Filters snapshot() {
    return new ApiModels.Filters(
        from.toString(),
        to.toString(),
        versionId,
        service,
        personId,
        tagId,
        policyStateId,
        hasDetections == null ? null : hasDetections.toString(),
        q,
        interval,
        unmapped ? "true" : null);
  }

  private static void add(MultiValueMap<String, String> query, String name, String value) {
    if (value != null) query.add(name, value);
  }

  static String value(MultiValueMap<String, String> query, String name) {
    String value = query.getFirst(name);
    return value == null || value.isBlank() ? null : value.strip();
  }

  static void validateId(String id, String field) {
    if (id == null || !id.matches(ApiModels.ID_PATTERN))
      throw ApiException.invalid(field, "ID는 영문, 숫자, 하이픈, 밑줄로 1~80자여야 합니다.");
  }

  private static String id(MultiValueMap<String, String> query, String name) {
    String id = value(query, name);
    if (id != null) validateId(id, name);
    return id;
  }

  private static Boolean bool(MultiValueMap<String, String> query, String name) {
    String v = value(query, name);
    if (v == null) return null;
    if (!Set.of("true", "false").contains(v))
      throw ApiException.invalid(name, "true 또는 false를 입력해 주세요.");
    return Boolean.valueOf(v);
  }
}
