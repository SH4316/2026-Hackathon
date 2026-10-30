package com.example.securitydashboard;

import jakarta.validation.Valid;
import java.net.URI;
import java.time.Clock;
import java.util.Map;
import java.util.Set;
import org.springframework.http.ResponseEntity;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1")
class DashboardController {
    private final EventWriter writer;
    private final DashboardQueries queries;
    private final Clock clock;

    DashboardController(EventWriter writer, DashboardQueries queries, Clock clock) {
        this.writer = writer;
        this.queries = queries;
        this.clock = clock;
    }

    @GetMapping("/health")
    Map<String, String> health() { return Map.of("status", "UP"); }

    @PostMapping("/people")
    ResponseEntity<ApiModels.Person> createPerson(@Valid @RequestBody ApiModels.CreatePerson input) {
        var person = writer.createPerson(input);
        return ResponseEntity.created(URI.create("/api/v1/people/" + person.id())).body(person);
    }

    @GetMapping("/people")
    ApiModels.Page<ApiModels.Person> people(@RequestParam MultiValueMap<String, String> parameters) {
        var filter = EventFilter.parse(parameters, clock, Set.of("q", "page", "size"));
        String search = EventFilter.value(parameters, "q");
        if (search != null && search.codePointCount(0, search.length()) > 80) {
            throw ApiException.invalid("q", "검색어는 80자 이하여야 합니다.");
        }
        return queries.people(filter, PageRequest.parse(parameters), search);
    }

    @GetMapping("/people/{id}")
    ApiModels.Person person(@PathVariable String id, @RequestParam MultiValueMap<String, String> parameters) {
        EventFilter.validateId(id, "id");
        return queries.person(id, EventFilter.parse(parameters, clock, Set.of()));
    }

    @PostMapping("/events")
    ResponseEntity<ApiModels.Event> createEvent(@Valid @RequestBody ApiModels.CreateEvent input) {
        var result = writer.ingest(input);
        return result.created() ? ResponseEntity.created(URI.create("/api/v1/events/" + result.event().id())).body(result.event())
            : ResponseEntity.ok(result.event());
    }

    @GetMapping("/events")
    ApiModels.Page<ApiModels.Event> events(@RequestParam MultiValueMap<String, String> parameters) {
        var filter = EventFilter.parse(parameters, clock, Set.of("page", "size"));
        return queries.events(filter, PageRequest.parse(parameters));
    }

    @GetMapping("/events/{id}")
    ApiModels.Event event(@PathVariable long id) {
        if (id < 1) throw ApiException.invalid("id", "이벤트 ID는 1 이상의 정수여야 합니다.");
        return queries.event(id);
    }

    @GetMapping("/metrics")
    ApiModels.Metrics metrics(@RequestParam MultiValueMap<String, String> parameters) {
        return queries.metrics(EventFilter.parse(parameters, clock, Set.of()));
    }
}
