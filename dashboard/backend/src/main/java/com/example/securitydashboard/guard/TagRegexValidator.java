package com.example.securitydashboard.guard;

import com.example.securitydashboard.common.ApiException;
import com.example.securitydashboard.configuration.model.Tag;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
public class TagRegexValidator {
  private final GuardProxyService guard;
  private final ObjectMapper json;

  public TagRegexValidator(GuardProxyService guard, ObjectMapper json) {
    this.guard = guard;
    this.json = json;
  }

  public void validateChanged(List<Tag> tags, List<Tag> saved) {
    if (!guard.isServerConfigured()) return;
    Map<String, String> previous = new LinkedHashMap<>();
    saved.forEach(tag -> previous.put(tag.id(), tag.pythonRegex()));
    var changed =
        tags.stream()
            .filter(tag -> !tag.pythonRegex().isEmpty())
            .filter(tag -> !tag.pythonRegex().equals(previous.get(tag.id())))
            .map(tag -> Map.of("tag_id", tag.id(), "pattern", tag.pythonRegex()))
            .toList();
    if (changed.isEmpty()) return;
    Map<String, String> errors = new LinkedHashMap<>();
    try {
      var response =
          guard.forward(
              "org/regex/check",
              null,
              HttpMethod.POST,
              json.writeValueAsBytes(Map.of("patterns", changed)),
              null);
      if (response.getStatusCode().value() != 200 || response.getBody() == null)
        throw unavailable();
      var body = json.readTree(response.getBody());
      if (body == null) throw unavailable();
      var results = body.path("results");
      if (!results.isArray() || results.size() != changed.size()) throw unavailable();
      Map<String, String> expected = new LinkedHashMap<>();
      changed.forEach(pattern -> expected.put(pattern.get("tag_id"), pattern.get("pattern")));
      for (var result : results) {
        if (!result.path("tag_id").isTextual()) throw unavailable();
        String id = result.path("tag_id").asText();
        if (expected.remove(id) == null || !result.path("ok").isBoolean()) throw unavailable();
        if (!result.path("ok").asBoolean()) {
          String reason =
              switch (result.path("reason").asText()) {
                case "too_long" -> "정규식은 최대 4,000자입니다.";
                case "nested_quantifier" -> "중첩된 반복 수량자는 사용할 수 없습니다.";
                case "syntax_error" -> "Python 정규식 문법이 올바르지 않습니다.";
                case "matches_empty" -> "빈 문자열과 일치하는 정규식은 사용할 수 없습니다.";
                default -> throw unavailable();
              };
          errors.put("tags." + id + ".pythonRegex", reason);
        } else if (!result.has("reason") || !result.path("reason").isNull()) {
          throw unavailable();
        }
      }
    } catch (IOException | IllegalArgumentException exception) {
      throw unavailable();
    }
    if (!errors.isEmpty()) throw ApiException.invalid(errors);
  }

  private static ApiException unavailable() {
    return new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        "GUARD_UNAVAILABLE",
        "검사 서버에서 정규식을 검증하지 못했습니다. 서버 연결과 관리 키 설정을 확인한 뒤 다시 시도해 주세요.");
  }
}
