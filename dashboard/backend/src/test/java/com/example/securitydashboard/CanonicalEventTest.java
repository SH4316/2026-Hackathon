package com.example.securitydashboard;

import static org.assertj.core.api.Assertions.*;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.api.Test;

class CanonicalEventTest {
    private final Clock clock = Clock.fixed(Instant.parse("2026-10-30T00:00:00Z"), ZoneOffset.UTC);

    @Test
    void canonicalizesOffsetPrecisionServiceModelAndCategoryOrder() {
        var input = new ApiModels.CreateEvent("src", "event", "person", "2026-10-30T09:00:00.123456789+09:00",
            " ChatGPT ", " gpt-5 ", null, List.of(new ApiModels.CreateFinding(Category.CONFIDENTIAL, 2),
                new ApiModels.CreateFinding(Category.CREDENTIAL, 1)));
        var value = CanonicalEvent.from(input, clock);
        assertThat(value.occurredAt()).isEqualTo(Instant.parse("2026-10-30T00:00:00.123456Z"));
        assertThat(value.service()).isEqualTo("chatgpt");
        assertThat(value.model()).isEqualTo("gpt-5");
        assertThat(value.findings()).extracting(ApiModels.Finding::category).containsExactly(Category.CREDENTIAL, Category.CONFIDENTIAL);
    }

    @Test
    void rejectsMissingOffsetDuplicateCategoriesAndFutureTime() {
        var finding = new ApiModels.CreateFinding(Category.CREDENTIAL, 1);
        assertThatThrownBy(() -> CanonicalEvent.parseInstant("2026-10-30T00:00:00", "occurredAt")).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> CanonicalEvent.from(input("2026-10-30T00:00:00Z", List.of(finding, finding)), clock))
            .isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> CanonicalEvent.from(input("2026-10-30T00:05:00.000001Z", List.of(finding)), clock))
            .isInstanceOf(ApiException.class);
        assertThatCode(() -> CanonicalEvent.from(input("2026-10-30T00:05:00Z", List.of(finding)), clock)).doesNotThrowAnyException();
    }

    private ApiModels.CreateEvent input(String time, List<ApiModels.CreateFinding> findings) {
        return new ApiModels.CreateEvent("src", "event", "person", time, "custom-ai", null, null, findings);
    }
}
