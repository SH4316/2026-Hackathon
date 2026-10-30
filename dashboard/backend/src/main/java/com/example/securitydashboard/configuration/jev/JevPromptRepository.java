package com.example.securitydashboard.configuration.jev;

import com.example.securitydashboard.common.JdbcRows;
import com.example.securitydashboard.configuration.model.JevOutput;
import com.example.securitydashboard.configuration.model.JevPrompt;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class JevPromptRepository {
  private final JdbcTemplate jdbc;

  public JevPromptRepository(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  public List<JevPrompt> list(String versionId) {
    Map<String, List<String>> outputs = new LinkedHashMap<>();
    jdbc.query(
        "SELECT prompt_id,tag_id FROM config_version_jev_outputs WHERE version_id=?"
            + " ORDER BY prompt_id,sort_order,tag_id",
        rs -> {
          outputs
              .computeIfAbsent(rs.getString("prompt_id"), ignored -> new ArrayList<>())
              .add(rs.getString("tag_id"));
        },
        versionId);
    return jdbc.query(
        "SELECT id,name,prompt,enabled FROM config_version_jev_prompts WHERE version_id=?"
            + " ORDER BY sort_order,id",
        (rs, row) ->
            new JevPrompt(
                rs.getString("id"),
                rs.getString("name"),
                rs.getString("prompt"),
                List.copyOf(outputs.getOrDefault(rs.getString("id"), List.of())),
                rs.getBoolean("enabled")),
        versionId);
  }

  long count(String versionId) {
    return jdbc.queryForObject(
        "SELECT COUNT(*) FROM config_version_jev_prompts WHERE version_id=?",
        Long.class,
        versionId);
  }

  boolean exists(String versionId, String promptId) {
    return Boolean.TRUE.equals(
        jdbc.queryForObject(
            "SELECT COUNT(*)>0 FROM config_version_jev_prompts WHERE version_id=? AND id=?",
            Boolean.class,
            versionId,
            promptId));
  }

  void insert(String versionId, String id, String name, String prompt, boolean enabled) {
    Integer order =
        jdbc.queryForObject(
            "SELECT COALESCE(MAX(sort_order),-1)+1 FROM config_version_jev_prompts"
                + " WHERE version_id=?",
            Integer.class,
            versionId);
    jdbc.update(
        "INSERT INTO config_version_jev_prompts(version_id,id,name,prompt,sort_order,enabled)"
            + " VALUES(?,?,?,?,?,?)",
        versionId,
        id,
        name,
        prompt,
        order,
        enabled);
  }

  void update(String versionId, String promptId, String name, String prompt, Boolean enabled) {
    jdbc.update(
        "UPDATE config_version_jev_prompts SET name=?,prompt=?,enabled=COALESCE(?,enabled)"
            + " WHERE version_id=? AND id=?",
        name,
        prompt,
        enabled,
        versionId,
        promptId);
  }

  void saveOutputs(String versionId, String promptId, List<JevOutput> outputs) {
    jdbc.update(
        "DELETE FROM config_version_jev_outputs WHERE version_id=? AND prompt_id=?",
        versionId,
        promptId);
    insertOutputs(versionId, promptId, outputs.stream().map(JevOutput::tagId).toList());
    for (var output : outputs)
      jdbc.update(
          "UPDATE config_version_tags SET jev_threshold=? WHERE version_id=? AND id=?",
          output.threshold(),
          versionId,
          output.tagId());
  }

  void delete(String versionId, String promptId) {
    jdbc.update(
        "DELETE FROM config_version_jev_prompts WHERE version_id=? AND id=?", versionId, promptId);
  }

  void incrementRevision(String versionId) {
    jdbc.update("UPDATE config_versions SET revision=revision+1 WHERE id=?", versionId);
  }

  public void insertAll(String versionId, List<JevPrompt> prompts) {
    List<Object[]> rows = new ArrayList<>();
    for (int i = 0; i < prompts.size(); i++) {
      var prompt = prompts.get(i);
      rows.add(
          new Object[] {
            versionId, prompt.id(), prompt.name(), prompt.prompt(), i, prompt.enabled()
          });
    }
    JdbcRows.insert(
        jdbc,
        "INSERT INTO config_version_jev_prompts(version_id,id,name,prompt,sort_order,enabled)"
            + " VALUES ",
        6,
        rows);
    for (var prompt : prompts) insertOutputs(versionId, prompt.id(), prompt.tagIds());
  }

  /** Catalog replacement cascades link deletion; definitions and surviving references remain. */
  public void restoreOutputs(
      String versionId, List<JevPrompt> prompts, Set<String> retainedTagIds) {
    for (var prompt : prompts)
      insertOutputs(
          versionId,
          prompt.id(),
          prompt.tagIds().stream().filter(retainedTagIds::contains).toList());
  }

  private void insertOutputs(String versionId, String promptId, List<String> tagIds) {
    List<Object[]> rows = new ArrayList<>();
    for (int i = 0; i < tagIds.size(); i++)
      rows.add(new Object[] {versionId, promptId, tagIds.get(i), i});
    JdbcRows.insert(
        jdbc,
        "INSERT INTO config_version_jev_outputs(version_id,prompt_id,tag_id,sort_order) VALUES ",
        4,
        rows);
  }
}
