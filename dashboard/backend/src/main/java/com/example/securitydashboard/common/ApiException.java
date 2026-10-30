package com.example.securitydashboard.common;

import java.util.Map;
import org.springframework.http.HttpStatus;

public class ApiException extends RuntimeException {
  private final HttpStatus status;
  private final String code;
  private final Map<String, String> fields;

  public ApiException(HttpStatus status, String code, String message) {
    this(status, code, message, Map.of());
  }

  private ApiException(HttpStatus status, String code, String message, Map<String, String> fields) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }

  public static ApiException invalid(String field, String message) {
    return new ApiException(
        HttpStatus.BAD_REQUEST, "INVALID_INPUT", "입력값을 확인해 주세요.", Map.of(field, message));
  }

  public HttpStatus status() {
    return status;
  }

  public String code() {
    return code;
  }

  public Map<String, String> fields() {
    return fields;
  }
}
