package com.example.securitydashboard.configuration;

import com.example.securitydashboard.common.ApiException;
import com.example.securitydashboard.common.InputValidation;
import com.example.securitydashboard.configuration.jev.JevPromptRepository;
import com.example.securitydashboard.configuration.model.ConfigVersion;
import com.example.securitydashboard.configuration.model.CreateVersion;
import com.example.securitydashboard.configuration.model.PolicyDefinition;
import com.example.securitydashboard.configuration.model.Tag;
import com.example.securitydashboard.configuration.model.UpdateTagDetails;
import com.example.securitydashboard.configuration.model.UpdateVersion;
import com.example.securitydashboard.configuration.model.VersionSummary;
import java.math.BigDecimal;
import java.time.Clock;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional(readOnly = true)
public class ConfigurationService {
  private final ConfigurationRepository repository;
  private final JevPromptRepository jevPrompts;
  private final Clock clock;

  ConfigurationService(
      ConfigurationRepository repository, JevPromptRepository jevPrompts, Clock clock) {
    this.repository = repository;
    this.jevPrompts = jevPrompts;
    this.clock = clock;
  }

  List<VersionSummary> list() {
    return repository.listVersions();
  }

  public ConfigVersion get(String id) {
    InputValidation.validateId(id, "versionId");
    var version = repository.findVersion(id).orElseThrow(ConfigurationService::versionNotFound);
    return new ConfigVersion(
        version.id(),
        version.name(),
        version.status(),
        version.isActive(),
        version.revision(),
        version.createdAt(),
        version.publishedAt(),
        tags(id),
        policies(id),
        jevPrompts.list(id));
  }

  String activeId() {
    return repository.activeId();
  }

  public String lockActiveId() {
    return repository.lockActiveId();
  }

  ConfigVersion classifier() {
    String id = activeId();
    if (id == null)
      throw new ApiException(
          HttpStatus.NOT_FOUND, "NO_ACTIVE_VERSION", "활성 설정 버전이 없습니다. 게시한 버전을 활성화해 주세요.");
    return get(id);
  }

  public ConfigVersion view(String requested) {
    String id = requested == null ? activeId() : requested;
    if (id == null) return null;
    var version = get(id);
    if (!version.status().equals("PUBLISHED"))
      throw new ApiException(
          HttpStatus.UNPROCESSABLE_ENTITY, "VERSION_NOT_PUBLISHED", "게시한 버전만 조회 기준으로 사용할 수 있습니다.");
    return version;
  }

  @Transactional
  ConfigVersion create(CreateVersion input) {
    String name = InputValidation.name(input.name(), "name");
    var base = input.baseVersionId() == null ? null : get(input.baseVersionId());
    String id = "v_" + UUID.randomUUID().toString().replace("-", "");
    repository.createVersion(id, name, clock.instant());
    if (base != null) {
      repository.insertCatalog(id, base.tags(), base.policyStates());
      jevPrompts.insertAll(id, base.jevPrompts());
    }
    return get(id);
  }

  @Transactional
  ConfigVersion update(String id, UpdateVersion input) {
    lockDraft(id, input.revision());
    String name = InputValidation.name(input.name(), "name");
    List<Tag> tags = normalizeTags(input.tags());
    List<PolicyDefinition> policies = normalizePolicies(input.policyStates());
    var retainedPrompts = jevPrompts.list(id);
    repository.replaceCatalog(id, tags, policies);
    Set<String> retainedTagIds = new HashSet<>();
    tags.forEach(tag -> retainedTagIds.add(tag.id()));
    jevPrompts.restoreOutputs(id, retainedPrompts, retainedTagIds);
    repository.updateVersionName(id, name);
    return get(id);
  }

  @Transactional
  ConfigVersion updateTagDetails(String id, String tagId, UpdateTagDetails input) {
    InputValidation.validateId(tagId, "tagId");
    lockMetadataVersion(id, input.revision());
    var existing =
        tags(id).stream()
            .filter(tag -> tag.id().equals(tagId))
            .findFirst()
            .orElseThrow(
                () -> new ApiException(HttpStatus.NOT_FOUND, "TAG_NOT_FOUND", "태그를 찾을 수 없습니다."));
    var updated =
        normalizeTagDetails(
            new Tag(
                existing.id(),
                input.name(),
                input.description(),
                input.examples(),
                input.guidance(),
                input.jevThreshold(),
                input.pythonRegex(),
                input.color(),
                existing.parentId(),
                existing.order()));
    repository.updateTagDetails(id, updated);
    return get(id);
  }

  @Transactional
  ConfigVersion publish(String id, long revision) {
    lockDraft(id, revision);
    normalizeTags(tags(id));
    normalizePolicies(policies(id));
    repository.publishVersion(id, clock.instant());
    return get(id);
  }

