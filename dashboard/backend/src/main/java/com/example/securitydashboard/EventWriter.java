package com.example.securitydashboard;

import java.time.Clock;
import java.time.temporal.ChronoUnit;
import java.util.Objects;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@Service
class EventWriter {
    private final EventRepository events;
    private final PersonRepository people;
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transaction;
    private final Clock clock;

    EventWriter(EventRepository events, PersonRepository people, JdbcTemplate jdbc,
                PlatformTransactionManager transactionManager, Clock clock) {
        this.events = events;
        this.people = people;
        this.jdbc = jdbc;
        this.transaction = new TransactionTemplate(transactionManager);
        this.clock = clock;
    }

    ApiModels.Person createPerson(ApiModels.CreatePerson request) {
        String name = request.name().strip();
        if (name.isEmpty() || name.codePointCount(0, name.length()) > 80) {
            throw ApiException.invalid("name", "이름은 공백을 제외하고 1~80자여야 합니다.");
        }
        try {
            transaction.executeWithoutResult(status -> {
                jdbc.update("INSERT INTO people (id,name) VALUES (?,?)", request.id(), name);
            });
        } catch (DataIntegrityViolationException exception) {
            throw new ApiException(HttpStatus.CONFLICT, "PERSON_EXISTS", "이미 등록된 사용자 ID입니다.");
        }
        return new ApiModels.Person(request.id(), name, 0, 0, null);
    }

    IngestResult ingest(ApiModels.CreateEvent request) {
        CanonicalEvent canonical = CanonicalEvent.from(request, clock);
        ApiModels.Event existing = findExisting(canonical);
        if (existing != null) return replay(canonical, existing);
        try {
            ApiModels.Event created = transaction.execute(status -> {
                var person = people.findById(canonical.personId()).orElseThrow(() ->
                    new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "PERSON_NOT_REGISTERED", "먼저 사용자를 등록해 주세요."));
                var event = new EventEntity(canonical, person, clock.instant().truncatedTo(ChronoUnit.MICROS));
                return events.saveAndFlush(event).toDto();
            });
            return new IngestResult(Objects.requireNonNull(created), true);
        } catch (DataIntegrityViolationException exception) {
            // A competing insert commits before MySQL releases the unique-key lock. The failed
            // transaction has rolled back here; read in a fresh transaction, never its old snapshot.
            existing = findExisting(canonical);
            if (existing != null) return replay(canonical, existing);
            throw exception;
        }
    }

    private ApiModels.Event findExisting(CanonicalEvent input) {
        return transaction.execute(status -> events.findBySourceIdAndEventId(input.sourceId(), input.eventId())
            .map(EventEntity::toDto).orElse(null));
    }

    private IngestResult replay(CanonicalEvent canonical, ApiModels.Event existing) {
        if (!canonical.matches(existing)) {
            throw new ApiException(HttpStatus.CONFLICT, "EVENT_CONFLICT", "동일한 이벤트 ID에 다른 내용이 이미 등록되어 있습니다.");
        }
        return new IngestResult(existing, false);
    }

    record IngestResult(ApiModels.Event event, boolean created) {}
}
