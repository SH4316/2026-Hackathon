package com.example.securitydashboard;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Max;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

public final class ApiModels {
    private ApiModels() {}
    public static final String ID_PATTERN = "[A-Za-z0-9_-]{1,80}";

    public record CreatePerson(
        @NotNull @Pattern(regexp = ID_PATTERN) String id,
        @NotBlank String name
    ) {}

    public record CreateFinding(
        @NotNull Category category,
        @NotNull @Min(1) @Max(1000000) Integer quantity
    ) {}

    public record CreateEvent(
        @NotNull @Pattern(regexp = ID_PATTERN) String sourceId,
        @NotNull @Pattern(regexp = ID_PATTERN) String eventId,
        @NotNull @Pattern(regexp = ID_PATTERN) String personId,
        @NotBlank String occurredAt,
        @NotBlank String service,
        String model,
        PolicyState policyState,
        @Size(max = 3) List<@NotNull @Valid CreateFinding> findings
    ) {}

    public record Finding(Category category, int quantity) {}

    public record Person(String id, String name, long eventCount, long findingCount, Instant lastEventAt) {}

    public record Event(long id, String sourceId, String eventId, String personId, String personName,
                        Instant occurredAt, Instant receivedAt, String service, String model,
                        PolicyState policyState, List<Finding> findings, long findingCount) {}

    public record Page<T>(List<T> items, int page, int size, long totalElements, long totalPages) {
        public static <T> Page<T> of(List<T> items, int page, int size, long count) {
            return new Page<>(items, page, size, count, (count + size - 1) / size);
        }
    }

    public record Summary(long eventCount, long findingCount, long personCount, long unknownPolicyCount) {}
    public record Daily(LocalDate date, long eventCount, long findingCount) {}
    public record CategoryMetric(Category category, long count, long eventCount) {}
    public record PolicyMetric(PolicyState policyState, long eventCount) {}
    public record ServiceMetric(String service, long eventCount, long findingCount) {}
    public record Metrics(Summary summary, List<Daily> daily, List<CategoryMetric> categories,
                          List<PolicyMetric> policies, List<ServiceMetric> services) {}
}
