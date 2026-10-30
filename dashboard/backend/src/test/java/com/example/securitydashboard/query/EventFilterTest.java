package com.example.securitydashboard.query;

import static org.assertj.core.api.Assertions.*;

import com.example.securitydashboard.common.ApiException;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.util.LinkedMultiValueMap;

class EventFilterTest {
  private final Clock clock = Clock.fixed(Instant.parse("2026-10-30T17:00:00Z"), ZoneOffset.UTC);

  @Test
  void defaultRangeUsesSevenSeoulCalendarDates() {
    var f = EventFilter.parse(new LinkedMultiValueMap<>(), clock, Set.of());
    assertThat(f.from()).isEqualTo(Instant.parse("2026-10-24T15:00:00Z"));
    assertThat(f.to()).isEqualTo(Instant.parse("2026-10-31T15:00:00Z"));
  }

  @Test
  void preservesLiteralPromptAndSeparatesPersonQuery() {
    var q = new LinkedMultiValueMap<String, String>();
    q.add("q", " %_ ");
    q.add("personQuery", "Kim");
    var f = EventFilter.parse(q, clock, Set.of("personQuery"));
    assertThat(f.q()).isEqualTo(" %_ ");
  }

  @Test
  void enforcesRangeAndMutuallyExclusiveFilters() {
    var q = new LinkedMultiValueMap<String, String>();
    q.add("from", "2026-01-01T00:00:00Z");
    q.add("to", "2026-03-01T00:00:00Z");
    q.add("interval", "hour");
    assertThatThrownBy(() -> EventFilter.parse(q, clock, Set.of()))
        .isInstanceOf(ApiException.class);
    var tags = new LinkedMultiValueMap<String, String>();
    tags.add("tagId", "a");
    tags.add("unmapped", "true");
    assertThatThrownBy(() -> EventFilter.parse(tags, clock, Set.of()))
        .isInstanceOf(ApiException.class);
    var repeated = new LinkedMultiValueMap<String, String>();
    repeated.add("service", "a");
    repeated.add("service", "b");
    assertThatThrownBy(() -> EventFilter.parse(repeated, clock, Set.of()))
        .isInstanceOf(ApiException.class);
  }
}
