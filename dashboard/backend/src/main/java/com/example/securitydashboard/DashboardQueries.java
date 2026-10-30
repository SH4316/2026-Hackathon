package com.example.securitydashboard;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

@Repository
@Transactional(readOnly = true)
class DashboardQueries {
    private final NamedParameterJdbcTemplate jdbc;

    DashboardQueries(NamedParameterJdbcTemplate jdbc) { this.jdbc = jdbc; }

    ApiModels.Page<ApiModels.Event> events(EventFilter filter, PageRequest page) {
        Query query = query(filter);
        long count = count("SELECT COUNT(*) FROM security_events e WHERE " + query.where(), query.parameters());
        var parameters = query.parameters().addValue("limit", page.size()).addValue("offset", page.offset());
        var rows = jdbc.query("""
            SELECT e.*, p.name AS person_name FROM security_events e
            JOIN people p ON p.id=e.person_id WHERE %s
            ORDER BY e.occurred_at DESC, e.id DESC LIMIT :limit OFFSET :offset
            """.formatted(query.where()), parameters, this::eventRow);
        return ApiModels.Page.of(withFindings(rows), page.page(), page.size(), count);
    }

    ApiModels.Event event(long id) {
        var rows = jdbc.query("""
            SELECT e.*, p.name AS person_name FROM security_events e
            JOIN people p ON p.id=e.person_id WHERE e.id=:id
            """, Map.of("id", id), this::eventRow);
        if (rows.isEmpty()) throw new ApiException(HttpStatus.NOT_FOUND, "EVENT_NOT_FOUND", "이벤트를 찾을 수 없습니다.");
        return withFindings(rows).getFirst();
    }

    ApiModels.Page<ApiModels.Person> people(EventFilter filter, PageRequest page, String search) {
        Query query = query(filter);
        String personWhere = "1=1";
        if (filter.personId() != null) personWhere += " AND p.id=:personId";
        if (search != null) {
            personWhere += " AND (p.id LIKE :search ESCAPE '!' OR p.name LIKE :search ESCAPE '!')";
            query.parameters().addValue("search", "%" + escapeLike(search) + "%");
        }
        long count = count("SELECT COUNT(*) FROM people p WHERE " + personWhere, query.parameters());
        var parameters = query.parameters().addValue("limit", page.size()).addValue("offset", page.offset());
        var rows = jdbc.query("""
            SELECT p.id, p.name, COALESCE(s.event_count,0) AS event_count,
                   COALESCE(s.finding_count,0) AS finding_count, s.last_event_at
            FROM people p LEFT JOIN (%s) s ON s.person_id=p.id
            WHERE %s ORDER BY p.name, p.id LIMIT :limit OFFSET :offset
            """.formatted(personStatsSql(query), personWhere), parameters, this::personRow);
        return ApiModels.Page.of(rows, page.page(), page.size(), count);
    }

    ApiModels.Person person(String id, EventFilter filter) {
        Query query = query(filter);
        query.parameters().addValue("requestedId", id);
        var rows = jdbc.query("""
            SELECT p.id, p.name, COALESCE(s.event_count,0) AS event_count,
                   COALESCE(s.finding_count,0) AS finding_count, s.last_event_at
            FROM people p LEFT JOIN (%s) s ON s.person_id=p.id WHERE p.id=:requestedId
            """.formatted(personStatsSql(query)), query.parameters(), this::personRow);
        if (rows.isEmpty()) throw new ApiException(HttpStatus.NOT_FOUND, "PERSON_NOT_FOUND", "사용자를 찾을 수 없습니다.");
        return rows.getFirst();
    }

