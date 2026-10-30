package com.example.securitydashboard.query;

import com.example.securitydashboard.common.JdbcRows;
import com.example.securitydashboard.event.model.DetectionTag;
import com.example.securitydashboard.event.model.Event;
import com.example.securitydashboard.person.model.Person;
import com.example.securitydashboard.query.model.PolicyMetric;
import com.example.securitydashboard.query.model.Series;
import com.example.securitydashboard.query.model.ServiceMetric;
import com.example.securitydashboard.query.model.Summary;
import com.example.securitydashboard.query.model.TagMetric;
import com.example.securitydashboard.query.model.Unmapped;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

/** SQL access for dashboard reads; callers supply the resolved interpretation version. */
@Repository
class DashboardRepository {
  private final NamedParameterJdbcTemplate jdbc;

  DashboardRepository(NamedParameterJdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  long countEvents(DashboardQuery query) {
    return count(query.cte() + " SELECT COUNT(*) FROM matched_events", query.parameters());
  }

  List<Event> events(DashboardQuery query, PageRequest page) {
    return jdbc.query(
        query.cte()
            + eventSelect("matched_events")
            + " ORDER BY e.occurred_at DESC,e.id DESC LIMIT :limit OFFSET :offset",
        query.parameters().addValue("limit", page.size()).addValue("offset", page.offset()),
        this::eventRow);
  }

  Event event(long id) {
    var rows =
        jdbc.query(
            eventSelect("security_events") + " WHERE e.id=:id", Map.of("id", id), this::eventRow);
    return rows.isEmpty() ? null : rows.getFirst();
  }

  Event byExternalId(String source, String event) {
    var rows =
        jdbc.query(
            eventSelect("security_events") + " WHERE e.source_id=:source AND e.event_id=:event",
            Map.of("source", source, "event", event),
            this::eventRow);
    return rows.isEmpty() ? null : rows.getFirst();
  }

  private String eventSelect(String table) {
    return " SELECT e.*,p.name AS person_name,cp.name AS policy_state_name FROM "
        + table
        + " e JOIN people p ON p.id=e.person_id LEFT JOIN config_version_policies cp ON"
        + " cp.version_id=e.version_id AND cp.id=e.policy_state_id ";
  }

  long countPeople(DashboardQuery query, String personId, String personQuery) {
    return count(
        query.cte() + personStats() + " SELECT COUNT(*)" + personFrom(query, personId, personQuery),
        query.parameters());
  }

  List<Person> people(DashboardQuery query, PageRequest page, String personId, String personQuery) {
    String from = personFrom(query, personId, personQuery);
    return jdbc.query(
        query.cte()
            + personStats()
            + " SELECT p.id,p.name,COALESCE(s.event_count,0)"
            + " event_count,COALESCE(s.finding_count,0) finding_count,s.last_event_at"
            + from
            + " ORDER BY p.name,p.id LIMIT :limit OFFSET :offset",
        query.parameters().addValue("limit", page.size()).addValue("offset", page.offset()),
        this::personRow);
  }

  private String personFrom(DashboardQuery query, String personId, String personQuery) {
    String where = "1=1";
    if (personId != null) where += " AND p.id=:personId";
    if (personQuery != null) {
      where +=
          " AND (CONVERT(p.id USING utf8mb4) COLLATE utf8mb4_bin LIKE :personQuery ESCAPE '!' OR"
              + " p.name LIKE :personQuery ESCAPE '!')";
      query.parameters().addValue("personQuery", "%" + escapeLike(personQuery) + "%");
    }
    return " FROM people p LEFT JOIN person_stats s ON s.person_id=p.id WHERE " + where;
  }

  private String personStats() {
    return ", person_stats AS (SELECT e.person_id,COUNT(*) AS"
        + " event_count,COALESCE(SUM(dc.finding_count),0) AS finding_count,MAX(e.occurred_at)"
        + " AS last_event_at FROM matched_events e LEFT JOIN (SELECT event_id,COUNT(*)"
        + " finding_count FROM matched_detections GROUP BY event_id) dc ON dc.event_id=e.id"
        + " GROUP BY e.person_id) ";
  }

  Person person(String id, DashboardQuery q) {
    q.parameters().addValue("requestedId", id);
    var rows =
        jdbc.query(
            q.cte()
                + " SELECT p.id,p.name,COUNT(e.id) event_count,COALESCE(SUM(dc.finding_count),0)"
                + " finding_count,MAX(e.occurred_at) last_event_at FROM people p LEFT JOIN"
                + " matched_events e ON e.person_id=p.id LEFT JOIN (SELECT event_id,COUNT(*)"
                + " finding_count FROM matched_detections GROUP BY event_id) dc ON dc.event_id=e.id"
                + " WHERE p.id=:requestedId GROUP BY p.id,p.name",
            q.parameters(),
            this::personRow);
    return rows.isEmpty() ? null : rows.getFirst();
  }

  Summary summary(DashboardQuery q) {
    return jdbc.queryForObject(
        q.cte()
            + " SELECT COUNT(*) event_count,COALESCE(SUM(dc.finding_count),0)"
            + " finding_count,COUNT(DISTINCT e.person_id) person_count,COALESCE(SUM(CASE WHEN"
            + " dc.finding_count>0 THEN 1 ELSE 0 END),0) detected_event_count FROM"
            + " matched_events e LEFT JOIN (SELECT event_id,COUNT(*) finding_count FROM"
            + " matched_detections GROUP BY event_id) dc ON dc.event_id=e.id",
        q.parameters(),
        (rs, n) ->
            new Summary(
                rs.getLong("event_count"),
                rs.getLong("finding_count"),
                rs.getLong("person_count"),
                rs.getLong("detected_event_count")));
  }

  List<TagMetric> tags(DashboardQuery q) {
    return jdbc.query(
        q.cte()
            + " SELECT t.id,t.parent_id,t.name,t.color,t.sort_order,COUNT(DISTINCT d.id)"
            + " finding_count,COUNT(DISTINCT d.event_id) event_count FROM"
            + " config_version_tags t LEFT JOIN config_tag_closure c ON"
            + " c.version_id=t.version_id AND c.ancestor_id=t.id LEFT JOIN detection_tags"
            + " dt ON dt.tag_id=c.descendant_id LEFT JOIN matched_detections d ON"
            + " d.id=dt.detection_id WHERE t.version_id=:viewVersion GROUP BY"
            + " t.id,t.parent_id,t.name,t.color,t.sort_order ORDER BY t.sort_order,t.id",
        q.parameters(),
        (rs, n) ->
            new TagMetric(
                rs.getString("id"),
                rs.getString("parent_id"),
                rs.getString("name"),
                rs.getString("color"),
                rs.getInt("sort_order"),
                rs.getLong("finding_count"),
                rs.getLong("event_count")));
  }

  Unmapped unmapped(DashboardQuery q) {
    return jdbc.queryForObject(
        q.cte()
            + " SELECT COUNT(*) finding_count,COUNT(DISTINCT d.event_id) event_count FROM"
            + " matched_detections d WHERE "
            + unmappedPredicate(),
        q.parameters(),
        (rs, n) -> new Unmapped(rs.getLong("finding_count"), rs.getLong("event_count")));
  }

  List<ServiceMetric> services(DashboardQuery q) {
    return jdbc.query(
        q.cte()
            + " SELECT e.service,COUNT(*) event_count,COALESCE(SUM(dc.finding_count),0)"
            + " finding_count FROM matched_events e LEFT JOIN (SELECT event_id,COUNT(*)"
            + " finding_count FROM matched_detections GROUP BY event_id) dc ON dc.event_id=e.id"
            + " GROUP BY e.service ORDER BY event_count DESC,e.service",
        q.parameters(),
        (rs, n) ->
            new ServiceMetric(
                rs.getString("service"), rs.getLong("event_count"), rs.getLong("finding_count")));
  }

  List<PolicyMetric> policyCounts(DashboardQuery q) {
    return jdbc.query(
        q.cte()
            + " SELECT e.policy_state_id id,MAX(cp.name) name,MAX(cp.color) color,COUNT(*)"
            + " event_count FROM matched_events e JOIN config_version_policies cp ON"
            + " cp.version_id=e.version_id AND cp.id=e.policy_state_id GROUP BY"
            + " e.policy_state_id",
        q.parameters(),
        (rs, n) ->
            new PolicyMetric(
                rs.getString("id"),
                rs.getString("name"),
                rs.getString("color"),
                rs.getLong("event_count"),
                false));
  }

  List<Series> series(DashboardQuery q, List<TimeBucket> timeBuckets) {
    List<String> buckets = new ArrayList<>();
    for (int index = 0; index < timeBuckets.size(); index++) {
      TimeBucket bucket = timeBuckets.get(index);
      buckets.add(
          "SELECT :bucket"
              + index
              + " bucket,:bucketFrom"
              + index
              + " bucket_from,:bucketTo"
              + index
              + " bucket_to");
      q.parameters()
          .addValue("bucket" + index, bucket.label())
          .addValue("bucketFrom" + index, Timestamp.from(bucket.from()))
          .addValue("bucketTo" + index, Timestamp.from(bucket.to()));
    }
    return jdbc.query(
        q.cte()
            + ", buckets AS ("
            + String.join(" UNION ALL ", buckets)
            + ") SELECT b.bucket,COUNT(e.id) event_count,COALESCE(SUM(dc.finding_count),0)"
            + " finding_count FROM buckets b LEFT JOIN matched_events e ON"
            + " e.occurred_at>=b.bucket_from AND e.occurred_at<b.bucket_to LEFT JOIN (SELECT"
            + " event_id,COUNT(*) finding_count FROM matched_detections GROUP BY event_id) dc ON"
            + " dc.event_id=e.id GROUP BY b.bucket ORDER BY b.bucket",
        q.parameters(),
        (rs, n) ->
            new Series(
                rs.getString("bucket"), rs.getLong("event_count"), rs.getLong("finding_count")));
  }

  void captureSnapshotMembers(String savedSearchId, DashboardQuery query) {
    jdbc.update(
        "INSERT INTO saved_search_events(saved_search_id,event_id) SELECT :snapshotId,e.id FROM"
            + " security_events e WHERE "
            + query.where(),
        query.parameters().addValue("snapshotId", savedSearchId));
  }

  DashboardQuery query(EventFilter filter, String viewVersionId, String snapshotId) {
    var p =
        new MapSqlParameterSource("from", timestampBoundary(filter.from()))
            .addValue("to", timestampBoundary(filter.to()))
            .addValue("viewVersion", viewVersionId);
    String where = "e.occurred_at>=:from AND e.occurred_at<:to";
    if (filter.service() != null) {
      where += " AND e.service=:service";
      p.addValue("service", filter.service());
    }
    if (filter.personId() != null) {
      where += " AND e.person_id=:personId";
      p.addValue("personId", filter.personId());
    }
    if (filter.policyStateId() != null) {
      where += " AND e.policy_state_id=:policyStateId";
      p.addValue("policyStateId", filter.policyStateId());
    }
    if (filter.q() != null) {
      where += " AND e.prompt LIKE :promptQuery ESCAPE '!'";
      p.addValue("promptQuery", "%" + escapeLike(filter.q()) + "%");
    }
    if (filter.hasDetections() != null)
      where +=
          " AND "
              + (filter.hasDetections() ? "" : "NOT ")
              + "EXISTS (SELECT 1 FROM detections hd WHERE hd.event_id=e.id)";
    String span = "1=1";
    if (filter.tagId() != null) {
      p.addValue("tagId", filter.tagId());
      span =
          "EXISTS (SELECT 1 FROM detection_tags dt JOIN config_tag_closure c ON"
              + " c.descendant_id=dt.tag_id AND c.version_id=:viewVersion WHERE"
              + " dt.detection_id=d.id AND c.ancestor_id=:tagId)";
    }
    if (filter.unmapped()) span = unmappedPredicate();
    if (filter.tagId() != null || filter.unmapped())
      where += " AND EXISTS (SELECT 1 FROM detections d WHERE d.event_id=e.id AND " + span + ")";
    if (snapshotId != null) {
      where +=
          " AND EXISTS (SELECT 1 FROM saved_search_events se WHERE se.saved_search_id=:snapshotId"
              + " AND se.event_id=e.id)";
      p.addValue("snapshotId", snapshotId);
    }
    String cte =
        "WITH matched_events AS (SELECT e.* FROM security_events e WHERE "
            + where
            + "), matched_detections AS (SELECT d.* FROM detections d JOIN matched_events e ON"
            + " e.id=d.event_id WHERE "
            + span
            + ")";
    return new DashboardQuery(where, cte, p);
  }

  private static String unmappedPredicate() {
    return "NOT EXISTS (SELECT 1 FROM detection_tags ut JOIN config_version_tags vt ON"
        + " vt.id=ut.tag_id AND vt.version_id=:viewVersion WHERE ut.detection_id=d.id)";
  }

  private Event eventRow(ResultSet rs, int n) throws SQLException {
    return new Event(
        rs.getLong("id"),
        rs.getString("source_id"),
        rs.getString("event_id"),
        rs.getString("version_id"),
        rs.getString("person_id"),
        rs.getString("person_name"),
        rs.getString("prompt"),
        JdbcRows.instant(rs, "occurred_at"),
        JdbcRows.instant(rs, "received_at"),
        rs.getString("service"),
        rs.getString("model"),
        rs.getString("policy_state_id"),
        rs.getString("policy_state_name"),
        List.of(),
        0);
  }

  List<DetectionRow> detections(List<Long> eventIds) {
    return jdbc.query(
        "SELECT d.* FROM detections d WHERE d.event_id IN (:ids) ORDER BY"
            + " d.event_id,d.start_offset,d.end_offset",
        Map.of("ids", eventIds),
        (rs, n) ->
            new DetectionRow(
                rs.getLong("id"),
                rs.getLong("event_id"),
                rs.getInt("start_offset"),
                rs.getInt("end_offset"),
                rs.getString("text")));
  }

  Map<Long, List<DetectionTag>> detectionTags(List<Long> eventIds) {
    var p = Map.of("ids", eventIds);
    Map<Long, List<DetectionTag>> tagMap = new HashMap<>();
    jdbc.query(
        "SELECT dt.detection_id,t.id,t.name,t.color FROM detection_tags dt JOIN detections d ON"
            + " d.id=dt.detection_id JOIN config_version_tags t ON t.version_id=dt.version_id AND"
            + " t.id=dt.tag_id WHERE d.event_id IN (:ids) ORDER BY dt.detection_id,t.id",
        p,
        (RowCallbackHandler)
            rs ->
                tagMap
                    .computeIfAbsent(rs.getLong("detection_id"), key -> new ArrayList<>())
                    .add(
                        new DetectionTag(
                            rs.getString("id"), rs.getString("name"), rs.getString("color"))));
    return tagMap;
  }

  private Person personRow(ResultSet rs, int n) throws SQLException {
    return new Person(
        rs.getString("id"),
        rs.getString("name"),
        rs.getLong("event_count"),
        rs.getLong("finding_count"),
        JdbcRows.instant(rs, "last_event_at"));
  }

  static Timestamp timestampBoundary(Instant instant) {
    Instant micros = instant.truncatedTo(ChronoUnit.MICROS);
    if (!micros.equals(instant)) micros = micros.plus(1, ChronoUnit.MICROS);
    return Timestamp.from(micros);
  }

  private long count(String sql, MapSqlParameterSource params) {
    Long count = jdbc.queryForObject(sql, params, Long.class);
    return count == null ? 0 : count;
  }

  private static String escapeLike(String value) {
    return value.replace("!", "!!").replace("%", "!%").replace("_", "!_");
  }
}
