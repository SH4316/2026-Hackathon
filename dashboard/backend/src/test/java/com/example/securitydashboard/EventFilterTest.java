package com.example.securitydashboard;

import static org.assertj.core.api.Assertions.*;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.util.LinkedMultiValueMap;

class EventFilterTest {
    private final Clock clock = Clock.fixed(Instant.parse("2026-10-30T16:00:00Z"), ZoneOffset.UTC);

    @Test
    void defaultsUseSeoulCalendarAndEmptyValuesAreOmitted() {
        var query = new LinkedMultiValueMap<String, String>();
        query.add("service", "");
        var filter = EventFilter.parse(query, clock, Set.of());
        assertThat(filter.from()).isEqualTo(Instant.parse("2026-10-24T15:00:00Z"));
        assertThat(filter.to()).isEqualTo(Instant.parse("2026-10-31T15:00:00Z"));
        assertThat(filter.service()).isNull();
    }

    @Test
    void rejectsInvalidRangeEnumServiceRepeatedAndUnknownFilters() {
        for (var pair : new String[][] {{"category", "SECRET"}, {"policyState", "null"}, {"service", "https://chatgpt.com"},
            {"page", "1"}, {"from", "2026-01-01T00:00:00"}, {"to", "2020-01-01T00:00:00Z"}}) {
            var query = new LinkedMultiValueMap<String, String>();
            query.add(pair[0], pair[1]);
            assertThatThrownBy(() -> EventFilter.parse(query, clock, Set.of())).isInstanceOf(ApiException.class);
        }
        var range = new LinkedMultiValueMap<String, String>();
        range.add("from", "2024-01-01T00:00:00Z");
        range.add("to", "2026-01-01T00:00:00Z");
        assertThatThrownBy(() -> EventFilter.parse(range, clock, Set.of())).isInstanceOf(ApiException.class);
        range.clear();
        range.add("service", "claude");
        range.add("service", "gemini");
        assertThatThrownBy(() -> EventFilter.parse(range, clock, Set.of())).isInstanceOf(ApiException.class);
    }
}
