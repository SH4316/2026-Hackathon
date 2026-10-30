package com.example.securitydashboard.savedsearch;

import com.example.securitydashboard.api.model.Page;
import com.example.securitydashboard.common.ApiException;
import com.example.securitydashboard.common.InputValidation;
import com.example.securitydashboard.configuration.ConfigurationService;
import com.example.securitydashboard.event.model.Event;
import com.example.securitydashboard.query.DashboardQueryService;
import com.example.securitydashboard.query.EventFilter;
import com.example.securitydashboard.query.PageRequest;
import com.example.securitydashboard.query.model.Metrics;
import com.example.securitydashboard.savedsearch.model.CreateSavedSearch;
import com.example.securitydashboard.savedsearch.model.SavedSearch;
import java.time.Clock;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional(readOnly = true)
class SavedSearchService {
  private final SavedSearchRepository repository;
  private final DashboardQueryService queries;
  private final ConfigurationService configs;
  private final Clock clock;

  SavedSearchService(
      SavedSearchRepository repository,
      DashboardQueryService queries,
      ConfigurationService configs,
      Clock clock) {
    this.repository = repository;
    this.queries = queries;
    this.configs = configs;
    this.clock = clock;
  }

  @Transactional
  SavedSearch create(CreateSavedSearch input) {
    String name = InputValidation.name(input.name(), "name");
    EventFilter filter = EventFilter.parse(input.filters(), clock);
    var version = configs.view(filter.versionId());
    if (version == null)
      throw new ApiException(HttpStatus.CONFLICT, "NO_ACTIVE_VERSION", "저장하려면 게시한 조회 버전이 필요합니다.");
    filter = filter.withVersion(version.id());
    String id = "s_" + UUID.randomUUID().toString().replace("-", "");
    repository.insert(id, name, version.id(), clock.instant(), filter.snapshot());
    queries.captureSnapshotMembers(id, filter);
    var summary = queries.metrics(filter, id).summary();
    repository.updateCounts(id, summary.eventCount(), summary.findingCount());
    return get(id);
  }

  List<SavedSearch> list() {
    return repository.list();
  }

  SavedSearch get(String id) {
    InputValidation.validateId(id, "id");
    var saved = repository.find(id);
    if (saved == null)
      throw new ApiException(HttpStatus.NOT_FOUND, "SAVED_SEARCH_NOT_FOUND", "저장한 검색을 찾을 수 없습니다.");
    return saved;
  }

  @Transactional
  void delete(String id) {
    get(id);
    repository.delete(id);
  }

  Page<Event> events(String id, PageRequest page) {
    var saved = get(id);
    return queries.events(EventFilter.parse(saved.filters(), clock), page, id);
  }

  Metrics metrics(String id) {
    var saved = get(id);
    return queries.metrics(EventFilter.parse(saved.filters(), clock), id);
  }
}
