package com.example.securitydashboard.event;

import com.example.securitydashboard.common.ApiException;
import com.example.securitydashboard.configuration.ConfigurationService;
import com.example.securitydashboard.event.model.CreateEvent;
import com.example.securitydashboard.event.model.Event;
import com.example.securitydashboard.query.DashboardQueryService;
import java.time.Clock;
import java.time.temporal.ChronoUnit;
import java.util.HashSet;
import java.util.Objects;
import java.util.Set;
import java.util.function.Consumer;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class EventService {
  private final EventRepository repository;
  private final DashboardQueryService queries;
  private final ConfigurationService configs;
  private final TransactionTemplate transaction;
  private final Clock clock;

  EventService(
      EventRepository repository,
      DashboardQueryService queries,
      ConfigurationService configs,
      PlatformTransactionManager manager,
      Clock clock) {
    this.repository = repository;
    this.queries = queries;
    this.configs = configs;
    this.transaction = new TransactionTemplate(manager);
    this.clock = clock;
  }

  public EventIngestResult ingest(CreateEvent request) {
    return ingest(CanonicalEvent.from(request, clock), result -> {});
  }

  // New detector metadata and images share the event transaction. Replay callbacks validate stored
  // metadata on both the fast path and after waiting for the active configuration lock.
  public EventIngestResult ingest(
      CanonicalEvent input, Consumer<EventIngestResult> accompanyingWrite) {
    var existing = queries.byExternalId(input.sourceId(), input.eventId());
    if (existing != null) {
      return accompany(replay(input, existing), accompanyingWrite);
    }
    try {
      return Objects.requireNonNull(
          transaction.execute(
              status -> {
                String activeId = configs.lockActiveId();
                var concurrent = queries.byExternalId(input.sourceId(), input.eventId());
                if (concurrent != null) {
                  return accompany(replay(input, concurrent), accompanyingWrite);
                }
                validateRegistration(input, activeId);
                var receivedAt = clock.instant().truncatedTo(ChronoUnit.MICROS);
                var occurredAt = input.occurredAt() == null ? receivedAt : input.occurredAt();
                long id = repository.insert(input, occurredAt, receivedAt);
                return accompany(new EventIngestResult(queries.event(id), true), accompanyingWrite);
              }));
    } catch (DataIntegrityViolationException exception) {
      var concurrent = queries.byExternalId(input.sourceId(), input.eventId());
      if (concurrent != null) {
        return accompany(replay(input, concurrent), accompanyingWrite);
      }
      throw exception;
    }
  }

  private void validateRegistration(CanonicalEvent input, String activeId) {
    if (!input.versionId().equals(activeId)) {
      throw new ApiException(
          HttpStatus.CONFLICT, "VERSION_MISMATCH", "활성 설정 버전이 변경되었습니다. 최신 분류 설정을 불러와 주세요.");
    }
    if (!repository.personExists(input.personId())) {
      throw new ApiException(
          HttpStatus.UNPROCESSABLE_ENTITY, "PERSON_NOT_REGISTERED", "먼저 사용자를 등록해 주세요.");
    }
    var version = configs.get(activeId);
    Set<String> tagIds = new HashSet<>();
    version.tags().forEach(tag -> tagIds.add(tag.id()));
    for (var span : input.detections()) {
      if (!tagIds.containsAll(span.tagIds())) {
        throw new ApiException(
            HttpStatus.UNPROCESSABLE_ENTITY, "TAG_NOT_IN_VERSION", "활성 버전에 등록되지 않은 태그가 있습니다.");
      }
    }
    if (input.policyStateId() != null
        && version.policyStates().stream().noneMatch(p -> p.id().equals(input.policyStateId()))) {
      throw new ApiException(
          HttpStatus.UNPROCESSABLE_ENTITY, "POLICY_NOT_IN_VERSION", "활성 버전에 등록되지 않은 정책 상태입니다.");
    }
  }

  private EventIngestResult accompany(
      EventIngestResult result, Consumer<EventIngestResult> accompanyingWrite) {
    accompanyingWrite.accept(result);
    return result;
  }

  private EventIngestResult replay(CanonicalEvent input, Event event) {
    if (!input.matches(event)) {
      throw new ApiException(
          HttpStatus.CONFLICT, "EVENT_CONFLICT", "동일한 이벤트 ID에 다른 내용이 이미 등록되어 있습니다.");
    }
    return new EventIngestResult(event, false);
  }
}
