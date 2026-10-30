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
                new ApiModels.Tag("root", "정책", null, null, null, null, null, null),
                new ApiModels.Tag("child", "같은 이름", null, null, null, "#abcdef", "root", 1)));
    assertThat(normalized.getFirst().examples()).isEmpty();
    assertThat(normalized.getFirst().color()).isEqualTo("#64748B");
    assertThat(normalized.get(1).color()).isEqualTo("#ABCDEF");
    assertThatThrownBy(
            () ->
                ConfigurationService.normalizeTags(
                    List.of(
                        new ApiModels.Tag("a", "A", null, null, null, null, "b", 0),
                        new ApiModels.Tag("b", "B", null, null, null, null, "a", 0))))
        .isInstanceOf(ApiException.class);
    assertThatThrownBy(
            () ->
                ConfigurationService.normalizeTags(
                    List.of(new ApiModels.Tag("a", "A", null, null, null, null, "missing", 0))))
        .isInstanceOf(ApiException.class);
    var deep = new ArrayList<ApiModels.Tag>();
    for (int i = 0; i < 33; i++)
      deep.add(
          new ApiModels.Tag(
              "n" + i, "N", null, null, null, null, i == 0 ? null : "n" + (i - 1), i));
    assertThatThrownBy(() -> ConfigurationService.normalizeTags(deep))
        .isInstanceOf(ApiException.class);
  }
}
