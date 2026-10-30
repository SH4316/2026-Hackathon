package com.example.securitydashboard.configuration;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.example.securitydashboard.common.ApiException;
import com.example.securitydashboard.configuration.jev.JevPromptRepository;
import com.example.securitydashboard.configuration.model.Tag;
import com.example.securitydashboard.configuration.model.TagInput;
import com.example.securitydashboard.configuration.model.UpdateTagDetails;
import com.example.securitydashboard.configuration.model.UpdateVersion;
import com.example.securitydashboard.configuration.model.VersionSummary;
import com.example.securitydashboard.guard.TagRegexValidator;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.AnnotationTransactionAttributeSource;
import org.springframework.transaction.interceptor.TransactionInterceptor;
import org.springframework.transaction.support.AbstractPlatformTransactionManager;
import org.springframework.transaction.support.DefaultTransactionStatus;
import org.springframework.transaction.support.TransactionSynchronizationManager;

class ConfigurationRegexValidationTest {
  private final ConfigurationRepository repository = mock(ConfigurationRepository.class);
  private final JevPromptRepository prompts = mock(JevPromptRepository.class);
  private final TagRegexValidator validator = mock(TagRegexValidator.class);
  private final TestTransactions transactions = new TestTransactions();
  private final Tag original = tag("before");
  private ConfigurationService service;

  @BeforeEach
  void setup() {
    when(repository.findVersion("v1")).thenReturn(Optional.of(
        new VersionSummary("v1", "설정", "DRAFT", false, 3, Instant.EPOCH, null)));
    when(repository.lockVersion("v1")).thenReturn(Optional.of(new VersionState("DRAFT", 3)));
    when(repository.tags("v1")).thenReturn(List.of(original));
    when(repository.policies("v1")).thenReturn(List.of());
    when(prompts.list("v1")).thenReturn(List.of());
    var target = new ConfigurationService(repository, prompts, Clock.systemUTC(), validator, transactions);
    var factory = new ProxyFactory(target);
    factory.addAdvice(new TransactionInterceptor(transactions, new AnnotationTransactionAttributeSource()));
    service = (ConfigurationService) factory.getProxy();
  }

  @ParameterizedTest
  @ValueSource(booleans = {false, true})
  void validatesBeforeStartingWriteTransactionAndSavesAtomically(boolean details) {
    doAnswer(call -> {
      assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isFalse();
      assertThat(transactions.begins).isZero();
      assertThat((List<Tag>) call.getArgument(0)).containsExactly(tag("after"));
      assertThat((List<Tag>) call.getArgument(1)).containsExactly(original);
      verify(repository, never()).lockActiveId();
      return null;
    }).when(validator).validateChanged(anyList(), anyList());
    doAnswer(call -> {
      assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isTrue();
      return null;
    }).when(repository).lockActiveId();

    save(details);

    assertThat(transactions.begins).isEqualTo(1);
    assertThat(transactions.commits).isEqualTo(1);
    assertThat(transactions.rollbacks).isZero();
    verify(validator).validateChanged(anyList(), eq(List.of(original)));
    if (details) {
      verify(repository).updateTagDetails("v1", tag("after"));
      verify(repository, never()).replaceCatalog(anyString(), anyList(), anyList());
    } else {
      verify(repository).replaceCatalog("v1", List.of(tag("after")), List.of());
      verify(repository).updateVersionName("v1", "설정");
    }
  }

  @ParameterizedTest
  @ValueSource(booleans = {false, true})
  void invalidRegexPreventsAllWritesAndRevisionChanges(boolean details) {
    var failure = ApiException.invalid("tags.tag.pythonRegex", "Python 정규식 문법이 올바르지 않습니다.");
    doThrow(failure).when(validator).validateChanged(anyList(), anyList());
    assertThatThrownBy(() -> save(details)).isSameAs(failure);
    assertNoWrites();
    assertThat(transactions.begins).isZero();
  }

  @ParameterizedTest
  @ValueSource(booleans = {false, true})
  void unavailableGuardPreventsAllWrites(boolean details) {
    doThrow(new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "GUARD_UNAVAILABLE", "검사 서버 연결 실패"))
        .when(validator).validateChanged(anyList(), anyList());
    assertThatThrownBy(() -> save(details)).isInstanceOfSatisfying(ApiException.class, error ->
        assertThat(error.code()).isEqualTo("GUARD_UNAVAILABLE"));
    assertNoWrites();
    assertThat(transactions.begins).isZero();
  }

  @ParameterizedTest
  @ValueSource(booleans = {false, true})
  void revisionIsRecheckedAfterServerValidation(boolean details) {
    doAnswer(call -> {
      when(repository.lockVersion("v1")).thenReturn(Optional.of(new VersionState("DRAFT", 4)));
      return null;
    }).when(validator).validateChanged(anyList(), anyList());
    assertThatThrownBy(() -> save(details)).isInstanceOfSatisfying(ApiException.class, error ->
        assertThat(error.code()).isEqualTo("REVISION_CONFLICT"));
    assertNoWrites();
    assertThat(transactions.rollbacks).isEqualTo(1);
  }

  @Test
  void publishedTagDetailsRemainEditableWithRegexValidation() {
    when(repository.findVersion("v1")).thenReturn(Optional.of(
        new VersionSummary("v1", "설정", "PUBLISHED", true, 3, Instant.EPOCH, Instant.EPOCH)));
    when(repository.lockVersion("v1")).thenReturn(Optional.of(new VersionState("PUBLISHED", 3)));
    save(true);
    verify(validator).validateChanged(List.of(tag("after")), List.of(original));
    verify(repository).updateTagDetails("v1", tag("after"));
  }

  @Test
  void staleRevisionIsRejectedBeforeContactingGuard() {
    when(repository.findVersion("v1")).thenReturn(Optional.of(
        new VersionSummary("v1", "설정", "DRAFT", false, 4, Instant.EPOCH, null)));
    assertThatThrownBy(() -> save(false)).isInstanceOfSatisfying(ApiException.class, error ->
        assertThat(error.code()).isEqualTo("REVISION_CONFLICT"));
    verifyNoInteractions(validator);
    assertNoWrites();
  }

  private void save(boolean details) {
    if (details) {
      service.updateTagDetails("v1", "tag",
          new UpdateTagDetails(3L, "태그", "", List.of(), "", null, "after", "#123456", true));
    } else {
      service.update("v1", new UpdateVersion(3L, "설정", List.of(
          new TagInput("tag", "태그", "", List.of(), "", null, "after", "#123456", null, 0, true)), List.of()));
    }
  }

  private Tag tag(String regex) {
    return new Tag("tag", "태그", "", List.of(), "", null, regex, "#123456", null, 0, true);
  }

  private void assertNoWrites() {
    verify(repository, never()).replaceCatalog(anyString(), anyList(), anyList());
    verify(repository, never()).updateTagDetails(anyString(), any());
    verify(repository, never()).updateVersionName(anyString(), anyString());
    verify(prompts, never()).restoreOutputs(anyString(), anyList(), anySet());
    verify(prompts, never()).insertAll(anyString(), anyList());
  }

  private static class TestTransactions extends AbstractPlatformTransactionManager {
    int begins;
    int commits;
    int rollbacks;

    @Override
    protected Object doGetTransaction() { return new Object(); }

    @Override
    protected void doBegin(Object transaction, TransactionDefinition definition) { begins++; }

    @Override
    protected void doCommit(DefaultTransactionStatus status) { commits++; }

    @Override
    protected void doRollback(DefaultTransactionStatus status) { rollbacks++; }
  }
}
