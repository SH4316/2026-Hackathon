package com.example.securitydashboard.configuration;

import com.example.securitydashboard.api.ApiModels;
import com.example.securitydashboard.common.ApiException;
import com.example.securitydashboard.common.InputValidation;
import com.example.securitydashboard.common.JdbcRows;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Clock;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional(readOnly = true)
public class ConfigurationService {
  private final JdbcTemplate jdbc;
  private final ObjectMapper json;
  private final Clock clock;

  ConfigurationService(JdbcTemplate jdbc, ObjectMapper json, Clock clock) {
    this.jdbc = jdbc;
    this.json = json;
    this.clock = clock;
  }

  List<ApiModels.VersionSummary> list() {
    return jdbc.query(
        "SELECT v.*, (a.version_id=v.id) AS is_active FROM config_versions v LEFT JOIN"
            + " active_config a ON a.singleton_id=1 ORDER BY v.created_at DESC,v.id",
        this::summary);
  }

  public ApiModels.ConfigVersion get(String id) {
    InputValidation.validateId(id, "versionId");
    var rows =
        jdbc.query(
            "SELECT v.*, (a.version_id=v.id) AS is_active FROM config_versions v LEFT JOIN"
                + " active_config a ON a.singleton_id=1 WHERE v.id=?",
            this::summary,
            id);
    if (rows.isEmpty())
      throw new ApiException(HttpStatus.NOT_FOUND, "VERSION_NOT_FOUND", "설정 버전을 찾을 수 없습니다.");
    var v = rows.getFirst();
    return new ApiModels.ConfigVersion(
        v.id(),
        v.name(),
        v.status(),
        v.isActive(),
        v.revision(),
        v.createdAt(),
        v.publishedAt(),
        tags(id),
        policies(id));
  }

  String activeId() {
    return jdbc.queryForObject(
        "SELECT version_id FROM active_config WHERE singleton_id=1", String.class);
  }

  public String lockActiveId() {
    return jdbc.queryForObject(
        "SELECT version_id FROM active_config WHERE singleton_id=1 FOR UPDATE", String.class);
  }

  ApiModels.ConfigVersion classifier() {
    String id = activeId();
    if (id == null)
      throw new ApiException(
          HttpStatus.NOT_FOUND, "NO_ACTIVE_VERSION", "활성 설정 버전이 없습니다. 게시한 버전을 활성화해 주세요.");
    return get(id);
  }

  public ApiModels.ConfigVersion view(String requested) {
    String id = requested == null ? activeId() : requested;
    if (id == null) return null;
    var version = get(id);
    if (!version.status().equals("PUBLISHED"))
      throw new ApiException(
          HttpStatus.UNPROCESSABLE_ENTITY, "VERSION_NOT_PUBLISHED", "게시한 버전만 조회 기준으로 사용할 수 있습니다.");
    return version;
  }

  @Transactional
  ApiModels.ConfigVersion create(ApiModels.CreateVersion input) {
    String name = InputValidation.name(input.name(), "name");
    var base = input.baseVersionId() == null ? null : get(input.baseVersionId());
    String id = "v_" + UUID.randomUUID().toString().replace("-", "");
    jdbc.update(
        "INSERT INTO config_versions(id,name,status,revision,created_at) VALUES(?,?,'DRAFT',0,?)",
        id,
        name,
        Timestamp.from(clock.instant()));
    if (base != null) writeCatalog(id, base.tags(), base.policyStates());
    return get(id);
  }

  @Transactional
  ApiModels.ConfigVersion update(String id, ApiModels.UpdateVersion input) {
    lockDraft(id, input.revision());
    String name = InputValidation.name(input.name(), "name");
    List<ApiModels.Tag> tags = normalizeTags(input.tags());
    List<ApiModels.PolicyDefinition> policies = normalizePolicies(input.policyStates());
    jdbc.update("DELETE FROM config_tag_closure WHERE version_id=?", id);
    jdbc.update("DELETE FROM config_version_tags WHERE version_id=?", id);
    jdbc.update("DELETE FROM config_version_policies WHERE version_id=?", id);
    writeCatalog(id, tags, policies);
    jdbc.update("UPDATE config_versions SET name=?,revision=revision+1 WHERE id=?", name, id);
    return get(id);
  }

