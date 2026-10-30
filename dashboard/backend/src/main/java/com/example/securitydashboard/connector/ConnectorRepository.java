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
              rs.getString("server_url"),
              JdbcRows.instant(rs, "created_at"),
              JdbcRows.instant(rs, "last_used_at"),
              JdbcRows.instant(rs, "revoked_at"));
  private final JdbcTemplate jdbc;
  private final ObjectMapper json;

  ConnectorRepository(JdbcTemplate jdbc, ObjectMapper json) {
    this.jdbc = jdbc;
    this.json = json;
  }

  void insert(String id, String name, String serverUrl, String secretHash, Instant createdAt) {
    jdbc.update(
        "INSERT INTO detector_connectors(id,name,server_url,secret_hash,created_at) VALUES(?,?,?,?,?)",
        id,
        name,
        serverUrl,
        secretHash,
        Timestamp.from(createdAt));
  }

  /** 검사 서버 주소가 등록된 가장 최근의 유효한 연결. */
  Optional<String> latestServerUrl() {
    return jdbc
        .queryForList(
            "SELECT server_url FROM detector_connectors WHERE revoked_at IS NULL AND server_url IS NOT NULL"
                + " ORDER BY created_at DESC, id LIMIT 1",
            String.class)
        .stream()
        .findFirst();
  }

  boolean personExists(String personId) {
    return Boolean.TRUE.equals(
        jdbc.queryForObject(
            "SELECT EXISTS(SELECT 1 FROM people WHERE id=?)", Boolean.class, personId));
  }

  void insertEnrollment(String codeHash, String personId, Instant createdAt, Instant expiresAt) {
    jdbc.update(
        "INSERT INTO person_enrollments(code_hash,person_id,created_at,expires_at) VALUES(?,?,?,?)",
        codeHash,
        personId,
        Timestamp.from(createdAt),
        Timestamp.from(expiresAt));
  }

  /** 사용 가능한 코드면 한 번만 사용 처리하고 사람 ID와 이름을 돌려준다. */
  Optional<String[]> redeem(String codeHash, String connectorId, Instant at) {
    int updated =
        jdbc.update(
            "UPDATE person_enrollments SET used_at=?,used_by=? WHERE code_hash=? AND used_at IS NULL"
                + " AND expires_at>?",
            Timestamp.from(at),
            connectorId,
            codeHash,
            Timestamp.from(at));
    if (updated == 0) return Optional.empty();
    return jdbc
        .query(
            "SELECT p.id,p.name FROM person_enrollments e JOIN people p ON p.id=e.person_id"
                + " WHERE e.code_hash=?",
            (rs, i) -> new String[] {rs.getString("id"), rs.getString("name")},
            codeHash)
        .stream()
        .findFirst();
  }

  List<Connector> list() {
    return jdbc.query(
        "SELECT id,name,server_url,created_at,last_used_at,revoked_at FROM detector_connectors"
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
