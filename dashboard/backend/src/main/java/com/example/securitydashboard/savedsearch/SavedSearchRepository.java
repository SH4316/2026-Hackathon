package com.example.securitydashboard.savedsearch;

import com.example.securitydashboard.common.JdbcRows;
import com.example.securitydashboard.query.model.Filters;
import com.example.securitydashboard.savedsearch.model.SavedSearch;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

/** Stores snapshot metadata; event membership is captured by the dashboard query repository. */
@Repository
class SavedSearchRepository {
  private final NamedParameterJdbcTemplate jdbc;
  private final ObjectMapper json;

  SavedSearchRepository(NamedParameterJdbcTemplate jdbc, ObjectMapper json) {
    this.jdbc = jdbc;
    this.json = json;
  }

  void insert(String id, String name, String versionId, Instant createdAt, Filters filters) {
    var params =
        new MapSqlParameterSource()
            .addValue("id", id)
            .addValue("name", name)
            .addValue("versionId", versionId)
            .addValue("createdAt", Timestamp.from(createdAt))
            .addValue("filters", encode(filters));
    jdbc.update(
        "INSERT INTO"
            + " saved_searches(id,name,version_id,created_at,filters,event_count,finding_count)"
            + " VALUES(:id,:name,:versionId,:createdAt,:filters,0,0)",
        params);
  }

  void updateCounts(String id, long eventCount, long findingCount) {
    jdbc.update(
        "UPDATE saved_searches SET event_count=:eventCount,finding_count=:findingCount WHERE"
            + " id=:id",
        Map.of("id", id, "eventCount", eventCount, "findingCount", findingCount));
  }

  List<SavedSearch> list() {
    return jdbc.query("SELECT * FROM saved_searches ORDER BY created_at DESC,id", this::row);
  }

  SavedSearch find(String id) {
    var rows = jdbc.query("SELECT * FROM saved_searches WHERE id=:id", Map.of("id", id), this::row);
    return rows.isEmpty() ? null : rows.getFirst();
  }

  void delete(String id) {
    jdbc.update("DELETE FROM saved_searches WHERE id=:id", Map.of("id", id));
  }

  private SavedSearch row(ResultSet rs, int rowNumber) throws SQLException {
    try {
      return new SavedSearch(
          rs.getString("id"),
          rs.getString("name"),
          rs.getString("version_id"),
          JdbcRows.instant(rs, "created_at"),
          json.readValue(rs.getString("filters"), Filters.class),
          rs.getLong("event_count"),
          rs.getLong("finding_count"));
    } catch (JsonProcessingException exception) {
      throw new IllegalStateException("Stored filters invalid");
    }
  }

  private String encode(Filters filters) {
    try {
      return json.writeValueAsString(filters);
    } catch (JsonProcessingException exception) {
      throw new IllegalStateException("JSON encoding failed");
    }
  }
}
