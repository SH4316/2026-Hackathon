package com.example.securitydashboard.api;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.time.Instant;
import java.util.List;

public final class ApiModels {
  private ApiModels() {}

  public static final String ID_PATTERN = "[A-Za-z0-9_-]{1,80}";

  public record CreatePerson(
      @NotNull @Pattern(regexp = ID_PATTERN) String id, @NotBlank String name) {}

  public record Person(
      String id, String name, long eventCount, long findingCount, Instant lastEventAt) {}

  public record Tag(
      String id,
      String name,
      String description,
      List<String> examples,
      String guidance,
      String jevPrompt,
      String pythonRegex,
      String color,
      String parentId,
      Integer order) {}

  public record PolicyDefinition(
      String id, String name, String description, String color, Integer order) {}

  public record VersionSummary(
      String id,
      String name,
      String status,
      boolean isActive,
      long revision,
      Instant createdAt,
      Instant publishedAt) {}

  public record ConfigVersion(
      String id,
      String name,
      String status,
      boolean isActive,
      long revision,
      Instant createdAt,
      Instant publishedAt,
      List<Tag> tags,
      List<PolicyDefinition> policyStates) {}

  public record CreateVersion(String name, String baseVersionId) {}

  public record UpdateVersion(
      @NotNull @PositiveOrZero Long revision,
      String name,
      List<Tag> tags,
      List<PolicyDefinition> policyStates) {}

  public record PublishVersion(@NotNull @PositiveOrZero Long revision) {}

  public record CreateDetection(
      @NotNull @PositiveOrZero Integer start,
      @NotNull @Positive Integer end,
      @NotNull String text,
      @NotNull @Size(min = 1, max = 1000) List<@NotNull String> tagIds) {}

  public record CreateEvent(
      @NotNull @Pattern(regexp = ID_PATTERN) String sourceId,
      @NotNull @Pattern(regexp = ID_PATTERN) String eventId,
      @NotNull @Pattern(regexp = ID_PATTERN) String personId,
      @NotNull @Pattern(regexp = ID_PATTERN) String versionId,
      @NotBlank String prompt,
      @NotNull @Size(max = 1000) List<@NotNull @Valid CreateDetection> detections,
      String occurredAt,
      String service,
      String model,
      String policyStateId) {}

  public record DetectionTag(String id, String name, String color) {}

  public record Detection(long id, int start, int end, String text, List<DetectionTag> tags) {}

  public record Event(
      long id,
      String sourceId,
      String eventId,
      String versionId,
      String personId,
      String personName,
      String prompt,
      Instant occurredAt,
      Instant receivedAt,
      String service,
      String model,
      String policyStateId,
      String policyStateName,
      List<Detection> detections,
      long findingCount) {}

  public record Page<T>(List<T> items, int page, int size, long totalElements, long totalPages) {
    public static <T> Page<T> of(List<T> items, int page, int size, long count) {
      return new Page<>(items, page, size, count, (count + size - 1) / size);
    }
  }

  public record Summary(
      long eventCount, long findingCount, long personCount, long detectedEventCount) {}

  public record Series(String bucket, long eventCount, long findingCount) {}

  public record TagMetric(
      String id,
      String parentId,
      String name,
      String color,
      int order,
      long count,
      long eventCount) {}

  public record Unmapped(long count, long eventCount) {}

  public record PolicyMetric(
      String id, String name, String color, long eventCount, boolean mapped) {}

  public record ServiceMetric(String service, long eventCount, long findingCount) {}

  public record Metrics(
      String versionId,
      Summary summary,
      List<Series> series,
      List<TagMetric> tags,
      Unmapped unmapped,
      List<PolicyMetric> policies,
      List<ServiceMetric> services) {}

  public record Filters(
      String from,
      String to,
      String versionId,
      String service,
      String personId,
      String tagId,
      String policyStateId,
      String hasDetections,
      String q,
      String interval,
      String unmapped) {}

  public record CreateSavedSearch(String name, Filters filters) {}

  public record SavedSearch(
      String id,
      String name,
      String versionId,
      Instant createdAt,
      Filters filters,
      long eventCount,
      long findingCount) {}
}
