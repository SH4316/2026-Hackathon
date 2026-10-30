package com.example.securitydashboard.query;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.example.securitydashboard.common.ApiException;
import com.example.securitydashboard.configuration.ConfigurationService;
import com.example.securitydashboard.configuration.model.ConfigVersion;
import com.example.securitydashboard.configuration.model.PolicyDefinition;
import com.example.securitydashboard.event.model.Detection;
import com.example.securitydashboard.event.model.DetectionTag;
import com.example.securitydashboard.event.model.Event;
import com.example.securitydashboard.query.model.PolicyMetric;
import com.example.securitydashboard.query.model.Series;
import com.example.securitydashboard.query.model.Summary;
import com.example.securitydashboard.query.model.Unmapped;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;

class DashboardQueryServiceTest {
  private final DashboardRepository repository = mock(DashboardRepository.class);
  private final ConfigurationService configs = mock(ConfigurationService.class);
  private final DashboardQueryService service = new DashboardQueryService(repository, configs);

  @Test
  void combinesCapturedPolicyCountsWithSelectedDefinitionsAndSeoulCalendarBuckets() {
    var filter = filter(null);
    var selected =
        new ConfigVersion(
            "selected",
            "Selected",
            "published",
            true,
            1,
            filter.from(),
            filter.from(),
            List.of(),
            List.of(
                new PolicyDefinition("allowed", "Current label", "", "#123456", 0),
                new PolicyDefinition("new", "Unused policy", "", "#654321", 1)));
    var query = new DashboardQuery("", "", new MapSqlParameterSource());
    when(configs.view("selected")).thenReturn(selected);
    when(repository.query(filter, "selected", "snapshot")).thenReturn(query);
    when(repository.summary(query)).thenReturn(new Summary(5, 7, 2, 4));
    when(repository.series(eq(query), anyList()))
        .thenReturn(List.of(new Series("2026-10-31", 5, 7), new Series("2026-11-01", 0, 0)));
    when(repository.unmapped(query)).thenReturn(new Unmapped(0, 0));
    when(repository.policyCounts(query))
        .thenReturn(
            List.of(
                new PolicyMetric("allowed", "Captured label", "#111111", 3, false),
                new PolicyMetric("retired", "Historical policy", "#222222", 2, false)));

    var result = service.metrics(filter, "snapshot");

    assertThat(result.versionId()).isEqualTo("selected");
    assertThat(result.policies())
        .containsExactly(
            new PolicyMetric("allowed", "Current label", "#123456", 3, true),
            new PolicyMetric("new", "Unused policy", "#654321", 0, true),
            new PolicyMetric("retired", "Historical policy", "#222222", 2, false));
    assertThat(result.series()).extracting(Series::eventCount).containsExactly(5L, 0L);
    ArgumentCaptor<List<TimeBucket>> buckets = ArgumentCaptor.captor();
    verify(repository).series(eq(query), buckets.capture());
    assertThat(buckets.getValue())
        .containsExactly(
            new TimeBucket(
                "2026-10-31",
                Instant.parse("2026-10-30T15:00:00Z"),
                Instant.parse("2026-10-31T15:00:00Z")),
            new TimeBucket(
                "2026-11-01",
                Instant.parse("2026-10-31T15:00:00Z"),
                Instant.parse("2026-11-01T15:00:00Z")));
  }

  @Test
  void enrichesEventsUsingTheirCapturedDetectionTags() {
    var time = Instant.parse("2026-10-30T17:00:00Z");
    var event =
        new Event(
            9,
            "source",
            "external",
            "captured",
            "person",
            "Person",
            "hello",
            time,
            time,
            "chat",
            "model",
            "allowed",
            "Captured policy",
            List.of(),
            0);
    var tag = new DetectionTag("tag", "Captured tag", "#123456");
    when(repository.event(9)).thenReturn(event);
    when(repository.detections(List.of(9L)))
        .thenReturn(List.of(new DetectionRow(17, 9, 0, 5, "hello")));
    when(repository.detectionTags(List.of(9L))).thenReturn(Map.of(17L, List.of(tag)));

    var result = service.event(9);

    assertThat(result.versionId()).isEqualTo("captured");
    assertThat(result.policyStateName()).isEqualTo("Captured policy");
    assertThat(result.findingCount()).isEqualTo(1);
    assertThat(result.detections()).containsExactly(new Detection(17, 0, 5, "hello", List.of(tag)));
    verifyNoInteractions(configs);
  }

  @Test
  void rejectsTagsMissingFromTheSelectedInterpretationBeforeReadingEvents() {
    var filter = filter("missing");
    when(configs.view("selected"))
        .thenReturn(
            new ConfigVersion(
                "selected",
                "Selected",
                "published",
                true,
                1,
                filter.from(),
                filter.from(),
                List.of(),
                List.of()));

    assertThatThrownBy(() -> service.events(filter, new PageRequest(0, 20)))
        .isInstanceOfSatisfying(
            ApiException.class,
            error -> {
              assertThat(error.status()).isEqualTo(HttpStatus.UNPROCESSABLE_ENTITY);
              assertThat(error.code()).isEqualTo("TAG_NOT_IN_VERSION");
            });
    verifyNoInteractions(repository);
  }

  private EventFilter filter(String tagId) {
    return new EventFilter(
        Instant.parse("2026-10-30T17:00:00Z"),
        Instant.parse("2026-11-01T12:00:00Z"),
        "selected",
        null,
        null,
        tagId,
        null,
        null,
        null,
        "day",
        false);
  }
}
