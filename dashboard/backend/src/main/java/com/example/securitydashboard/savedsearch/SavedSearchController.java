package com.example.securitydashboard.savedsearch;

import com.example.securitydashboard.api.ApiModels;
import com.example.securitydashboard.common.ApiException;
import com.example.securitydashboard.query.PageRequest;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.net.URI;
import java.util.*;
import org.springframework.http.ResponseEntity;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1")
class SavedSearchController {
  private final SavedSearchService saved;

  SavedSearchController(SavedSearchService saved) {
    this.saved = saved;
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
