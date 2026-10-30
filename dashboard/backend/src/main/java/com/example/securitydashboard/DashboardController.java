package com.example.securitydashboard;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.net.URI;
import java.time.Clock;
import java.util.*;
import org.springframework.http.ResponseEntity;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1")
class DashboardController {
  private final EventWriter writer;
  private final DashboardQueries queries;
  private final ConfigurationService configs;
  private final SavedSearchService saved;
  private final Clock clock;

  DashboardController(
      EventWriter writer,
      DashboardQueries queries,
      ConfigurationService configs,
      SavedSearchService saved,
      Clock clock) {
    this.writer = writer;
    this.queries = queries;
    this.configs = configs;
    this.saved = saved;
    this.clock = clock;
  }

  @Tag(name = "상태")
  @GetMapping("/health")
  Map<String, String> health() {
    return Map.of("status", "UP");
  }

  @Tag(name = "설정 버전")
  @Operation(summary = "버전 목록")
  @GetMapping("/config-versions")
  List<ApiModels.VersionSummary> versions() {
    return configs.list();
  }

  @Tag(name = "설정 버전")
  @Operation(
      summary = "빈 초안 또는 버전 복제",
      description = "baseVersionId를 생략하면 빈 초안입니다. 복제 시 태그와 정책의 논리 ID를 유지합니다.")
  @PostMapping("/config-versions")
  ResponseEntity<ApiModels.ConfigVersion> createVersion(
      @RequestBody ApiModels.CreateVersion input) {
    var value = configs.create(input);
    return ResponseEntity.created(URI.create("/api/v1/config-versions/" + value.id())).body(value);
  }

  @Tag(name = "설정 버전")
  @GetMapping("/config-versions/{id}")
  ApiModels.ConfigVersion version(@PathVariable String id) {
    return configs.get(id);
  }

  @Tag(name = "설정 버전")
  @Operation(
      summary = "초안 저장",
      description = "revision이 최신 값과 다르면 409 REVISION_CONFLICT입니다. 게시 버전은 수정할 수 없습니다.")
  @PutMapping("/config-versions/{id}")
  ApiModels.ConfigVersion updateVersion(
      @PathVariable String id, @Valid @RequestBody ApiModels.UpdateVersion input) {
    return configs.update(id, input);
  }

  @Tag(name = "설정 버전")
  @PostMapping("/config-versions/{id}/publish")
  ApiModels.ConfigVersion publish(
      @PathVariable String id, @Valid @RequestBody ApiModels.PublishVersion input) {
    return configs.publish(id, input.revision());
  }

  @Tag(name = "설정 버전")
  @Operation(summary = "게시 버전 활성화", description = "활성 포인터는 단 하나이며 활성화와 새 이벤트 등록은 원자적으로 조정됩니다.")
  @PostMapping("/config-versions/{id}/activate")
  ApiModels.ConfigVersion activate(@PathVariable String id) {
    return configs.activate(id);
  }

  @Tag(name = "설정 버전")
  @DeleteMapping("/config-versions/{id}")
  ResponseEntity<Void> deleteVersion(@PathVariable String id) {
    configs.delete(id);
    return ResponseEntity.noContent().build();
  }

  @Tag(name = "분류 연동")
  @Operation(
      summary = "활성 분류 설정",
      description = "트리, 예시, 가이드, 정책 정의를 반환합니다. 최초 실행에는 404 NO_ACTIVE_VERSION입니다.")
  @GetMapping("/classifier-config")
  ApiModels.ConfigVersion classifier() {
    return configs.classifier();
  }

  @Tag(name = "사용자")
  @PostMapping("/people")
  ResponseEntity<ApiModels.Person> createPerson(@Valid @RequestBody ApiModels.CreatePerson input) {
    var person = writer.createPerson(input);
    return ResponseEntity.created(URI.create("/api/v1/people/" + person.id())).body(person);
  }

  @Tag(name = "사용자")
  @Operation(
      summary = "사용자 목록",
      description =
          "등록한 사용자는 탐지 기록이 없어도 목록에 포함됩니다. personQuery/personId만 사용자 목록을 제한합니다. q는 프롬프트 검색이며"
              + " 기간·서비스·태그 등 이벤트 조건은 집계와 마지막 활동 시각에만 적용됩니다.")
  @GetMapping("/people")
  ApiModels.Page<ApiModels.Person> people(@RequestParam MultiValueMap<String, String> parameters) {
    return queries.people(
        EventFilter.parse(parameters, clock, Set.of("personQuery", "page", "size")),
        PageRequest.parse(parameters),
        EventFilter.value(parameters, "personQuery"));
  }

  @Tag(name = "사용자")
  @GetMapping("/people/{id}")
  ApiModels.Person person(
      @PathVariable String id, @RequestParam MultiValueMap<String, String> parameters) {
    EventFilter.validateId(id, "id");
    return queries.person(id, EventFilter.parse(parameters, clock, Set.of()));
  }

