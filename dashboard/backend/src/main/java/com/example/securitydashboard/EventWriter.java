package com.example.securitydashboard;

import java.sql.*;
import java.time.Clock;
import java.time.temporal.ChronoUnit;
import java.util.*;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@Service
class EventWriter {
  private final JdbcTemplate jdbc;
  private final DashboardQueries queries;
  private final ConfigurationService configs;
  private final TransactionTemplate transaction;
  private final Clock clock;

  EventWriter(
      JdbcTemplate jdbc,
      DashboardQueries queries,
      ConfigurationService configs,
      PlatformTransactionManager manager,
      Clock clock) {
    this.jdbc = jdbc;
    this.queries = queries;
    this.configs = configs;
    this.transaction = new TransactionTemplate(manager);
    this.clock = clock;
  }

  ApiModels.Person createPerson(ApiModels.CreatePerson request) {
    String name = ConfigurationService.name(request.name(), "name");
    try {
      transaction.executeWithoutResult(
          status -> jdbc.update("INSERT INTO people(id,name) VALUES(?,?)", request.id(), name));
    } catch (DataIntegrityViolationException exception) {
      throw new ApiException(HttpStatus.CONFLICT, "PERSON_EXISTS", "이미 등록된 사용자 ID입니다.");
    }
    return new ApiModels.Person(request.id(), name, 0, 0, null);
  }

  IngestResult ingest(ApiModels.CreateEvent request) {
    CanonicalEvent input = CanonicalEvent.from(request, clock);
    var existing = queries.byExternalId(input.sourceId(), input.eventId());
    if (existing != null) return replay(input, existing);
    try {
      return Objects.requireNonNull(
          transaction.execute(
              status -> {
                String active = configs.lockActiveId();
                // The singleton lock serializes activation and ingestion; read replay again after
                // waiting.
                var concurrent = queries.byExternalId(input.sourceId(), input.eventId());
                if (concurrent != null) return replay(input, concurrent);
                if (!input.versionId().equals(active))
                  throw new ApiException(
                      HttpStatus.CONFLICT,
                      "VERSION_MISMATCH",
                      "활성 설정 버전이 변경되었습니다. 최신 분류 설정을 불러와 주세요.");
                if (jdbc.queryForObject(
                        "SELECT COUNT(*) FROM people WHERE id=?", Long.class, input.personId())
                    == 0)
                  throw new ApiException(
                      HttpStatus.UNPROCESSABLE_ENTITY, "PERSON_NOT_REGISTERED", "먼저 사용자를 등록해 주세요.");
                var version = configs.get(active);
                Set<String> tagIds = new HashSet<>();
                version.tags().forEach(t -> tagIds.add(t.id()));
                for (var span : input.detections())
                  if (!tagIds.containsAll(span.tagIds()))
                    throw new ApiException(
                        HttpStatus.UNPROCESSABLE_ENTITY,
                        "TAG_NOT_IN_VERSION",
                        "활성 버전에 등록되지 않은 태그가 있습니다.");
                if (input.policyStateId() != null
                    && version.policyStates().stream()
                        .noneMatch(p -> p.id().equals(input.policyStateId())))
                  throw new ApiException(
                      HttpStatus.UNPROCESSABLE_ENTITY,
                      "POLICY_NOT_IN_VERSION",
                      "활성 버전에 등록되지 않은 정책 상태입니다.");
                var received = clock.instant().truncatedTo(ChronoUnit.MICROS);
                var occurred = input.occurredAt() == null ? received : input.occurredAt();
                long id =
                    insert(
                        "INSERT INTO"
                            + " security_events(source_id,event_id,person_id,version_id,prompt,occurred_at,received_at,service,model,policy_state_id)"
                            + " VALUES(?,?,?,?,?,?,?,?,?,?)",
                        input.sourceId(),
                        input.eventId(),
                        input.personId(),
                        input.versionId(),
                        input.prompt(),
                        Timestamp.from(occurred),
                        Timestamp.from(received),
                        input.service(),
                        input.model(),
                        input.policyStateId());
                List<Object[]> detectionTags = new ArrayList<>();
                for (var span : input.detections()) {
                  long detection =
                      insert(
                          "INSERT INTO detections(event_id,start_offset,end_offset,text)"
                              + " VALUES(?,?,?,?)",
                          id,
                          span.start(),
                          span.end(),
                          span.text());
                  for (String tag : span.tagIds())
                    detectionTags.add(new Object[] {detection, input.versionId(), tag});
                }
                JdbcRows.insert(
                    jdbc,
                    "INSERT INTO detection_tags(detection_id,version_id,tag_id) VALUES ",
                    3,
                    detectionTags);
                return new IngestResult(queries.event(id), true);
              }));
    } catch (DataIntegrityViolationException exception) {
      var concurrent = queries.byExternalId(input.sourceId(), input.eventId());
      if (concurrent != null) return replay(input, concurrent);
      throw exception;
    }
  }

  private long insert(String sql, Object... values) {
    var key = new GeneratedKeyHolder();
    jdbc.update(
        connection -> {
          var statement = connection.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS);
          for (int i = 0; i < values.length; i++) statement.setObject(i + 1, values[i]);
          return statement;
        },
        key);
    return Objects.requireNonNull(key.getKey()).longValue();
  }

  private IngestResult replay(CanonicalEvent input, ApiModels.Event event) {
    if (!input.matches(event))
      throw new ApiException(
          HttpStatus.CONFLICT, "EVENT_CONFLICT", "동일한 이벤트 ID에 다른 내용이 이미 등록되어 있습니다.");
    return new IngestResult(event, false);
  }

  record IngestResult(ApiModels.Event event, boolean created) {}
}
