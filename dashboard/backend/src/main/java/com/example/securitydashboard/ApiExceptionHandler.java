package com.example.securitydashboard;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.validation.ConstraintViolationException;
import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.NoHandlerFoundException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

@RestControllerAdvice
class ApiExceptionHandler {
    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

    @ExceptionHandler(ApiException.class)
    ResponseEntity<ErrorBody> api(ApiException exception) {
        return response(exception.status(), exception.code(), exception.getMessage(), exception.fields());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<ErrorBody> validation(MethodArgumentNotValidException exception) {
        Map<String, String> fields = new LinkedHashMap<>();
        exception.getBindingResult().getFieldErrors().forEach(error -> {
            String message = switch (error.getField()) {
                case "id", "sourceId", "eventId", "personId" -> "ID는 영문, 숫자, 하이픈, 밑줄로 1~80자여야 합니다.";
                case "name" -> "이름을 입력해 주세요.";
                case "occurredAt" -> "시간대가 포함된 발생 시각을 입력해 주세요.";
                case "service" -> "서비스를 입력해 주세요.";
                case "findings" -> "탐지 항목은 최대 3개이며 비어 있는 항목을 포함할 수 없습니다.";
                default -> error.getField().endsWith("quantity") ? "수량은 1~1000000 사이의 정수여야 합니다." : "올바른 값을 입력해 주세요.";
            };
            fields.putIfAbsent(error.getField(), message);
        });
        return response(HttpStatus.BAD_REQUEST, "INVALID_INPUT", "입력값을 확인해 주세요.", fields);
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<ErrorBody> json() {
        return response(HttpStatus.BAD_REQUEST, "INVALID_JSON", "JSON 형식과 필수 값을 확인해 주세요. 지원하지 않는 필드는 전송할 수 없습니다.", Map.of());
    }

    @ExceptionHandler({MethodArgumentTypeMismatchException.class, ConstraintViolationException.class})
    ResponseEntity<ErrorBody> malformed() {
        return response(HttpStatus.BAD_REQUEST, "INVALID_INPUT", "입력값의 형식을 확인해 주세요.", Map.of());
    }

    @ExceptionHandler({NoResourceFoundException.class, NoHandlerFoundException.class})
    ResponseEntity<ErrorBody> missing() {
        return response(HttpStatus.NOT_FOUND, "NOT_FOUND", "요청한 경로를 찾을 수 없습니다.", Map.of());
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    ResponseEntity<ErrorBody> method() {
        return response(HttpStatus.METHOD_NOT_ALLOWED, "METHOD_NOT_ALLOWED", "지원하지 않는 요청 방식입니다.", Map.of());
    }

    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    ResponseEntity<ErrorBody> media() {
        return response(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "UNSUPPORTED_MEDIA_TYPE", "Content-Type을 application/json으로 지정해 주세요.", Map.of());
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ErrorBody> unexpected(Exception exception) {
        // Do not log exception messages: SQL/Jackson errors can contain submitted values.
        log.error("Unhandled dashboard request failure: {}", exception.getClass().getSimpleName());
        return response(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.", Map.of());
    }

    private ResponseEntity<ErrorBody> response(HttpStatus status, String code, String message, Map<String, String> fields) {
        return ResponseEntity.status(status).body(new ErrorBody(code, message, fields));
    }

    @JsonInclude(JsonInclude.Include.NON_EMPTY)
    record ErrorBody(String code, String message, Map<String, String> fieldErrors) {}
}
