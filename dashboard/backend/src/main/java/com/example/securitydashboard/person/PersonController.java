package com.example.securitydashboard.person;

import com.example.securitydashboard.api.model.Page;
import com.example.securitydashboard.common.InputValidation;
import com.example.securitydashboard.person.model.CreatePerson;
import com.example.securitydashboard.person.model.Person;
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
class PersonController {
  private final PersonService service;
  private final Clock clock;

  PersonController(PersonService service, Clock clock) {
    this.service = service;
    this.clock = clock;
  }

  @Tag(name = "사용자")
  @PostMapping("/people")
  ResponseEntity<Person> createPerson(@Valid @RequestBody CreatePerson input) {
    var person = service.create(input);
    return ResponseEntity.created(URI.create("/api/v1/people/" + person.id())).body(person);
  }

  @Tag(name = "사용자")
  @Operation(
      summary = "사용자 목록",
      description =
          "등록한 사용자는 탐지 기록이 없어도 목록에 포함됩니다. personQuery/personId만 사용자 목록을 제한합니다. q는 프롬프트 검색이며"
              + " 기간·서비스·태그 등 이벤트 조건은 집계와 마지막 활동 시각에만 적용됩니다.")
  @GetMapping("/people")
  Page<Person> people(@RequestParam MultiValueMap<String, String> parameters) {
    return service.people(
        EventFilter.parse(parameters, clock, Set.of("personQuery", "page", "size")),
        PageRequest.parse(parameters),
        EventFilter.value(parameters, "personQuery"));
  }

  @Tag(name = "사용자")
  @GetMapping("/people/{id}")
  Person person(@PathVariable String id, @RequestParam MultiValueMap<String, String> parameters) {
    InputValidation.validateId(id, "id");
    return service.person(id, EventFilter.parse(parameters, clock, Set.of()));
  }
}