  @Transactional
  ApiModels.ConfigVersion publish(String id, long revision) {
    lockDraft(id, revision);
    normalizeTags(tags(id));
    normalizePolicies(policies(id));
    jdbc.update(
        "UPDATE config_versions SET status='PUBLISHED',published_at=?,revision=revision+1 WHERE"
            + " id=?",
        Timestamp.from(clock.instant()),
        id);
    return get(id);
  }

  @Transactional
  ApiModels.ConfigVersion activate(String id) {
    lockActiveId();
    var version = get(id);
    if (!version.status().equals("PUBLISHED"))
      throw new ApiException(HttpStatus.CONFLICT, "VERSION_NOT_PUBLISHED", "게시한 버전만 활성화할 수 있습니다.");
    jdbc.update("UPDATE active_config SET version_id=? WHERE singleton_id=1", id);
    return get(id);
  }

  @Transactional
  void delete(String id) {
    lockDraft(id, null);
    jdbc.update("DELETE FROM config_versions WHERE id=?", id);
  }

  private void lockDraft(String id, Long revision) {
    InputValidation.validateId(id, "versionId");
    var values =
        jdbc.queryForList("SELECT status,revision FROM config_versions WHERE id=? FOR UPDATE", id);
    if (values.isEmpty())
      throw new ApiException(HttpStatus.NOT_FOUND, "VERSION_NOT_FOUND", "설정 버전을 찾을 수 없습니다.");
    var value = values.getFirst();
    if (!value.get("status").equals("DRAFT"))
      throw new ApiException(
          HttpStatus.CONFLICT, "VERSION_IMMUTABLE", "게시한 버전은 수정하거나 삭제할 수 없습니다. 새 초안을 만들어 주세요.");
    if (revision != null && ((Number) value.get("revision")).longValue() != revision)
      throw new ApiException(
          HttpStatus.CONFLICT, "REVISION_CONFLICT", "다른 변경이 저장되었습니다. 최신 버전을 불러와 주세요.");
  }

  public List<ApiModels.Tag> tags(String id) {
    return jdbc.query(
        "SELECT * FROM config_version_tags WHERE version_id=? ORDER BY sort_order,id",
        (rs, n) ->
            new ApiModels.Tag(
                rs.getString("id"),
                rs.getString("name"),
                rs.getString("description"),
                readExamples(rs.getString("examples")),
                rs.getString("guidance"),
                rs.getString("jev_prompt"),
                rs.getString("python_regex"),
                rs.getString("color"),
                rs.getString("parent_id"),
                rs.getInt("sort_order")),
        id);
  }

