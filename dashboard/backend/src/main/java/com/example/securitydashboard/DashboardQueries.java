package com.example.securitydashboard;

import java.sql.*;
import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.*;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

@Repository
@Transactional(readOnly = true)
class DashboardQueries {
  private final NamedParameterJdbcTemplate jdbc;
  private final ConfigurationService configs;

  DashboardQueries(NamedParameterJdbcTemplate jdbc, ConfigurationService configs) {
    this.jdbc = jdbc;
    this.configs = configs;
  }

  ApiModels.Page<ApiModels.Event> events(EventFilter filter, PageRequest page) {
    return events(filter, page, null);
  }

  ApiModels.Page<ApiModels.Event> events(EventFilter filter, PageRequest page, String snapshotId) {
    Query q = query(filter, snapshotId);
    long total = count(q.cte() + " SELECT COUNT(*) FROM matched_events", q.parameters());
    q.parameters().addValue("limit", page.size()).addValue("offset", page.offset());
    var rows =
        jdbc.query(
            q.cte()
                + eventSelect("matched_events")
                + " ORDER BY e.occurred_at DESC,e.id DESC LIMIT :limit OFFSET :offset",
            q.parameters(),
            this::eventRow);
    return ApiModels.Page.of(withDetections(rows), page.page(), page.size(), total);
  }

  ApiModels.Event event(long id) {
    var rows =
        jdbc.query(
            eventSelect("security_events") + " WHERE e.id=:id", Map.of("id", id), this::eventRow);
    if (rows.isEmpty())
      throw new ApiException(HttpStatus.NOT_FOUND, "EVENT_NOT_FOUND", "이벤트를 찾을 수 없습니다.");
    return withDetections(rows).getFirst();
  }

  ApiModels.Event byExternalId(String source, String event) {
    var rows =
        jdbc.query(
            eventSelect("security_events") + " WHERE e.source_id=:source AND e.event_id=:event",
            Map.of("source", source, "event", event),
            this::eventRow);
    return rows.isEmpty() ? null : withDetections(rows).getFirst();
  }

  private String eventSelect(String table) {
    return " SELECT e.*,p.name AS person_name,cp.name AS policy_state_name FROM "
        + table
        + " e JOIN people p ON p.id=e.person_id LEFT JOIN config_version_policies cp ON"
        + " cp.version_id=e.version_id AND cp.id=e.policy_state_id ";
  }

  ApiModels.Page<ApiModels.Person> people(
      EventFilter filter, PageRequest page, String personQuery) {
    Query q = query(filter, null);
    String where = "1=1";
    if (filter.personId() != null) where += " AND p.id=:personId";
    if (personQuery != null) {
      ConfigurationService.text(personQuery, 80, "personQuery");
      where +=
          " AND (CONVERT(p.id USING utf8mb4) COLLATE utf8mb4_bin LIKE :personQuery ESCAPE '!' OR"
              + " p.name LIKE :personQuery ESCAPE '!')";
      q.parameters().addValue("personQuery", "%" + escapeLike(personQuery) + "%");
    }
    String stats =
        ", person_stats AS (SELECT e.person_id,COUNT(*) AS"
            + " event_count,COALESCE(SUM(dc.finding_count),0) AS finding_count,MAX(e.occurred_at)"
            + " AS last_event_at FROM matched_events e LEFT JOIN (SELECT event_id,COUNT(*)"
            + " finding_count FROM matched_detections GROUP BY event_id) dc ON dc.event_id=e.id"
            + " GROUP BY e.person_id) ";
    String from = " FROM people p LEFT JOIN person_stats s ON s.person_id=p.id WHERE " + where;
    long total = count(q.cte() + stats + " SELECT COUNT(*)" + from, q.parameters());
    q.parameters().addValue("limit", page.size()).addValue("offset", page.offset());
    var rows =
        jdbc.query(
            q.cte()
                + stats
                + " SELECT p.id,p.name,COALESCE(s.event_count,0)"
                + " event_count,COALESCE(s.finding_count,0) finding_count,s.last_event_at"
                + from
                + " ORDER BY p.name,p.id LIMIT :limit OFFSET :offset",
            q.parameters(),
            this::personRow);
    return ApiModels.Page.of(rows, page.page(), page.size(), total);
  }

  ApiModels.Person person(String id, EventFilter filter) {
    Query q = query(filter, null);
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
    if (rows.isEmpty())
      throw new ApiException(HttpStatus.NOT_FOUND, "PERSON_NOT_FOUND", "사용자를 찾을 수 없습니다.");
    return rows.getFirst();
  }

  ApiModels.Metrics metrics(EventFilter filter) {
    return metrics(filter, null);
  }