  @Tag(name = "분류 연동")
  @Operation(
      summary = "프롬프트와 탐지 범위 등록",
      description =
          "start 포함/end 제외, Unicode code point 기준입니다. 예: A😀이메일에서 😀는 [1,2)입니다. 같은 범위는 tagIds 합집합으로"
              + " 병합하며 겹치는 다른 범위는 유지합니다. detections=[]도 허용합니다. 신규는 활성 versionId 필수(409"
              + " VERSION_MISMATCH), 미등록 사용자/태그/정책은 422입니다. sourceId+eventId 동일 내용 재전송은 활성 버전 변경"
              + " 뒤에도 200이며 다른 내용은 409 EVENT_CONFLICT입니다. occurredAt 생략 시 서버 시각이며 재전송 때 생략하면 기존 시각을"
              + " 유지합니다.")
  @PostMapping("/events")
  ResponseEntity<ApiModels.Event> createEvent(@Valid @RequestBody ApiModels.CreateEvent input) {
    var result = writer.ingest(input);
    return result.created()
        ? ResponseEntity.created(URI.create("/api/v1/events/" + result.event().id()))
            .body(result.event())
        : ResponseEntity.ok(result.event());
  }

  @Tag(name = "이벤트")
  @Operation(
      summary = "이벤트 검색",
      description =
          "기간은 [from,to), 기본 서울 최근 7개 날짜, 최대 366일입니다. versionId는 게시한 해석 트리이며 이벤트 캡처 버전을 제한하지 않습니다."
              + " tagId는 하위 태그를 포함하며 q는 LIKE 와일드카드가 아닌 원문 부분 문자열입니다. unmapped=true는 조회 트리의 어떤 태그와도"
              + " 연결되지 않은 탐지이며 tagId와 함께 사용할 수 없습니다.")
  @GetMapping("/events")
  ApiModels.Page<ApiModels.Event> events(@RequestParam MultiValueMap<String, String> parameters) {
    return queries.events(
        EventFilter.parse(parameters, clock, Set.of("page", "size")),
        PageRequest.parse(parameters));
  }

  @Tag(name = "이벤트")
  @GetMapping("/events/{id}")
  ApiModels.Event event(@PathVariable long id) {
    if (id < 1) throw ApiException.invalid("id", "이벤트 ID는 1 이상의 정수여야 합니다.");
    return queries.event(id);
  }

  @Tag(name = "지표")
  @Operation(
      summary = "SQL 집계",
      description =
          "eventCount는 고유 이벤트, findingCount는 고유 탐지 범위입니다. 태그 노드는 자기 자신과 모든 하위 태그의 합집합이며 다중 태그 탐지를"
              + " 중복 집계하지 않습니다. interval=day는 서울 날짜, hour는 UTC ISO 시각(최대 31일)입니다. 비어 있는 버킷도 포함합니다.")
  @GetMapping("/metrics")
  ApiModels.Metrics metrics(@RequestParam MultiValueMap<String, String> parameters) {
    return queries.metrics(EventFilter.parse(parameters, clock, Set.of()));
  }

  @Tag(name = "저장 검색")
  @Operation(
      summary = "검색 결과 스냅샷 저장",
      description =
          "현재 페이지가 아닌 모든 이벤트 ID와 절대 기간, 게시한 해석 버전을 한 트랜잭션으로 저장합니다. 이후 이벤트 유입이나 활성 버전 변경으로 멤버십과 집계가"
              + " 바뀌지 않습니다.")
  @PostMapping("/saved-searches")
  ResponseEntity<ApiModels.SavedSearch> createSaved(
      @RequestBody ApiModels.CreateSavedSearch input) {
    var value = saved.create(input);
    return ResponseEntity.created(URI.create("/api/v1/saved-searches/" + value.id())).body(value);
  }

  @Tag(name = "저장 검색")
  @GetMapping("/saved-searches")
  List<ApiModels.SavedSearch> savedList() {
    return saved.list();
  }

  @Tag(name = "저장 검색")
  @GetMapping("/saved-searches/{id}")
  ApiModels.SavedSearch saved(@PathVariable String id) {
    return saved.get(id);
  }

  @Tag(name = "저장 검색")
  @DeleteMapping("/saved-searches/{id}")
  ResponseEntity<Void> deleteSaved(@PathVariable String id) {
    saved.delete(id);
    return ResponseEntity.noContent().build();
  }

  @Tag(name = "저장 검색")
  @GetMapping("/saved-searches/{id}/events")
  ApiModels.Page<ApiModels.Event> savedEvents(
      @PathVariable String id, @RequestParam MultiValueMap<String, String> parameters) {
    parameters.forEach(
        (name, values) -> {
          if (!Set.of("page", "size").contains(name) || values.size() != 1)
            throw ApiException.invalid(name, "페이지 조건만 사용할 수 있습니다.");
        });
    return saved.events(id, PageRequest.parse(parameters));
  }

  @Tag(name = "저장 검색")
  @GetMapping("/saved-searches/{id}/metrics")
  ApiModels.Metrics savedMetrics(@PathVariable String id) {
    return saved.metrics(id);
  }
}