  @Transactional
  ConfigVersion activate(String id) {
    lockActiveId();
    var version = get(id);
    if (!version.status().equals("PUBLISHED"))
      throw new ApiException(HttpStatus.CONFLICT, "VERSION_NOT_PUBLISHED", "게시한 버전만 활성화할 수 있습니다.");
    repository.activateVersion(id);
    return get(id);
  }

  @Transactional
  void delete(String id) {
    lockDraft(id, null);
    repository.deleteVersion(id);
  }

  private void lockDraft(String id, Long revision) {
    InputValidation.validateId(id, "versionId");
    lockActiveId();
    var version = repository.lockVersion(id).orElseThrow(ConfigurationService::versionNotFound);
    if (!version.status().equals("DRAFT"))
      throw new ApiException(
          HttpStatus.CONFLICT, "VERSION_IMMUTABLE", "게시한 버전은 수정하거나 삭제할 수 없습니다. 새 초안을 만들어 주세요.");
    if (revision != null) requireRevision(version, revision);
  }

  /** Shared metadata lock order also used by Jev edits and event capture. */
  @Transactional(propagation = Propagation.MANDATORY)
  public void lockMetadataVersion(String id, long revision) {
    InputValidation.validateId(id, "versionId");
    lockActiveId();
    var version = repository.lockVersion(id).orElseThrow(ConfigurationService::versionNotFound);
    requireRevision(version, revision);
  }

  private static void requireRevision(VersionState version, long revision) {
    if (version.revision() != revision)
      throw new ApiException(
          HttpStatus.CONFLICT, "REVISION_CONFLICT", "다른 변경이 저장되었습니다. 최신 버전을 불러와 주세요.");
  }

  public List<Tag> tags(String id) {
    return repository.tags(id);
  }

  List<PolicyDefinition> policies(String id) {
    return repository.policies(id);
  }

  private static ApiException versionNotFound() {
    return new ApiException(HttpStatus.NOT_FOUND, "VERSION_NOT_FOUND", "설정 버전을 찾을 수 없습니다.");
  }

  static List<Tag> normalizeTags(List<Tag> input) {
    if (input == null || input.size() > 1000)
      throw ApiException.invalid("tags", "태그 목록은 필수이며 최대 1000개입니다.");
    Map<String, Tag> values = new LinkedHashMap<>();
    for (var t : input) {
      if (t == null) throw ApiException.invalid("tags", "비어 있는 태그는 저장할 수 없습니다.");
      InputValidation.validateId(t.id(), "tags.id");
      if (t.parentId() != null) InputValidation.validateId(t.parentId(), "tags.parentId");
      var tag = normalizeTagDetails(t);
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

  static Tag normalizeTagDetails(Tag input) {
    List<String> examples = input.examples() == null ? List.of() : input.examples();
    if (examples.size() > 20) throw ApiException.invalid("examples", "예시는 최대 20개입니다.");
    for (String example : examples) {
      if (example == null) throw ApiException.invalid("examples", "예시는 문자열이어야 합니다.");
      InputValidation.text(example, 1000, "examples");
    }
    return new Tag(
        input.id(),
        InputValidation.name(input.name(), "tags.name"),
        InputValidation.text(input.description(), 4000, "description"),
        List.copyOf(examples),
        InputValidation.text(input.guidance(), 4000, "guidance"),
        normalizeJevThreshold(input.jevThreshold(), "tags.jevThreshold"),
        InputValidation.text(input.pythonRegex(), 4000, "tags.pythonRegex"),
        color(input.color()),
        input.parentId(),
        input.order() == null ? 0 : input.order());
  }

  public static BigDecimal normalizeJevThreshold(BigDecimal value, String field) {
    if (value != null
        && (value.compareTo(BigDecimal.ZERO) < 0
            || value.compareTo(BigDecimal.ONE) > 0
            || value.scale() > 6))
      throw ApiException.invalid(field, "임계값은 0~1 사이이며 소수점 아래 최대 6자리입니다.");
    return value;
  }

  static List<PolicyDefinition> normalizePolicies(List<PolicyDefinition> input) {
    if (input == null || input.size() > 1000)
      throw ApiException.invalid("policyStates", "정책 목록은 필수이며 최대 1000개입니다.");
    Set<String> ids = new HashSet<>();
    List<PolicyDefinition> result = new ArrayList<>();
    for (var p : input) {
      if (p == null) throw ApiException.invalid("policyStates", "비어 있는 정책은 저장할 수 없습니다.");
      InputValidation.validateId(p.id(), "policyStates.id");
      if (!ids.add(p.id())) throw ApiException.invalid("policyStates.id", "정책 ID는 중복될 수 없습니다.");
      result.add(
          new PolicyDefinition(
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
}