  ApiModels.Metrics metrics(EventFilter filter, String snapshotId) {
    Query q = query(filter, snapshotId);
    var summary =
        jdbc.queryForObject(
            q.cte()
                + " SELECT COUNT(*) event_count,COALESCE(SUM(dc.finding_count),0)"
                + " finding_count,COUNT(DISTINCT e.person_id) person_count,COALESCE(SUM(CASE WHEN"
                + " dc.finding_count>0 THEN 1 ELSE 0 END),0) detected_event_count FROM"
                + " matched_events e LEFT JOIN (SELECT event_id,COUNT(*) finding_count FROM"
                + " matched_detections GROUP BY event_id) dc ON dc.event_id=e.id",
            q.parameters(),
            (rs, n) ->
                new ApiModels.Summary(
                    rs.getLong("event_count"),
                    rs.getLong("finding_count"),
                    rs.getLong("person_count"),
                    rs.getLong("detected_event_count")));
    List<ApiModels.TagMetric> tags =
        q.version() == null
            ? List.of()
            : jdbc.query(
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
                    new ApiModels.TagMetric(
                        rs.getString("id"),
                        rs.getString("parent_id"),
                        rs.getString("name"),
                        rs.getString("color"),
                        rs.getInt("sort_order"),
                        rs.getLong("finding_count"),
                        rs.getLong("event_count")));
    var unmapped =
        jdbc.queryForObject(
            q.cte()
                + " SELECT COUNT(*) finding_count,COUNT(DISTINCT d.event_id) event_count FROM"
                + " matched_detections d WHERE "
                + unmappedPredicate(),
            q.parameters(),
            (rs, n) ->
                new ApiModels.Unmapped(rs.getLong("finding_count"), rs.getLong("event_count")));
    var services =
        jdbc.query(
            q.cte()
                + " SELECT e.service,COUNT(*) event_count,COALESCE(SUM(dc.finding_count),0)"
                + " finding_count FROM matched_events e LEFT JOIN (SELECT event_id,COUNT(*)"
                + " finding_count FROM matched_detections GROUP BY event_id) dc ON dc.event_id=e.id"
                + " GROUP BY e.service ORDER BY event_count DESC,e.service",
            q.parameters(),
            (rs, n) ->
                new ApiModels.ServiceMetric(
                    rs.getString("service"),
                    rs.getLong("event_count"),
                    rs.getLong("finding_count")));
    return new ApiModels.Metrics(
        q.version() == null ? null : q.version().id(),
        summary,
        series(q),
        tags,
        unmapped,
        policies(q),
        services);
  }

  private List<ApiModels.PolicyMetric> policies(Query q) {
    var counts =
        jdbc.query(
            q.cte()
                + " SELECT e.policy_state_id id,MAX(cp.name) name,MAX(cp.color) color,COUNT(*)"
                + " event_count FROM matched_events e JOIN config_version_policies cp ON"
                + " cp.version_id=e.version_id AND cp.id=e.policy_state_id GROUP BY"
                + " e.policy_state_id",
            q.parameters(),
            (rs, n) ->
                new ApiModels.PolicyMetric(
                    rs.getString("id"),
                    rs.getString("name"),
                    rs.getString("color"),
                    rs.getLong("event_count"),
                    false));
    Map<String, ApiModels.PolicyMetric> remaining = new LinkedHashMap<>();
    counts.forEach(p -> remaining.put(p.id(), p));
    List<ApiModels.PolicyMetric> result = new ArrayList<>();
    if (q.version() != null)
      for (var p : q.version().policyStates()) {
        var found = remaining.remove(p.id());
        result.add(
            new ApiModels.PolicyMetric(
                p.id(), p.name(), p.color(), found == null ? 0 : found.eventCount(), true));
      }
    result.addAll(remaining.values());
    return result;
  }

  private List<ApiModels.Series> series(Query q) {
    List<String> buckets = new ArrayList<>();
    int index = 0;
    Instant cursor =
        q.filter()
            .from()
            .atZone(EventFilter.SEOUL)
            .truncatedTo(q.filter().interval().equals("hour") ? ChronoUnit.HOURS : ChronoUnit.DAYS)
            .toInstant();
    // atStartOfDay uses historical timezone rules as well as modern UTC+09.
    if (q.filter().interval().equals("day"))
      cursor =
          q.filter()
              .from()
              .atZone(EventFilter.SEOUL)
              .toLocalDate()
              .atStartOfDay(EventFilter.SEOUL)
              .toInstant();
    while (cursor.isBefore(q.filter().to())) {
      ZonedDateTime local = cursor.atZone(EventFilter.SEOUL);
      Instant next =
          q.filter().interval().equals("hour")
              ? local.plusHours(1).toInstant()
              : local.toLocalDate().plusDays(1).atStartOfDay(EventFilter.SEOUL).toInstant();
      String label =
          q.filter().interval().equals("hour") ? cursor.toString() : local.toLocalDate().toString();
      buckets.add(
          "SELECT :bucket"
              + index
              + " bucket,:bucketFrom"
              + index
              + " bucket_from,:bucketTo"
              + index
              + " bucket_to");
      q.parameters()
          .addValue("bucket" + index, label)
          .addValue("bucketFrom" + index, Timestamp.from(cursor))
          .addValue("bucketTo" + index, Timestamp.from(next));
      cursor = next;
      index++;
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
            new ApiModels.Series(
                rs.getString("bucket"), rs.getLong("event_count"), rs.getLong("finding_count")));
  }

