package com.example.securitydashboard;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.*;
import java.time.Clock;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional(readOnly = true)
class SavedSearchService {
  private final NamedParameterJdbcTemplate jdbc;
  private final DashboardQueries queries;
  private final ConfigurationService configs;
  private final ObjectMapper json;
  private final Clock clock;

  SavedSearchService(
      NamedParameterJdbcTemplate jdbc,
      DashboardQueries queries,
      ConfigurationService configs,
      ObjectMapper json,
      Clock clock) {
    this.jdbc = jdbc;
    this.queries = queries;
    this.configs = configs;
    this.json = json;
    this.clock = clock;
  }

  @Transactional
  ApiModels.SavedSearch create(ApiModels.CreateSavedSearch input) {
    String name = ConfigurationService.name(input.name(), "name");
    EventFilter filter = EventFilter.parse(input.filters(), clock);
    var version = configs.view(filter.versionId());
    if (version == null)
      throw new ApiException(HttpStatus.CONFLICT, "NO_ACTIVE_VERSION", "저장하려면 게시한 조회 버전이 필요합니다.");
    filter = filter.withVersion(version.id());
    var query = queries.query(filter, null);
    String id = "s_" + UUID.randomUUID().toString().replace("-", "");
    var params =
        query
            .parameters()
            .addValue("id", id)
            .addValue("name", name)
            .addValue("versionId", version.id())
            .addValue("createdAt", Timestamp.from(clock.instant()))
            .addValue("filters", encode(filter.snapshot()));
    jdbc.update(
        "INSERT INTO"
            + " saved_searches(id,name,version_id,created_at,filters,event_count,finding_count)"
            + " VALUES(:id,:name,:versionId,:createdAt,:filters,0,0)",
        params);
    // INSERT...SELECT materializes the complete matching set within this transaction, never a page.
    jdbc.update(
        "INSERT INTO saved_search_events(saved_search_id,event_id) SELECT :id,e.id FROM"
            + " security_events e WHERE "
            + query.where(),
        params);
    var summary = queries.metrics(filter, id).summary();
    params
        .addValue("eventCount", summary.eventCount())
        .addValue("findingCount", summary.findingCount());
    jdbc.update(
        "UPDATE saved_searches SET event_count=:eventCount,finding_count=:findingCount WHERE"
            + " id=:id",
        params);
    return get(id);
  }

  List<ApiModels.SavedSearch> list() {
    return jdbc.query("SELECT * FROM saved_searches ORDER BY created_at DESC,id", this::row);
  }

  ApiModels.SavedSearch get(String id) {
    EventFilter.validateId(id, "id");
    var rows = jdbc.query("SELECT * FROM saved_searches WHERE id=:id", Map.of("id", id), this::row);
    if (rows.isEmpty())
      throw new ApiException(HttpStatus.NOT_FOUND, "SAVED_SEARCH_NOT_FOUND", "저장한 검색을 찾을 수 없습니다.");
    return rows.getFirst();
  }

  @Transactional
  void delete(String id) {
    get(id);
    jdbc.update("DELETE FROM saved_searches WHERE id=:id", Map.of("id", id));
  }

  ApiModels.Page<ApiModels.Event> events(String id, PageRequest page) {
    var saved = get(id);
    return queries.events(EventFilter.parse(saved.filters(), clock), page, id);
  }

  ApiModels.Metrics metrics(String id) {
    var saved = get(id);
    return queries.metrics(EventFilter.parse(saved.filters(), clock), id);
  }

  private ApiModels.SavedSearch row(ResultSet rs, int n) throws SQLException {
    try {
      return new ApiModels.SavedSearch(
          rs.getString("id"),
          rs.getString("name"),
          rs.getString("version_id"),
          DashboardQueries.instant(rs, "created_at"),
          json.readValue(rs.getString("filters"), ApiModels.Filters.class),
          rs.getLong("event_count"),
          rs.getLong("finding_count"));
    } catch (java.io.IOException exception) {
      throw new IllegalStateException("Stored filters invalid");
    }
  }

  private String encode(Object value) {
    try {
      return json.writeValueAsString(value);
    } catch (Exception e) {
      throw new IllegalStateException("JSON encoding failed");
    }
  }
}
