package com.example.securitydashboard.person;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
class PersonRepository {
  private final JdbcTemplate jdbc;

  PersonRepository(JdbcTemplate jdbc) {
    this.jdbc = jdbc;
  }

  void insert(String id, String name) {
    jdbc.update("INSERT INTO people(id,name) VALUES(?,?)", id, name);
  }
}
