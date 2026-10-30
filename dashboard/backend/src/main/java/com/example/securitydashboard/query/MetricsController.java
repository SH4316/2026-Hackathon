package com.example.securitydashboard.query;

import com.example.securitydashboard.api.ApiModels;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.time.Clock;
import java.util.*;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1")
class MetricsController {
  private final DashboardQueries queries;
  private final Clock clock;

  MetricsController(DashboardQueries queries, Clock clock) {
    this.queries = queries;
    this.clock = clock;
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
}
