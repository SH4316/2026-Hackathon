package com.example.securitydashboard.configuration;

import static org.assertj.core.api.Assertions.*;

import com.example.securitydashboard.api.ApiModels;
import com.example.securitydashboard.common.ApiException;
import java.util.*;
import org.junit.jupiter.api.Test;

class ConfigurationServiceTest {
  @Test
  void validatesTreeAndDefaultsWithoutInferringMeaning() {
    var normalized =
        ConfigurationService.normalizeTags(
            List.of(
                new ApiModels.Tag("root", "정책", null, null, null, null, null, null, null, null),
                new ApiModels.Tag(
                    "child", "같은 이름", null, null, null, null, null, "#abcdef", "root", 1)));
    assertThat(normalized.getFirst().examples()).isEmpty();
    assertThat(normalized.getFirst().jevPrompt()).isEmpty();
    assertThat(normalized.getFirst().pythonRegex()).isEmpty();
    assertThat(normalized.getFirst().color()).isEqualTo("#64748B");
    assertThat(normalized.get(1).color()).isEqualTo("#ABCDEF");
    assertThatThrownBy(
            () ->
                ConfigurationService.normalizeTags(
                    List.of(
                        new ApiModels.Tag("a", "A", null, null, null, null, null, null, "b", 0),
                        new ApiModels.Tag("b", "B", null, null, null, null, null, null, "a", 0))))
        .isInstanceOf(ApiException.class);
    assertThatThrownBy(
            () ->
                ConfigurationService.normalizeTags(
                    List.of(
                        new ApiModels.Tag(
                            "a", "A", null, null, null, null, null, null, "missing", 0))))
        .isInstanceOf(ApiException.class);
    var deep = new ArrayList<ApiModels.Tag>();
    for (int i = 0; i < 33; i++)
      deep.add(
          new ApiModels.Tag(
              "n" + i, "N", null, null, null, null, null, null, i == 0 ? null : "n" + (i - 1), i));
    assertThatThrownBy(() -> ConfigurationService.normalizeTags(deep))
        .isInstanceOf(ApiException.class);
  }

  @Test
  void preservesJevPromptsAndPythonRegexWithIndependentTagValues() {
    String prompt = "  판단 기준 😀\r\n\t다음 줄\n ";
    String pattern = "(?im)^(?P<email>\\w+@example\\.com)$\r\n  ";
    var tags =
        ConfigurationService.normalizeTags(
            List.of(
                new ApiModels.Tag(
                    "root", "부모", null, null, "기존 가이드", prompt, pattern, null, null, 0),
                new ApiModels.Tag("child", "자식", null, null, null, null, null, null, "root", 1),
                new ApiModels.Tag(
                    "own", "개별", null, null, null, "자체 판단", "(?P<unfinished>[", null, "root", 2)));
    assertThat(tags.getFirst().jevPrompt()).isEqualTo(prompt);
    assertThat(tags.getFirst().guidance()).isEqualTo("기존 가이드");
    assertThat(tags.getFirst().pythonRegex()).isEqualTo(pattern);
    assertThat(tags.get(1).jevPrompt()).isEmpty();
    assertThat(tags.get(1).pythonRegex()).isEmpty();
    assertThat(tags.get(2).jevPrompt()).isEqualTo("자체 판단");
    assertThat(tags.get(2).pythonRegex()).isEqualTo("(?P<unfinished>[");
  }

  @Test
  void validatesJevPromptByUnicodeCodePointsAndRejectsMalformedSurrogates() {
    String maximum = "😀".repeat(12000);
    assertThat(
            ConfigurationService.normalizeTags(
                    List.of(
                        new ApiModels.Tag(
                            "a", "A", null, null, null, maximum, null, null, null, 0)))
                .getFirst()
                .jevPrompt())
        .isEqualTo(maximum);
    for (String invalid : List.of(maximum + "x", "\uD800", "\uDC00", "x\uD800y"))
      assertThatThrownBy(
              () ->
                  ConfigurationService.normalizeTags(
                      List.of(
                          new ApiModels.Tag(
                              "a", "A", null, null, null, invalid, null, null, null, 0))))
          .isInstanceOf(ApiException.class)
          .hasMessageContaining("입력값");
  }

  @Test
  void validatesPythonRegexTextLengthAndSurrogatesWithoutCompilingThePattern() {
    String maximum = "😀".repeat(4000);
    assertThat(
            ConfigurationService.normalizeTags(
                    List.of(
                        new ApiModels.Tag(
                            "a", "A", null, null, null, null, maximum, null, null, 0)))
                .getFirst()
                .pythonRegex())
        .isEqualTo(maximum);
    for (String invalid : List.of(maximum + "x", "\uD800", "\uDC00", "x\uD800y"))
      assertThatThrownBy(
              () ->
                  ConfigurationService.normalizeTags(
                      List.of(
                          new ApiModels.Tag(
                              "a", "A", null, null, null, null, invalid, null, null, 0))))
          .isInstanceOfSatisfying(
              ApiException.class,
              exception -> assertThat(exception.fields()).containsKey("tags.pythonRegex"));
  }
}
