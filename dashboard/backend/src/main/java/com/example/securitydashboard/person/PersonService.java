package com.example.securitydashboard.person;

import com.example.securitydashboard.api.model.Page;
import com.example.securitydashboard.common.ApiException;
import com.example.securitydashboard.common.InputValidation;
import com.example.securitydashboard.person.model.CreatePerson;
import com.example.securitydashboard.person.model.Person;
import com.example.securitydashboard.query.DashboardQueryService;
import com.example.securitydashboard.query.EventFilter;
import com.example.securitydashboard.query.PageRequest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@Service
class PersonService {
  private final PersonRepository repository;
  private final DashboardQueryService queries;
  private final TransactionTemplate transaction;

  PersonService(
      PersonRepository repository,
      DashboardQueryService queries,
      PlatformTransactionManager manager) {
    this.repository = repository;
    this.queries = queries;
    this.transaction = new TransactionTemplate(manager);
  }

  Person create(CreatePerson request) {
    String name = InputValidation.name(request.name(), "name");
    try {
      transaction.executeWithoutResult(status -> repository.insert(request.id(), name));
    } catch (DataIntegrityViolationException exception) {
      throw new ApiException(HttpStatus.CONFLICT, "PERSON_EXISTS", "이미 등록된 사용자 ID입니다.");
    }
    return new Person(request.id(), name, 0, 0, null);
  }

  Page<Person> people(EventFilter filter, PageRequest page, String personQuery) {
    return queries.people(filter, page, personQuery);
  }

  Person person(String id, EventFilter filter) {
    return queries.person(id, filter);
  }
}
