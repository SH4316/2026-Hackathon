package com.example.securitydashboard.api.model;

import java.util.List;

public record Page<T>(List<T> items, int page, int size, long totalElements, long totalPages) {
  public static <T> Page<T> of(List<T> items, int page, int size, long count) {
    return new Page<>(items, page, size, count, (count + size - 1) / size);
  }
}
