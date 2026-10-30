package com.example.securitydashboard.common;

import com.example.securitydashboard.api.ApiModels;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.Locale;

/** Shared input rules used by configuration, ingestion, and query parsing. */
public final class InputValidation {
  private InputValidation() {}

  public static void validateId(String id, String field) {
    if (id == null || !id.matches(ApiModels.ID_PATTERN))
      throw ApiException.invalid(field, "ID는 영문, 숫자, 하이픈, 밑줄로 1~80자여야 합니다.");
  }

  public static String name(String value, String field) {
    if (value == null || value.isBlank()) throw ApiException.invalid(field, "이름은 1~80자여야 합니다.");
    return text(value.strip(), 80, field);
  }

  public static String text(String value, int max, String field) {
    if (value == null) return "";
    if (value.codePointCount(0, value.length()) > max || hasUnpairedSurrogate(value))
      throw ApiException.invalid(field, "문자열의 길이와 형식을 확인해 주세요.");
    return value;
  }

  public static boolean hasUnpairedSurrogate(String value) {
    for (int i = 0; i < value.length(); i++) {
      char c = value.charAt(i);
      if (Character.isHighSurrogate(c)) {
        if (i + 1 >= value.length() || !Character.isLowSurrogate(value.charAt(++i))) return true;
      } else if (Character.isLowSurrogate(c)) return true;
    }
    return false;
  }

  public static String normalizeService(String value) {
    String service = value.strip().toLowerCase(Locale.ROOT);
    if (!service.matches("[a-z0-9_-]{1,64}"))
      throw ApiException.invalid("service", "서비스는 영문 소문자, 숫자, 하이픈, 밑줄로 1~64자여야 합니다.");
    return service;
  }

  public static Instant parseInstant(String value, String field) {
    try {
      return OffsetDateTime.parse(value).toInstant();
    } catch (DateTimeParseException | ArithmeticException exception) {
      throw ApiException.invalid(field, "시간대가 포함된 ISO 8601 시각을 입력해 주세요.");
    }
  }

  public static void validateTime(Instant time, String field) {
    if (time.isBefore(Instant.parse("1000-01-01T00:00:00Z"))
        || !time.isBefore(Instant.parse("+10000-01-01T00:00:00Z")))
      throw ApiException.invalid(field, "1000년부터 9999년 사이의 시각을 입력해 주세요.");
  }
}