    ApiModels.Metrics metrics(EventFilter filter) {
        Query query = query(filter);
        String base = " FROM security_events e " + findingJoin(filter) + " WHERE " + query.where();
        var summary = jdbc.queryForObject("""
            SELECT COUNT(*) AS event_count, COALESCE(SUM(fc.finding_count),0) AS finding_count,
                   COUNT(DISTINCT e.person_id) AS person_count,
                   COALESCE(SUM(CASE WHEN e.policy_state='UNKNOWN' THEN 1 ELSE 0 END),0) AS unknown_policy_count
            """ + base, query.parameters(), (rs, row) -> new ApiModels.Summary(rs.getLong("event_count"),
                rs.getLong("finding_count"), rs.getLong("person_count"), rs.getLong("unknown_policy_count")));

        List<ApiModels.Daily> daily = daily(query);

        Map<Category, ApiModels.CategoryMetric> byCategory = new EnumMap<>(Category.class);
        String selectedCategory = filter.category() == null ? "" : " AND f.category=:category";
        jdbc.query("""
            SELECT f.category, SUM(f.quantity) AS finding_count, COUNT(DISTINCT e.id) AS event_count
            FROM security_events e JOIN findings f ON f.event_id=e.id WHERE %s %s GROUP BY f.category
            """.formatted(query.where(), selectedCategory), query.parameters(), (rs, row) ->
                new ApiModels.CategoryMetric(Category.valueOf(rs.getString("category")), rs.getLong("finding_count"), rs.getLong("event_count")))
            .forEach(value -> byCategory.put(value.category(), value));
        List<ApiModels.CategoryMetric> categories = java.util.Arrays.stream(Category.values())
            .map(category -> byCategory.getOrDefault(category, new ApiModels.CategoryMetric(category, 0, 0))).toList();

        Map<PolicyState, Long> policyCounts = new EnumMap<>(PolicyState.class);
        jdbc.query("SELECT e.policy_state, COUNT(*) AS event_count FROM security_events e WHERE " + query.where()
                + " AND e.policy_state IS NOT NULL GROUP BY e.policy_state", query.parameters(), (rs, row) ->
                    new ApiModels.PolicyMetric(PolicyState.valueOf(rs.getString("policy_state")), rs.getLong("event_count")))
            .forEach(value -> policyCounts.put(value.policyState(), value.eventCount()));
        List<ApiModels.PolicyMetric> policies = java.util.Arrays.stream(PolicyState.values())
            .map(policy -> new ApiModels.PolicyMetric(policy, policyCounts.getOrDefault(policy, 0L))).toList();

        var services = jdbc.query("SELECT e.service, COUNT(*) AS event_count, COALESCE(SUM(fc.finding_count),0) AS finding_count"
            + base + " GROUP BY e.service ORDER BY event_count DESC, e.service", query.parameters(), (rs, row) ->
                new ApiModels.ServiceMetric(rs.getString("service"), rs.getLong("event_count"), rs.getLong("finding_count")));
        return new ApiModels.Metrics(summary, daily, categories, policies, services);
    }

    private List<ApiModels.Daily> daily(Query query) {
        // Calendar boundaries come from the JVM timezone database, including historical Seoul
        // offsets and DST. Counts still aggregate in MySQL, with no timezone-table prerequisite.
        List<String> buckets = new ArrayList<>();
        LocalDate lastDay = query.filter().to().minusNanos(1).atZone(EventFilter.SEOUL).toLocalDate();
        int index = 0;
        for (LocalDate date = query.filter().from().atZone(EventFilter.SEOUL).toLocalDate(); !date.isAfter(lastDay); date = date.plusDays(1)) {
            buckets.add("SELECT :date" + index + " AS bucket, :dayFrom" + index + " AS day_from, :dayTo" + index + " AS day_to");
            query.parameters().addValue("date" + index, date.toString())
                .addValue("dayFrom" + index, timestampBoundary(date.atStartOfDay(EventFilter.SEOUL).toInstant()))
                .addValue("dayTo" + index, timestampBoundary(date.plusDays(1).atStartOfDay(EventFilter.SEOUL).toInstant()));
            index++;
        }
        return jdbc.query("""
            SELECT days.bucket, COUNT(e.id) AS event_count, COALESCE(SUM(fc.finding_count),0) AS finding_count
            FROM (%s) days LEFT JOIN security_events e
              ON e.occurred_at >= days.day_from AND e.occurred_at < days.day_to AND %s
            %s GROUP BY days.bucket ORDER BY days.bucket
            """.formatted(String.join(" UNION ALL ", buckets), query.where(), findingJoin(query.filter())),
            query.parameters(), (rs, row) -> new ApiModels.Daily(LocalDate.parse(rs.getString("bucket")),
                rs.getLong("event_count"), rs.getLong("finding_count")));
    }

    private String personStatsSql(Query query) {
        return "SELECT e.person_id, COUNT(*) AS event_count, COALESCE(SUM(fc.finding_count),0) AS finding_count, "
            + "MAX(e.occurred_at) AS last_event_at FROM security_events e " + findingJoin(query.filter())
            + " WHERE " + query.where() + " GROUP BY e.person_id";
    }

