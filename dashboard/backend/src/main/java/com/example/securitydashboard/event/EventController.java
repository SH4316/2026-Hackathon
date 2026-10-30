package com.example.securitydashboard.event;

import com.example.securitydashboard.api.model.Page;
import com.example.securitydashboard.common.ApiException;
import com.example.securitydashboard.event.model.CreateEvent;
import com.example.securitydashboard.event.model.Event;
import com.example.securitydashboard.query.DashboardQueryService;
import com.example.securitydashboard.query.EventFilter;
import com.example.securitydashboard.query.PageRequest;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.net.URI;
import java.time.Clock;
import java.util.Set;
import org.springframework.http.ResponseEntity;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
class EventController {
  private final EventService service;
  private final DashboardQueryService queries;
  private final Clock clock;

  EventController(EventService service, DashboardQueryService queries, Clock clock) {
    this.service = service;
    this.queries = queries;
    this.clock = clock;
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
  ResponseEntity<Event> createEvent(@Valid @RequestBody CreateEvent input) {
    var result = service.ingest(input);
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
  Page<Event> events(@RequestParam MultiValueMap<String, String> parameters) {
    return queries.events(
        EventFilter.parse(parameters, clock, Set.of("page", "size")),
        PageRequest.parse(parameters));
  }

  @Tag(name = "이벤트")
  @GetMapping("/events/{id}")
  Event event(@PathVariable long id) {
    if (id < 1) throw ApiException.invalid("id", "이벤트 ID는 1 이상의 정수여야 합니다.");
    return queries.event(id);
  }
}
