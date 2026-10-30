package com.example.securitydashboard.query;

import com.example.securitydashboard.api.model.Page;
import com.example.securitydashboard.common.ApiException;
import com.example.securitydashboard.common.InputValidation;
import com.example.securitydashboard.configuration.ConfigurationService;
import com.example.securitydashboard.configuration.model.ConfigVersion;
import com.example.securitydashboard.event.model.Detection;
import com.example.securitydashboard.event.model.Event;
import com.example.securitydashboard.person.model.Person;
import com.example.securitydashboard.query.model.Metrics;
import com.example.securitydashboard.query.model.PolicyMetric;
import java.time.Instant;
import java.time.ZonedDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/** Resolves interpretation rules and assembles dashboard results from persisted event facts. */
@Service
@Transactional(readOnly = true)
public class DashboardQueryService {
  private final DashboardRepository repository;
  private final ConfigurationService configs;

  DashboardQueryService(DashboardRepository repository, ConfigurationService configs) {
    this.repository = repository;
    this.configs = configs;
  }

  public Page<Event> events(EventFilter filter, PageRequest page) {
    return events(filter, page, null);
  }

  public Page<Event> events(EventFilter filter, PageRequest page, String snapshotId) {
    var query = query(filter, snapshotId);
    long total = repository.countEvents(query);
    var events = withDetections(repository.events(query, page));
    return Page.of(events, page.page(), page.size(), total);
  }

  public Event event(long id) {
    var event = repository.event(id);
    if (event == null)
      throw new ApiException(HttpStatus.NOT_FOUND, "EVENT_NOT_FOUND", "이벤트를 찾을 수 없습니다.");
    return withDetections(List.of(event)).getFirst();
  }

  public Event byExternalId(String source, String eventId) {
    var event = repository.byExternalId(source, eventId);
    return event == null ? null : withDetections(List.of(event)).getFirst();
  }

  public Page<Person> people(EventFilter filter, PageRequest page, String personQuery) {
    var query = query(filter, null);
    if (personQuery != null) InputValidation.text(personQuery, 80, "personQuery");
    long total = repository.countPeople(query, filter.personId(), personQuery);
    var people = repository.people(query, page, filter.personId(), personQuery);
    return Page.of(people, page.page(), page.size(), total);
  }

  public Person person(String id, EventFilter filter) {
    var person = repository.person(id, query(filter, null));
    if (person == null)
      throw new ApiException(HttpStatus.NOT_FOUND, "PERSON_NOT_FOUND", "사용자를 찾을 수 없습니다.");
    return person;
  }

  public Metrics metrics(EventFilter filter) {
    return metrics(filter, null);
  }

  public Metrics metrics(EventFilter filter, String snapshotId) {
    var version = resolveVersion(filter);
    var query = repository.query(filter, version == null ? null : version.id(), snapshotId);
    return new Metrics(
        version == null ? null : version.id(),
        repository.summary(query),
        repository.series(query, timeBuckets(filter)),
        version == null ? List.of() : repository.tags(query),
        repository.unmapped(query),
        policies(version, repository.policyCounts(query)),
        repository.services(query));
  }

  /** Materialize all matching events within the saved-search caller's transaction. */
  @Transactional(propagation = Propagation.MANDATORY)
  public void captureSnapshotMembers(String savedSearchId, EventFilter filter) {
    repository.captureSnapshotMembers(savedSearchId, query(filter, null));
  }

  private DashboardQuery query(EventFilter filter, String snapshotId) {
    var version = resolveVersion(filter);
    return repository.query(filter, version == null ? null : version.id(), snapshotId);
  }

  private ConfigVersion resolveVersion(EventFilter filter) {
    var version = configs.view(filter.versionId());
    if (filter.tagId() != null
        && (version == null
            || version.tags().stream().noneMatch(t -> t.id().equals(filter.tagId()))))
      throw new ApiException(
          HttpStatus.UNPROCESSABLE_ENTITY, "TAG_NOT_IN_VERSION", "조회 버전에 등록된 태그를 선택해 주세요.");
    return version;
  }

  private List<PolicyMetric> policies(ConfigVersion version, List<PolicyMetric> counts) {
    Map<String, PolicyMetric> remaining = new LinkedHashMap<>();
    counts.forEach(p -> remaining.put(p.id(), p));
    List<PolicyMetric> result = new ArrayList<>();
    if (version != null)
      for (var policy : version.policyStates()) {
        var found = remaining.remove(policy.id());
        result.add(
            new PolicyMetric(
                policy.id(),
                policy.name(),
                policy.color(),
                found == null ? 0 : found.eventCount(),
                true));
      }
    result.addAll(remaining.values());
    return result;
  }

  private List<TimeBucket> timeBuckets(EventFilter filter) {
    List<TimeBucket> buckets = new ArrayList<>();
    Instant cursor =
        filter
            .from()
            .atZone(EventFilter.SEOUL)
            .truncatedTo(filter.interval().equals("hour") ? ChronoUnit.HOURS : ChronoUnit.DAYS)
            .toInstant();
    // Calendar boundaries preserve historical Seoul timezone transitions.
    if (filter.interval().equals("day"))
      cursor =
          filter
              .from()
              .atZone(EventFilter.SEOUL)
              .toLocalDate()
              .atStartOfDay(EventFilter.SEOUL)
              .toInstant();
    while (cursor.isBefore(filter.to())) {
      ZonedDateTime local = cursor.atZone(EventFilter.SEOUL);
      Instant next =
          filter.interval().equals("hour")
              ? local.plusHours(1).toInstant()
              : local.toLocalDate().plusDays(1).atStartOfDay(EventFilter.SEOUL).toInstant();
      String label =
          filter.interval().equals("hour") ? cursor.toString() : local.toLocalDate().toString();
      buckets.add(new TimeBucket(label, cursor, next));
      cursor = next;
    }
    return buckets;
  }

  private List<Event> withDetections(List<Event> events) {
    if (events.isEmpty()) return List.of();
    var eventIds = events.stream().map(Event::id).toList();
    var rows = repository.detections(eventIds);
    var tagMap = repository.detectionTags(eventIds);
    Map<Long, List<Detection>> detections = new HashMap<>();
    for (var detection : rows)
      detections
          .computeIfAbsent(detection.eventId(), key -> new ArrayList<>())
          .add(
              new Detection(
                  detection.id(),
                  detection.start(),
                  detection.end(),
                  detection.text(),
                  tagMap.getOrDefault(detection.id(), List.of())));
    return events.stream()
        .map(
            event -> {
              var spans = detections.getOrDefault(event.id(), List.of());
              return new Event(
                  event.id(),
                  event.sourceId(),
                  event.eventId(),
                  event.versionId(),
                  event.personId(),
                  event.personName(),
                  event.prompt(),
                  event.occurredAt(),
                  event.receivedAt(),
                  event.service(),
                  event.model(),
                  event.policyStateId(),
                  event.policyStateName(),
                  spans,
                  spans.size(),
                  event.sendAction(),
                  event.fileCount(),
                  event.imageCount());
            })
        .toList();
  }
}