    private String findingJoin(EventFilter filter) {
        return " LEFT JOIN (SELECT event_id, SUM(quantity) AS finding_count FROM findings"
            + (filter.category() == null ? "" : " WHERE category=:category")
            + " GROUP BY event_id) fc ON fc.event_id=e.id ";
    }

    private Query query(EventFilter filter) {
        var parameters = new MapSqlParameterSource("from", timestampBoundary(filter.from()))
            .addValue("to", timestampBoundary(filter.to()));
        String where = "e.occurred_at >= :from AND e.occurred_at < :to";
        if (filter.service() != null) {
            where += " AND e.service=:service";
            parameters.addValue("service", filter.service());
        }
        if (filter.personId() != null) {
            where += " AND e.person_id=:personId";
            parameters.addValue("personId", filter.personId());
        }
        if (filter.policyState() != null) {
            where += " AND e.policy_state=:policyState";
            parameters.addValue("policyState", filter.policyState().name());
        }
        if (filter.category() != null) {
            where += " AND EXISTS (SELECT 1 FROM findings matched WHERE matched.event_id=e.id AND matched.category=:category)";
            parameters.addValue("category", filter.category().name());
        }
        return new Query(filter, where, parameters);
    }

    private ApiModels.Event eventRow(ResultSet rs, int row) throws SQLException {
        String policy = rs.getString("policy_state");
        return new ApiModels.Event(rs.getLong("id"), rs.getString("source_id"), rs.getString("event_id"),
            rs.getString("person_id"), rs.getString("person_name"), instant(rs, "occurred_at"), instant(rs, "received_at"),
            rs.getString("service"), rs.getString("model"), policy == null ? null : PolicyState.valueOf(policy), List.of(), 0);
    }

    private List<ApiModels.Event> withFindings(List<ApiModels.Event> events) {
        if (events.isEmpty()) return List.of();
        Map<Long, List<ApiModels.Finding>> findings = new LinkedHashMap<>();
        jdbc.query("SELECT event_id, category, quantity FROM findings WHERE event_id IN (:ids) ORDER BY event_id, category",
            Map.of("ids", events.stream().map(ApiModels.Event::id).toList()), rs -> {
                findings.computeIfAbsent(rs.getLong("event_id"), id -> new ArrayList<>())
                    .add(new ApiModels.Finding(Category.valueOf(rs.getString("category")), rs.getInt("quantity")));
            });
        return events.stream().map(event -> {
            var values = findings.getOrDefault(event.id(), List.of()).stream()
                .sorted(java.util.Comparator.comparing(ApiModels.Finding::category)).toList();
            return new ApiModels.Event(event.id(), event.sourceId(), event.eventId(), event.personId(), event.personName(),
                event.occurredAt(), event.receivedAt(), event.service(), event.model(), event.policyState(), values,
                values.stream().mapToLong(ApiModels.Finding::quantity).sum());
        }).toList();
    }

    private ApiModels.Person personRow(ResultSet rs, int row) throws SQLException {
        return new ApiModels.Person(rs.getString("id"), rs.getString("name"), rs.getLong("event_count"),
            rs.getLong("finding_count"), instant(rs, "last_event_at"));
    }

    private static Instant instant(ResultSet rs, String column) throws SQLException {
        // JDBC and the MySQL connection both operate in UTC (also explicit for non-UTC host JVMs).
        Timestamp timestamp = rs.getTimestamp(column, java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("UTC")));
        return timestamp == null ? null : timestamp.toInstant();
    }

    private static Timestamp timestampBoundary(Instant instant) {
        Instant micros = instant.truncatedTo(ChronoUnit.MICROS);
        // Stored events have microsecond precision. Ceiling both query bounds preserves [from,to).
        if (!micros.equals(instant)) micros = micros.plus(1, ChronoUnit.MICROS);
        return Timestamp.from(micros);
    }

    private long count(String sql, MapSqlParameterSource parameters) {
        Long value = jdbc.queryForObject(sql, parameters, Long.class);
        return value == null ? 0 : value;
    }

    private static String escapeLike(String value) {
        return value.replace("!", "!!").replace("%", "!%").replace("_", "!_");
    }

    private record Query(EventFilter filter, String where, MapSqlParameterSource parameters) {}
}
