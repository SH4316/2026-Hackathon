package com.example.securitydashboard.event;

import com.example.securitydashboard.common.JdbcRows;
import com.example.securitydashboard.event.model.DetectionTag;
import java.sql.Statement;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Repository;

@Repository
class EventRepository {
  private final JdbcTemplate jdbc;

  EventRepository(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  boolean personExists(String personId) {
    return jdbc.queryForObject("SELECT COUNT(*) FROM people WHERE id=?", Long.class, personId) > 0;
  }

  long insert(
      CanonicalEvent event, Map<String, DetectionTag> tags, Instant occurredAt, Instant receivedAt) {
    long eventId = insertEvent(event, occurredAt, receivedAt);
    insertDetections(eventId, event, tags);
    return eventId;
  }

  private long insertEvent(CanonicalEvent event, Instant occurredAt, Instant receivedAt) {
    return insertWithGeneratedId(
        "INSERT INTO"
            + " security_events(source_id,event_id,person_id,version_id,prompt,occurred_at,received_at,service,model,policy_state_id)"
            + " VALUES(?,?,?,?,?,?,?,?,?,?)",
        event.sourceId(),
        event.eventId(),
        event.personId(),
        event.versionId(),
        event.prompt(),
        Timestamp.from(occurredAt),
        Timestamp.from(receivedAt),
        event.service(),
        event.model(),
        event.policyStateId());
  }

  private void insertDetections(long eventId, CanonicalEvent event, Map<String, DetectionTag> tags) {
    List<Object[]> detectionTags = new ArrayList<>();
    for (var span : event.detections()) {
      long detectionId =
          insertWithGeneratedId(
              "INSERT INTO detections(event_id,start_offset,end_offset,text) VALUES(?,?,?,?)",
              eventId,
              span.start(),
              span.end(),
              span.text());
      for (String tagId : span.tagIds()) {
        var tag = Objects.requireNonNull(tags.get(tagId));
        detectionTags.add(
            new Object[] {detectionId, event.versionId(), tagId, tag.name(), tag.color()});
      }
    }
    JdbcRows.insert(
        jdbc,
        "INSERT INTO detection_tags(detection_id,version_id,tag_id,captured_name,captured_color) VALUES ",
        5,
        detectionTags);
  }

  private long insertWithGeneratedId(String sql, Object... values) {
    var key = new GeneratedKeyHolder();
    jdbc.update(
        connection -> {
          var statement = connection.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS);
          for (int i = 0; i < values.length; i++) {
            statement.setObject(i + 1, values[i]);
          }
          return statement;
        },
        key);
    return Objects.requireNonNull(key.getKey()).longValue();
  }
}