  List<ApiModels.PolicyDefinition> policies(String id) {
    return jdbc.query(
        "SELECT * FROM config_version_policies WHERE version_id=? ORDER BY sort_order,id",
        (rs, n) ->
            new ApiModels.PolicyDefinition(
                rs.getString("id"),
                rs.getString("name"),
                rs.getString("description"),
                rs.getString("color"),
                rs.getInt("sort_order")),
        id);
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
    } catch (Exception e) {
      throw new IllegalStateException("JSON encoding failed");
    }
  }

  private void writeCatalog(
      String id, List<ApiModels.Tag> tags, List<ApiModels.PolicyDefinition> policies) {
    JdbcRows.insert(
        jdbc,
        "INSERT INTO"
            + " config_version_tags(version_id,id,name,description,examples,guidance,jev_prompt,python_regex,color,parent_id,sort_order)"
            + " VALUES ",
        11,
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
                      t.jevPrompt(),
                      t.pythonRegex(),
                      t.color(),
                      t.parentId(),
                      t.order()
                    })
            .toList());
    Map<String, ApiModels.Tag> byId = new HashMap<>();
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

  static List<ApiModels.Tag> normalizeTags(List<ApiModels.Tag> input) {
    if (input == null || input.size() > 1000)
      throw ApiException.invalid("tags", "태그 목록은 필수이며 최대 1000개입니다.");
    Map<String, ApiModels.Tag> values = new LinkedHashMap<>();
    for (var t : input) {
      if (t == null) throw ApiException.invalid("tags", "비어 있는 태그는 저장할 수 없습니다.");
      InputValidation.validateId(t.id(), "tags.id");
      if (t.parentId() != null) InputValidation.validateId(t.parentId(), "tags.parentId");
      List<String> examples = t.examples() == null ? List.of() : t.examples();
      if (examples.size() > 20) throw ApiException.invalid("examples", "예시는 최대 20개입니다.");
      for (String example : examples) {
        if (example == null) throw ApiException.invalid("examples", "예시는 문자열이어야 합니다.");
        InputValidation.text(example, 1000, "examples");
      }
      var tag =
          new ApiModels.Tag(
              t.id(),
              InputValidation.name(t.name(), "tags.name"),
              InputValidation.text(t.description(), 4000, "description"),
              List.copyOf(examples),
              InputValidation.text(t.guidance(), 4000, "guidance"),
              InputValidation.text(t.jevPrompt(), 12000, "tags.jevPrompt"),
              InputValidation.text(t.pythonRegex(), 4000, "tags.pythonRegex"),
              color(t.color()),
              t.parentId(),
              t.order() == null ? 0 : t.order());
      if (values.putIfAbsent(t.id(), tag) != null)
        throw ApiException.invalid("tags.id", "한 버전에 동일한 태그 ID를 두 번 사용할 수 없습니다.");
    }
    for (var tag : values.values()) {
      Set<String> visited = new HashSet<>();
      for (var node = tag;
          node != null;
          node = node.parentId() == null ? null : values.get(node.parentId())) {
        if (!visited.add(node.id()))
          throw ApiException.invalid("tags.parentId", "태그 트리에 순환 관계가 있습니다.");
        if (visited.size() > 32) throw ApiException.invalid("tags.parentId", "태그 트리는 최대 32단계입니다.");
        if (node.parentId() != null && !values.containsKey(node.parentId()))
          throw ApiException.invalid("tags.parentId", "부모 태그가 같은 버전에 있어야 합니다.");
      }
    }
    return List.copyOf(values.values());
  }

  static List<ApiModels.PolicyDefinition> normalizePolicies(
      List<ApiModels.PolicyDefinition> input) {
    if (input == null || input.size() > 1000)
      throw ApiException.invalid("policyStates", "정책 목록은 필수이며 최대 1000개입니다.");
    Set<String> ids = new HashSet<>();
    List<ApiModels.PolicyDefinition> result = new ArrayList<>();
    for (var p : input) {
      if (p == null) throw ApiException.invalid("policyStates", "비어 있는 정책은 저장할 수 없습니다.");
      InputValidation.validateId(p.id(), "policyStates.id");
      if (!ids.add(p.id())) throw ApiException.invalid("policyStates.id", "정책 ID는 중복될 수 없습니다.");
      result.add(
          new ApiModels.PolicyDefinition(
              p.id(),
              InputValidation.name(p.name(), "policyStates.name"),
              InputValidation.text(p.description(), 4000, "description"),
              color(p.color()),
              p.order() == null ? 0 : p.order()));
    }
    return List.copyOf(result);
  }

  static String color(String color) {
    if (color == null || color.isBlank()) return "#64748B";
    if (!color.matches("#[a-fA-F0-9]{6}"))
      throw ApiException.invalid("color", "색상은 #RRGGBB 형식이어야 합니다.");
    return color.toUpperCase(Locale.ROOT);
  }

  private ApiModels.VersionSummary summary(ResultSet rs, int row) throws SQLException {
    return new ApiModels.VersionSummary(
        rs.getString("id"),
        rs.getString("name"),
        rs.getString("status"),
        rs.getBoolean("is_active"),
        rs.getLong("revision"),
        JdbcRows.instant(rs, "created_at"),
        JdbcRows.instant(rs, "published_at"));
  }
}
