package com.example.securitydashboard.configuration;

import com.example.securitydashboard.common.JdbcRows;
import com.example.securitydashboard.configuration.model.PolicyDefinition;
import com.example.securitydashboard.configuration.model.Tag;
import com.example.securitydashboard.configuration.model.VersionSummary;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
class ConfigurationRepository {
  private final JdbcTemplate jdbc;
  private final ObjectMapper json;

  ConfigurationRepository(JdbcTemplate jdbc, ObjectMapper json) {
    this.jdbc = jdbc;
    this.json = json;
  }

  List<VersionSummary> listVersions() {
    return jdbc.query(
        "SELECT v.*, (a.version_id=v.id) AS is_active FROM config_versions v LEFT JOIN"
            + " active_config a ON a.singleton_id=1 ORDER BY v.created_at DESC,v.id",
        this::summary);
  }

  Optional<VersionSummary> findVersion(String id) {
    return jdbc
        .query(
            "SELECT v.*, (a.version_id=v.id) AS is_active FROM config_versions v LEFT JOIN"
                + " active_config a ON a.singleton_id=1 WHERE v.id=?",
            this::summary,
            id)
        .stream()
        .findFirst();
  }

  String activeId() {
    return jdbc.queryForObject(
        "SELECT version_id FROM active_config WHERE singleton_id=1", String.class);
  }

  String lockActiveId() {
    return jdbc.queryForObject(
        "SELECT version_id FROM active_config WHERE singleton_id=1 FOR UPDATE", String.class);
  }

  Optional<VersionState> lockVersion(String id) {
    return jdbc
        .query(
            "SELECT status,revision FROM config_versions WHERE id=? FOR UPDATE",
            (rs, row) -> new VersionState(rs.getString("status"), rs.getLong("revision")),
            id)
        .stream()
        .findFirst();
  }

  void createVersion(String id, String name, Instant createdAt) {
    jdbc.update(
        "INSERT INTO config_versions(id,name,status,revision,created_at) VALUES(?,?,'DRAFT',0,?)",
        id,
        name,
        Timestamp.from(createdAt));
  }

  void updateVersionName(String id, String name) {
    jdbc.update("UPDATE config_versions SET name=?,revision=revision+1 WHERE id=?", name, id);
  }

  void updateTagDetails(String versionId, Tag tag) {
    jdbc.update(
        "UPDATE config_version_tags SET name=?,description=?,examples=?,guidance=?,jev_threshold=?,"
            + "python_regex=?,color=?,enabled=? WHERE version_id=? AND id=?",
        tag.name(),
        tag.description(),
        encode(tag.examples()),
        tag.guidance(),
        tag.jevThreshold(),
        tag.pythonRegex(),
        tag.color(),
        tag.enabled(),
        versionId,
        tag.id());
    jdbc.update("UPDATE config_versions SET revision=revision+1 WHERE id=?", versionId);
  }

  void publishVersion(String id, Instant publishedAt) {
    jdbc.update(
        "UPDATE config_versions SET status='PUBLISHED',published_at=?,revision=revision+1 WHERE"
            + " id=?",
        Timestamp.from(publishedAt),
        id);
  }

  void activateVersion(String id) {
    jdbc.update("UPDATE active_config SET version_id=? WHERE singleton_id=1", id);
  }

  void deleteVersion(String id) {
    jdbc.update("DELETE FROM config_versions WHERE id=?", id);
  }

  List<Tag> tags(String id) {
    return jdbc.query(
        "SELECT * FROM config_version_tags WHERE version_id=? ORDER BY sort_order,id",
        (rs, n) ->
            new Tag(
                rs.getString("id"),
                rs.getString("name"),
                rs.getString("description"),
                readExamples(rs.getString("examples")),
                rs.getString("guidance"),
                rs.getBigDecimal("jev_threshold"),
                rs.getString("python_regex"),
                rs.getString("color"),
                rs.getString("parent_id"),
                rs.getInt("sort_order"),
                rs.getBoolean("enabled")),
        id);
  }

  List<PolicyDefinition> policies(String id) {
    return jdbc.query(
        "SELECT * FROM config_version_policies WHERE version_id=? ORDER BY sort_order,id",
        (rs, n) ->
            new PolicyDefinition(
                rs.getString("id"),
                rs.getString("name"),
                rs.getString("description"),
                rs.getString("color"),
                rs.getInt("sort_order")),
        id);
  }

  void replaceCatalog(String id, List<Tag> tags, List<PolicyDefinition> policies) {
    jdbc.update("DELETE FROM config_tag_closure WHERE version_id=?", id);
    jdbc.update("DELETE FROM config_version_tags WHERE version_id=?", id);
    jdbc.update("DELETE FROM config_version_policies WHERE version_id=?", id);
    insertCatalog(id, tags, policies);
  }

  void insertCatalog(String id, List<Tag> tags, List<PolicyDefinition> policies) {
    JdbcRows.insert(
        jdbc,
        "INSERT INTO"
            + " config_version_tags(version_id,id,name,description,examples,guidance,jev_threshold,python_regex,color,parent_id,sort_order,enabled)"
            + " VALUES ",
        12,
        tags.stream()
            .map(
                t ->
                    new Object[] {
                      id,
                      t.id(),
                      t.name(),
                      t.description(),
                      encode(t.examples()),
                      t.guidance(),
                      t.jevThreshold(),
                      t.pythonRegex(),
                      t.color(),
                      t.parentId(),
                      t.order(),
                      t.enabled()
                    })
            .toList());
    Map<String, Tag> byId = new HashMap<>();
    tags.forEach(t -> byId.put(t.id(), t));
    List<Object[]> closure = new ArrayList<>();
    for (var tag : tags) {
      for (var parent = tag;
          parent != null;
          parent = parent.parentId() == null ? null : byId.get(parent.parentId()))
        closure.add(new Object[] {id, parent.id(), tag.id()});
    }
    JdbcRows.insert(
        jdbc,
        "INSERT INTO config_tag_closure(version_id,ancestor_id,descendant_id) VALUES ",
        3,
        closure);
    JdbcRows.insert(
        jdbc,
        "INSERT INTO config_version_policies(version_id,id,name,description,color,sort_order)"
            + " VALUES ",
        6,
        policies.stream()
            .map(p -> new Object[] {id, p.id(), p.name(), p.description(), p.color(), p.order()})
            .toList());
  }

  private List<String> readExamples(String value) {
    try {
      return json.readValue(value, new TypeReference<List<String>>() {});
    } catch (Exception exception) {
      throw new IllegalStateException("Stored examples invalid");
    }
  }

  private String encode(Object value) {
    try {
      return json.writeValueAsString(value);
    } catch (Exception exception) {
      throw new IllegalStateException("JSON encoding failed");
    }
  }

  private VersionSummary summary(ResultSet rs, int row) throws SQLException {
    return new VersionSummary(
        rs.getString("id"),
        rs.getString("name"),
        rs.getString("status"),
        rs.getBoolean("is_active"),
        rs.getLong("revision"),
        JdbcRows.instant(rs, "created_at"),
        JdbcRows.instant(rs, "published_at"));
  }
}
