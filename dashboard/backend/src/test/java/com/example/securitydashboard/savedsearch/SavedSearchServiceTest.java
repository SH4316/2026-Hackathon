package com.example.securitydashboard.savedsearch;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.example.securitydashboard.configuration.ConfigurationService;
import com.example.securitydashboard.configuration.model.ConfigVersion;
import com.example.securitydashboard.query.DashboardQueryService;
import com.example.securitydashboard.query.EventFilter;
import com.example.securitydashboard.query.model.Filters;
import com.example.securitydashboard.query.model.Metrics;
import com.example.securitydashboard.query.model.Summary;
import com.example.securitydashboard.query.model.Unmapped;
import com.example.securitydashboard.savedsearch.model.CreateSavedSearch;
import com.example.securitydashboard.savedsearch.model.SavedSearch;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class SavedSearchServiceTest {
  @Test
  void freezesResolvedVersionAndReusesExactlyTheSameFilterForCaptureAndCounts() {
    var repository = mock(SavedSearchRepository.class);
    var queries = mock(DashboardQueryService.class);
    var configs = mock(ConfigurationService.class);
    var clock = Clock.fixed(Instant.parse("2026-10-30T17:00:00Z"), ZoneOffset.UTC);
    var service = new SavedSearchService(repository, queries, configs, clock);
    var version =
        new ConfigVersion(
            "published",
            "Published",
            "published",
            true,
            1,
            clock.instant(),
            clock.instant(),
            List.of(),
            List.of(),
            List.of());
    when(configs.view(null)).thenReturn(version);
    when(queries.metrics(any(EventFilter.class), anyString()))
        .thenReturn(
            new Metrics(
                "published",
                new Summary(12, 17, 3, 9),
                List.of(),
                List.of(),
                new Unmapped(0, 0),
                List.of(),
                List.of()));
    when(repository.find(anyString()))
        .thenAnswer(
            invocation ->
                new SavedSearch(
                    invocation.getArgument(0),
                    "Saved",
                    "published",
                    clock.instant(),
                    null,
                    12,
                    17));
    var inputFilters =
        new Filters(
            null, null, null, "CHAT", "person", null, "allowed", "true", " %_ ", "day", null);

    var result = service.create(new CreateSavedSearch(" Saved ", inputFilters));

    ArgumentCaptor<Filters> persistedFilters = ArgumentCaptor.forClass(Filters.class);
    verify(repository)
        .insert(
            eq(result.id()),
            eq("Saved"),
            eq("published"),
            eq(clock.instant()),
            persistedFilters.capture());
    var pinned = EventFilter.parse(persistedFilters.getValue(), clock);
    assertThat(pinned.versionId()).isEqualTo("published");
    assertThat(pinned.service()).isEqualTo("chat");
    assertThat(pinned.personId()).isEqualTo("person");
    assertThat(pinned.policyStateId()).isEqualTo("allowed");
    assertThat(pinned.hasDetections()).isTrue();
    assertThat(pinned.q()).isEqualTo(" %_ ");
    assertThat(pinned.from()).isEqualTo(Instant.parse("2026-10-24T15:00:00Z"));
    assertThat(pinned.to()).isEqualTo(Instant.parse("2026-10-31T15:00:00Z"));
    verify(queries).captureSnapshotMembers(result.id(), pinned);
    verify(queries).metrics(pinned, result.id());
    verify(repository).updateCounts(result.id(), 12, 17);
  }
}
