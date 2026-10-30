package com.example.securitydashboard;

import static org.assertj.core.api.Assertions.*;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/** Destructive migration checks run only against a second explicitly supplied disposable schema. */
@EnabledIfEnvironmentVariable(named = "TEST_MIGRATION_DB_URL", matches = ".+")
class FlywayMigrationIntegrationTest {
  @Test
  void v2ResetsLegacyDataOnceAndNormalMigrationPreservesNewData() {
    String url = System.getenv("TEST_MIGRATION_DB_URL");
    if (!url.matches("jdbc:mysql://[^/]+/[A-Za-z0-9_]+_test(?:\\?.*)?"))
      throw new IllegalStateException("Disposable migration database must end in _test");
    var source =
        new DriverManagerDataSource(
            url, System.getenv("TEST_DB_USERNAME"), System.getenv("TEST_DB_PASSWORD"));
    var jdbc = new JdbcTemplate(source);
    Flyway v1 =
        Flyway.configure()
            .dataSource(source)
            .locations("classpath:db/migration")
            .cleanDisabled(false)
            .target("1")
            .load();
    v1.clean();
    v1.migrate();
    jdbc.update("INSERT INTO people(id,name) VALUES('legacy','예전 사용자')");
    jdbc.update(
        "INSERT INTO security_events(source_id,event_id,person_id,occurred_at,received_at,service)"
            + " VALUES('legacy','legacy','legacy','2026-01-01','2026-01-01','legacy')");
    jdbc.update(
        "INSERT INTO findings(event_id,category,quantity) SELECT id,'CREDENTIAL',5 FROM"
            + " security_events");
    var v2 = Flyway.configure().dataSource(source).locations("classpath:db/migration").load();
    assertThat(v2.migrate().migrationsExecuted).isEqualTo(1);
    for (String table :
        new String[] {
          "people",
          "security_events",
          "detections",
          "detection_tags",
          "config_versions",
          "config_version_tags",
          "config_version_policies",
          "saved_searches",
          "saved_search_events"
        })
      assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM " + table, Long.class))
          .as(table)
          .isZero();
    assertThat(
            jdbc.queryForObject(
                "SELECT version_id FROM active_config WHERE singleton_id=1", String.class))
        .isNull();
    jdbc.update("INSERT INTO people(id,name) VALUES('new','새 사용자')");
    assertThat(v2.migrate().migrationsExecuted).isZero();
    assertThat(jdbc.queryForObject("SELECT name FROM people WHERE id='new'", String.class))
        .isEqualTo("새 사용자");
  }
}