  Query query(EventFilter filter, String snapshotId) {
    var version = configs.view(filter.versionId());
    var p =
        new MapSqlParameterSource("from", timestampBoundary(filter.from()))
            .addValue("to", timestampBoundary(filter.to()))
            .addValue("viewVersion", version == null ? null : version.id());
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
      if (version == null || version.tags().stream().noneMatch(t -> t.id().equals(filter.tagId())))
        throw new ApiException(
            HttpStatus.UNPROCESSABLE_ENTITY, "TAG_NOT_IN_VERSION", "조회 버전에 등록된 태그를 선택해 주세요.");
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
    return new Query(filter, version, where, span, cte, p);
  }

  private static String unmappedPredicate() {
    return "NOT EXISTS (SELECT 1 FROM detection_tags ut JOIN config_version_tags vt ON"
        + " vt.id=ut.tag_id AND vt.version_id=:viewVersion WHERE ut.detection_id=d.id)";
  }

  private ApiModels.Event eventRow(ResultSet rs, int n) throws SQLException {
    return new ApiModels.Event(
        rs.getLong("id"),
        rs.getString("source_id"),
        rs.getString("event_id"),
        rs.getString("version_id"),
        rs.getString("person_id"),
        rs.getString("person_name"),
        rs.getString("prompt"),
        instant(rs, "occurred_at"),
        instant(rs, "received_at"),
        rs.getString("service"),
        rs.getString("model"),
        rs.getString("policy_state_id"),
        rs.getString("policy_state_name"),
        List.of(),
        0);
  }

  private List<ApiModels.Event> withDetections(List<ApiModels.Event> events) {
    if (events.isEmpty()) return List.of();
    record DetectionRow(long id, long eventId, int start, int end, String text) {}
    var p = Map.of("ids", events.stream().map(ApiModels.Event::id).toList());
    var rows =
        jdbc.query(
            "SELECT d.* FROM detections d WHERE d.event_id IN (:ids) ORDER BY"
                + " d.event_id,d.start_offset,d.end_offset",
            p,
            (rs, n) ->
                new DetectionRow(
                    rs.getLong("id"),
                    rs.getLong("event_id"),
                    rs.getInt("start_offset"),
                    rs.getInt("end_offset"),
                    rs.getString("text")));
    Map<Long, List<ApiModels.DetectionTag>> tagMap = new HashMap<>();
    jdbc.query(
        "SELECT dt.detection_id,t.id,t.name,t.color FROM detection_tags dt JOIN detections d ON"
            + " d.id=dt.detection_id JOIN config_version_tags t ON t.version_id=dt.version_id AND"
            + " t.id=dt.tag_id WHERE d.event_id IN (:ids) ORDER BY dt.detection_id,t.id",
        p,
        (org.springframework.jdbc.core.RowCallbackHandler)
            rs ->
                tagMap
                    .computeIfAbsent(rs.getLong("detection_id"), key -> new ArrayList<>())
                    .add(
                        new ApiModels.DetectionTag(
                            rs.getString("id"), rs.getString("name"), rs.getString("color"))));
    Map<Long, List<ApiModels.Detection>> detections = new HashMap<>();
    for (var d : rows)
      detections
          .computeIfAbsent(d.eventId(), key -> new ArrayList<>())
          .add(
              new ApiModels.Detection(
                  d.id(), d.start(), d.end(), d.text(), tagMap.getOrDefault(d.id(), List.of())));
    return events.stream()
        .map(
            e -> {
              var ds = detections.getOrDefault(e.id(), List.of());
              return new ApiModels.Event(
                  e.id(),
                  e.sourceId(),
                  e.eventId(),
                  e.versionId(),
                  e.personId(),
                  e.personName(),
                  e.prompt(),
                  e.occurredAt(),
                  e.receivedAt(),
                  e.service(),
                  e.model(),
                  e.policyStateId(),
                  e.policyStateName(),
                  ds,
                  ds.size());
            })
        .toList();
  }

  private ApiModels.Person personRow(ResultSet rs, int n) throws SQLException {
    return new ApiModels.Person(
        rs.getString("id"),
        rs.getString("name"),
        rs.getLong("event_count"),
        rs.getLong("finding_count"),
        instant(rs, "last_event_at"));
  }

  static Instant instant(ResultSet rs, String column) throws SQLException {
    Timestamp t = rs.getTimestamp(column, Calendar.getInstance(TimeZone.getTimeZone("UTC")));
    return t == null ? null : t.toInstant();
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

  record Query(
      EventFilter filter,
      ApiModels.ConfigVersion version,
      String where,
      String span,
      String cte,
      MapSqlParameterSource parameters) {}
}
