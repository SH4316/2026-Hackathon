package com.example.securitydashboard.configuration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.example.securitydashboard.common.ApiException;
import com.example.securitydashboard.configuration.model.Tag;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class ConfigurationServiceTest {
  @Test
  void validatesTreeAndDefaultsWithoutInferringMeaning() {
    var normalized =
        ConfigurationService.normalizeTags(
            List.of(
                new Tag("root", "정책", null, null, null, null, null, null, null, null, true),
                new Tag("child", "같은 이름", null, null, null, null, null, "#abcdef", "root", 1, true)));
    assertThat(normalized.getFirst().examples()).isEmpty();
    assertThat(normalized.getFirst().enabled()).isTrue();
    assertThat(normalized.getFirst().jevThreshold()).isNull();
    assertThat(normalized.getFirst().pythonRegex()).isEmpty();
    assertThat(normalized.getFirst().color()).isEqualTo("#64748B");
    assertThat(normalized.get(1).color()).isEqualTo("#ABCDEF");
    assertThatThrownBy(
            () ->
                ConfigurationService.normalizeTags(
                    List.of(
                        new Tag("a", "A", null, null, null, null, null, null, "b", 0, true),
                        new Tag("b", "B", null, null, null, null, null, null, "a", 0, true))))
        .isInstanceOf(ApiException.class);
    assertThatThrownBy(
            () ->
                ConfigurationService.normalizeTags(
                    List.of(new Tag("a", "A", null, null, null, null, null, null, "missing", 0, true))))
        .isInstanceOf(ApiException.class);
    var deep = new ArrayList<Tag>();
    for (int i = 0; i < 33; i++)
      deep.add(
          new Tag(
              "n" + i, "N", null, null, null, null, null, null, i == 0 ? null : "n" + (i - 1), i, true));
    assertThatThrownBy(() -> ConfigurationService.normalizeTags(deep))
        .isInstanceOf(ApiException.class);
  }

  @Test
  void preservesSharedTagThresholdsAndIndependentPythonRegexWithoutInheritance() {
    String pattern = "(?im)^(?P<email>\\w+@example\\.com)$\r\n  ";
    var tags =
        ConfigurationService.normalizeTags(
            List.of(
                new Tag(
                    "root",
                    "부모",
                    null,
                    null,
                    "기존 가이드",
                    new BigDecimal("0.123456"),
                    pattern,
                    null,
                    null,
                    0, true),
                new Tag("child", "자식", null, null, null, null, null, null, "root", 1, true),
                new Tag(
                    "own",
                    "개별",
                    null,
                    null,
                    null,
                    BigDecimal.ONE,
                    "(?P<unfinished>[",
                    null,
                    "root",
                    2, true)));
    assertThat(tags.getFirst().jevThreshold()).isEqualByComparingTo("0.123456");
    assertThat(tags.getFirst().guidance()).isEqualTo("기존 가이드");
    assertThat(tags.getFirst().pythonRegex()).isEqualTo(pattern);
    assertThat(tags.get(1).jevThreshold()).isNull();
    assertThat(tags.get(1).pythonRegex()).isEmpty();
    assertThat(tags.get(2).jevThreshold()).isEqualByComparingTo(BigDecimal.ONE);
    assertThat(tags.get(2).pythonRegex()).isEqualTo("(?P<unfinished>[");
  }

  @Test
  void validatesThresholdRangeAndPrecisionWithoutRounding() {
    for (String allowed : List.of("0", "1", "0.123456"))
      assertThat(
              ConfigurationService.normalizeTags(
                      List.of(
                          new Tag(
                              "a",
                              "A",
                              null,
                              null,
                              null,
                              new BigDecimal(allowed),
                              null,
                              null,
                              null,
                              0, true)))
                  .getFirst()
                  .jevThreshold())
          .isEqualByComparingTo(allowed);
    for (String invalid : List.of("-0.000001", "1.000001", "0.1234567"))
      assertThatThrownBy(
              () ->
                  ConfigurationService.normalizeTags(
                      List.of(
                          new Tag(
                              "a",
                              "A",
                              null,
                              null,
                              null,
                              new BigDecimal(invalid),
                              null,
                              null,
                              null,
                              0, true))))
          .isInstanceOf(ApiException.class);
  }

  @Test
  void validatesPythonRegexTextLengthAndSurrogatesWithoutCompilingThePattern() {
    String maximum = "😀".repeat(4000);
    assertThat(
            ConfigurationService.normalizeTags(
                    List.of(new Tag("a", "A", null, null, null, null, maximum, null, null, 0, true)))
                .getFirst()
                .pythonRegex())
        .isEqualTo(maximum);
    for (String invalid : List.of(maximum + "x", "\uD800", "\uDC00", "x\uD800y"))
      assertThatThrownBy(
              () ->
                  ConfigurationService.normalizeTags(
                      List.of(new Tag("a", "A", null, null, null, null, invalid, null, null, 0, true))))
          .isInstanceOfSatisfying(
              ApiException.class,
              exception -> assertThat(exception.fields()).containsKey("tags.pythonRegex"));
  }
}
