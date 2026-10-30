package com.example.securitydashboard.configuration.jev;

import com.example.securitydashboard.common.ApiException;
import com.example.securitydashboard.common.InputValidation;
import com.example.securitydashboard.configuration.ConfigurationService;
import com.example.securitydashboard.configuration.model.ConfigVersion;
import com.example.securitydashboard.configuration.model.DeleteJevPrompt;
import com.example.securitydashboard.configuration.model.JevOutput;
import com.example.securitydashboard.configuration.model.SaveJevPrompt;
import com.example.securitydashboard.configuration.model.Tag;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional(readOnly = true)
public class JevPromptService {
  private static final int MAX_PROMPTS = 100;
  private final ConfigurationService configs;
  private final JevPromptRepository repository;

  public JevPromptService(ConfigurationService configs, JevPromptRepository repository) {
    this.configs = configs;
    this.repository = repository;
  }

  @Transactional
  public ConfigVersion create(String versionId, SaveJevPrompt input) {
    configs.lockMetadataVersion(versionId, input.revision());
    String name = InputValidation.name(input.name(), "name");
    String prompt = InputValidation.text(input.prompt(), 12000, "prompt");
    var outputs = normalizeOutputs(versionId, input.outputs());
    if (repository.count(versionId) >= MAX_PROMPTS)
      throw ApiException.invalid("jevPrompts", "한 버전에 Jev 프롬프트는 최대 100개까지 추가할 수 있습니다.");
    String id = "j_" + UUID.randomUUID().toString().replace("-", "");
    repository.insert(versionId, id, name, prompt);
    repository.saveOutputs(versionId, id, outputs);
    repository.incrementRevision(versionId);
    return configs.get(versionId);
  }

  @Transactional
  public ConfigVersion update(String versionId, String promptId, SaveJevPrompt input) {
    configs.lockMetadataVersion(versionId, input.revision());
    requirePrompt(versionId, promptId);
    String name = InputValidation.name(input.name(), "name");
    String prompt = InputValidation.text(input.prompt(), 12000, "prompt");
    var outputs = normalizeOutputs(versionId, input.outputs());
    repository.update(versionId, promptId, name, prompt);
    repository.saveOutputs(versionId, promptId, outputs);
    repository.incrementRevision(versionId);
    return configs.get(versionId);
  }

  @Transactional
  public ConfigVersion delete(String versionId, String promptId, DeleteJevPrompt input) {
    configs.lockMetadataVersion(versionId, input.revision());
    requirePrompt(versionId, promptId);
    repository.delete(versionId, promptId);
    repository.incrementRevision(versionId);
    return configs.get(versionId);
  }

  private void requirePrompt(String versionId, String promptId) {
    InputValidation.validateId(promptId, "promptId");
    if (!repository.exists(versionId, promptId))
      throw new ApiException(HttpStatus.NOT_FOUND, "JEV_PROMPT_NOT_FOUND", "Jev 프롬프트를 찾을 수 없습니다.");
  }

  private List<JevOutput> normalizeOutputs(String versionId, List<JevOutput> input) {
    if (input == null || input.size() > 1000)
      throw ApiException.invalid("outputs", "출력 목록은 필수이며 최대 1000개입니다.");
    Set<String> existing =
        configs.tags(versionId).stream().map(Tag::id).collect(Collectors.toSet());
    Set<String> selected = new HashSet<>();
    List<JevOutput> outputs = new ArrayList<>();
    for (var output : input) {
      if (output == null) throw ApiException.invalid("outputs", "비어 있는 출력은 저장할 수 없습니다.");
      InputValidation.validateId(output.tagId(), "outputs.tagId");
      if (!selected.add(output.tagId()))
        throw ApiException.invalid("outputs.tagId", "출력 태그는 중복될 수 없습니다.");
      if (!existing.contains(output.tagId()))
        throw ApiException.invalid("outputs.tagId", "출력 태그가 같은 버전에 있어야 합니다.");
      outputs.add(
          new JevOutput(
              output.tagId(),
              ConfigurationService.normalizeJevThreshold(output.threshold(), "outputs.threshold")));
    }
    return List.copyOf(outputs);
  }
}
