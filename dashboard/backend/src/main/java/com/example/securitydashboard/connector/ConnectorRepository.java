package com.example.securitydashboard.connector;

import com.example.securitydashboard.common.JdbcRows;
import com.example.securitydashboard.connector.model.Connector;
import com.example.securitydashboard.connector.model.DetectorSettings;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

@Repository
class ConnectorRepository {
  private static final RowMapper<Connector> CONNECTOR =
      (rs, i) ->
          new Connector(
              rs.getString("id"),
              rs.getString("name"),
              JdbcRows.instant(rs, "created_at"),
              JdbcRows.instant(rs, "last_used_at"),
              JdbcRows.instant(rs, "revoked_at"));
  private final JdbcTemplate jdbc;
  private final ObjectMapper json;

  ConnectorRepository(JdbcTemplate jdbc, ObjectMapper json) {
    this.jdbc = jdbc;
    this.json = json;
  }

  void insert(String id, String name, String secretHash, Instant createdAt) {
    jdbc.update(
        "INSERT INTO detector_connectors(id,name,secret_hash,created_at) VALUES(?,?,?,?)",
        id,
        name,
        secretHash,
        Timestamp.from(createdAt));
  }

  List<Connector> list() {
    return jdbc.query(
        "SELECT id,name,created_at,last_used_at,revoked_at FROM detector_connectors"
            + " ORDER BY created_at DESC, id",
        CONNECTOR);
  }

  int revoke(String id, Instant at) {
    return jdbc.update(
        "UPDATE detector_connectors SET revoked_at=? WHERE id=? AND revoked_at IS NULL",
        Timestamp.from(at),
        id);
  }

  boolean anyIssued() {
    return Boolean.TRUE.equals(
        jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM detector_connectors)", Boolean.class));
  }

  Optional<String> activeIdByHash(String secretHash) {
    return jdbc
        .queryForList(
            "SELECT id FROM detector_connectors WHERE secret_hash=? AND revoked_at IS NULL",
            String.class,
            secretHash)
        .stream()
        .findFirst();
  }

  /** 사용 시각은 1분 간격으로만 기록한다(모든 요청마다 쓰지 않음). */
  void touch(String id, Instant at) {
    jdbc.update(
        "UPDATE detector_connectors SET last_used_at=? WHERE id=?"
            + " AND (last_used_at IS NULL OR last_used_at<?)",
        Timestamp.from(at),
        id,
        Timestamp.from(at.minus(Duration.ofMinutes(1))));
  }

  DetectorSettings settings(boolean forUpdate) {
    return jdbc.queryForObject(
        "SELECT report_text,tag_map,tag_action,jev_enabled,revision,updated_at FROM detector_settings"
            + " WHERE id=1"
            + (forUpdate ? " FOR UPDATE" : ""),
        (rs, i) ->
            new DetectorSettings(
                rs.getString("report_text"),
                readMap(rs.getString("tag_map")),
                rs.getString("tag_action"),
                rs.getBoolean("jev_enabled"),
                rs.getInt("revision"),
                JdbcRows.instant(rs, "updated_at")));
  }

  void updateSettings(
      String reportText,
      Map<String, String> tagMap,
      String tagAction,
      boolean jevEnabled,
      int revision,
      Instant at) {
    jdbc.update(
        "UPDATE detector_settings SET report_text=?,tag_map=?,tag_action=?,jev_enabled=?,revision=?,"
            + "updated_at=? WHERE id=1",
        reportText,
        writeMap(tagMap),
        tagAction,
        jevEnabled,
        revision,
        Timestamp.from(at));
  }

  private Map<String, String> readMap(String value) {
    try {
      return json.readValue(value, new TypeReference<java.util.LinkedHashMap<String, String>>() {});
    } catch (JsonProcessingException exception) {
      throw new IllegalStateException("Stored detector tag map is not valid JSON", exception);
    }
  }

  private String writeMap(Map<String, String> value) {
    try {
      return json.writeValueAsString(value);
    } catch (JsonProcessingException exception) {
      throw new IllegalStateException("Detector tag map cannot be serialized", exception);
    }
  }
}
