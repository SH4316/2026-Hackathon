package com.example.securitydashboard;

import static org.assertj.core.api.Assertions.*;

import java.util.*;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/** Destructive migration checks run only against a second explicitly supplied disposable schema. */
@EnabledIfEnvironmentVariable(named = "TEST_MIGRATION_DB_URL", matches = ".+")
class FlywayMigrationIntegrationTest {
  private static final List<String> VERSIONED_DATA_TABLES =
      List.of(
          "people",
          "config_versions",
          "config_version_tags",
          "config_tag_closure",
          "config_version_policies",
          "active_config",
          "security_events",
          "detections",
          "detection_tags",
          "saved_searches",
          "saved_search_events",
          "detector_events",
          "detector_event_images");

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
    var v2 =
        Flyway.configure()
            .dataSource(source)
            .locations("classpath:db/migration")
            .target("2")
            .load();
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

  @Test
  void v3AddsDetectorStorageWithoutChangingExistingV2DataOrSeedingConfiguration() {
    String url = System.getenv("TEST_MIGRATION_DB_URL");
    if (!url.matches("jdbc:mysql://[^/]+/[A-Za-z0-9_]+_test(?:\\?.*)?"))
      throw new IllegalStateException("Disposable migration database must end in _test");
    var source =
        new DriverManagerDataSource(
            url, System.getenv("TEST_DB_USERNAME"), System.getenv("TEST_DB_PASSWORD"));
    var jdbc = new JdbcTemplate(source);
    var v2 =
        Flyway.configure()
            .dataSource(source)
            .locations("classpath:db/migration")
            .cleanDisabled(false)
            .target("2")
            .load();
    v2.clean();
    v2.migrate();
    jdbc.update("INSERT INTO people(id,name) VALUES('preserved','기존 사용자 😀')");
    jdbc.update(
        "INSERT INTO config_versions(id,name,status,revision,created_at,published_at)"
            + " VALUES('published','기존 설정','PUBLISHED',1,'2026-10-20 01:02:03.123456','2026-10-20"
            + " 02:03:04.123456'), ('draft','작성 중','DRAFT',0,'2026-10-21 01:02:03.123456',NULL)");
    jdbc.update(
        "INSERT INTO"
            + " config_version_tags(version_id,id,name,description,examples,guidance,color,parent_id,sort_order)"
            + " VALUES('published','email','이메일','기존"
            + " 설명',JSON_ARRAY('sample@example.com'),'확인','#123456',NULL,5)");
    jdbc.update(
        "INSERT INTO config_tag_closure(version_id,ancestor_id,descendant_id)"
            + " VALUES('published','email','email')");
    jdbc.update(
        "INSERT INTO config_version_policies(version_id,id,name,description,color,sort_order)"
            + " VALUES('published','review','검토','기존 정책','#ABCDEF',7)");
    jdbc.update("UPDATE active_config SET version_id='published' WHERE singleton_id=1");
    jdbc.update(
        "INSERT INTO"
            + " security_events(id,source_id,event_id,person_id,version_id,prompt,occurred_at,received_at,service,model,policy_state_id)"
            + " VALUES(991,'legacy-v2','external','preserved','published','😀"
            + " user@example.com','2026-10-20 01:02:03.123456', '2026-10-20"
            + " 01:02:04.654321','existing-service','기존 모델','review')");
    jdbc.update(
        "INSERT INTO detections(id,event_id,start_offset,end_offset,text)"
            + " VALUES(992,991,2,18,'user@example.com')");
    jdbc.update(
        "INSERT INTO detection_tags(detection_id,version_id,tag_id)"
            + " VALUES(992,'published','email')");
    jdbc.update(
        "INSERT INTO"
            + " saved_searches(id,name,version_id,created_at,filters,event_count,finding_count)"
            + " VALUES('snapshot','기존 저장 검색','published','2026-10-20"
            + " 04:05:06.123456',JSON_OBJECT('tagId','email'),1,1)");
    jdbc.update("INSERT INTO saved_search_events(saved_search_id,event_id) VALUES('snapshot',991)");
    List<String> existingTables =
        List.of(
            "people",
            "config_versions",
            "config_version_tags",
            "config_tag_closure",
            "config_version_policies",
            "active_config",
            "security_events",
            "detections",
            "detection_tags",
            "saved_searches",
            "saved_search_events");
    Map<String, List<Map<String, Object>>> before = new LinkedHashMap<>();
    for (String table : existingTables)
      before.put(table, jdbc.queryForList("SELECT * FROM " + table + " ORDER BY 1"));

    var v3 =
        Flyway.configure()
            .dataSource(source)
            .locations("classpath:db/migration")
            .target("3")
            .load();
    assertThat(v3.migrate().migrationsExecuted).isEqualTo(1);
    for (String table : existingTables)
      assertThat(jdbc.queryForList("SELECT * FROM " + table + " ORDER BY 1"))
          .as("V2 rows in %s", table)
          .isEqualTo(before.get(table));
    for (String table : List.of("detector_events", "detector_event_images"))
      assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM " + table, Long.class))
          .as(table)
          .isZero();
    assertThat(v3.migrate().migrationsExecuted).isZero();
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM config_versions", Long.class))
        .isEqualTo(2);
  }

  @Test
  void v4AddsEmptyJevPromptsAndPreservesAllV3DataWithoutSeeding() {
    String url = System.getenv("TEST_MIGRATION_DB_URL");
    if (!url.matches("jdbc:mysql://[^/]+/[A-Za-z0-9_]+_test(?:\\?.*)?"))
      throw new IllegalStateException("Disposable migration database must end in _test");
    var source =
        new DriverManagerDataSource(
            url, System.getenv("TEST_DB_USERNAME"), System.getenv("TEST_DB_PASSWORD"));
    var jdbc = new JdbcTemplate(source);
    var v3 =
        Flyway.configure()
            .dataSource(source)
            .locations("classpath:db/migration")
            .cleanDisabled(false)
            .target("3")
            .load();
    v3.clean();
    v3.migrate();
    jdbc.update("INSERT INTO people(id,name) VALUES('preserved','기존 사용자 😀')");
    jdbc.update(
        "INSERT INTO config_versions(id,name,status,revision,created_at,published_at)"
            + " VALUES('published','기존 설정','PUBLISHED',7,'2026-10-20 01:02:03.123456','2026-10-20"
            + " 02:03:04.123456'), ('draft','작성 중','DRAFT',3,'2026-10-21 01:02:03.123456',NULL)");
    jdbc.update(
        "INSERT INTO"
            + " config_version_tags(version_id,id,name,description,examples,guidance,color,parent_id,sort_order)"
            + " VALUES('published','root','부모','기존 설명',JSON_ARRAY('예시 😀'),'  기존 가이드\\n"
            + "줄바꿈  ','#123456',NULL,5), ('published','child','자식','자식 설명',JSON_ARRAY(),'자체"
            + " 가이드','#654321','root',6), ('draft','root','작성 태그','초안 설명',JSON_ARRAY(),'초안"
            + " 가이드','#111111',NULL,0)");
    jdbc.update(
        "INSERT INTO config_tag_closure(version_id,ancestor_id,descendant_id)"
            + " VALUES('published','root','root'),('published','root','child'),('published','child','child'),('draft','root','root')");
    jdbc.update(
        "INSERT INTO config_version_policies(version_id,id,name,description,color,sort_order)"
            + " VALUES('published','review','검토','기존 정책','#ABCDEF',7)");
    jdbc.update("UPDATE active_config SET version_id='published' WHERE singleton_id=1");
    jdbc.update(
        "INSERT INTO"
            + " security_events(id,source_id,event_id,person_id,version_id,prompt,occurred_at,received_at,service,model,policy_state_id)"
            + " VALUES(991,'legacy-v3','external','preserved','published','😀"
            + " user@example.com','2026-10-20 01:02:03.123456', '2026-10-20"
            + " 01:02:04.654321','existing-service','기존 모델','review')");
    jdbc.update(
        "INSERT INTO detections(id,event_id,start_offset,end_offset,text)"
            + " VALUES(992,991,2,18,'user@example.com')");
    jdbc.update(
        "INSERT INTO detection_tags(detection_id,version_id,tag_id)"
            + " VALUES(992,'published','child')");
    jdbc.update(
        "INSERT INTO"
            + " saved_searches(id,name,version_id,created_at,filters,event_count,finding_count)"
            + " VALUES('snapshot','기존 저장 검색','published','2026-10-20"
            + " 04:05:06.123456',JSON_OBJECT('tagId','child'),1,1)");
    jdbc.update("INSERT INTO saved_search_events(saved_search_id,event_id) VALUES('snapshot',991)");
    String envelope =
        "{\"input_version\":123456789012345678901234567890,\"metadata\":\"  원문 😀\\n  \"}";
    jdbc.update(
        "INSERT INTO detector_events(event_id,envelope,content_hash) VALUES(991,?,?)",
        envelope,
        "f".repeat(64));
    jdbc.update(
        "INSERT INTO detector_event_images(id,event_id,name,media_type,data) VALUES(993,991,?,?,?)",
        "원본 😀.png",
        "image/png",
        new byte[] {0, 1, 2, -1});
    var before = snapshotVersionedData(jdbc);
    var v4 =
        Flyway.configure()
            .dataSource(source)
            .locations("classpath:db/migration")
            .target("4")
            .load();
    assertThat(v4.migrate().migrationsExecuted).isEqualTo(1);
    assertVersionedDataPreserved(jdbc, before, "jev_prompt");
    assertThat(
            jdbc.queryForObject(
                "SELECT envelope FROM detector_events WHERE event_id=991", String.class))
        .isEqualTo(envelope);
    assertThat(v4.migrate().migrationsExecuted).isZero();
    // Existing integrations may keep their explicit column list after the additive migration.
    jdbc.update(
        "INSERT INTO"
            + " config_version_tags(version_id,id,name,description,examples,guidance,color,parent_id,sort_order)"
            + " VALUES('draft','legacy-client','호환','',JSON_ARRAY(),'','#222222',NULL,1)");
    assertThat(
            jdbc.queryForObject(
                "SELECT jev_prompt FROM config_version_tags WHERE version_id='draft' AND"
                    + " id='legacy-client'",
                String.class))
        .isEmpty();
  }

  @Test
  void v5AddsEmptyPythonRegexAndPreservesV4JevPromptsEventsAndMetadata() {
    String url = System.getenv("TEST_MIGRATION_DB_URL");
    if (!url.matches("jdbc:mysql://[^/]+/[A-Za-z0-9_]+_test(?:\\?.*)?"))
      throw new IllegalStateException("Disposable migration database must end in _test");
    var source =
        new DriverManagerDataSource(
            url, System.getenv("TEST_DB_USERNAME"), System.getenv("TEST_DB_PASSWORD"));
    var jdbc = new JdbcTemplate(source);
    var v4 =
        Flyway.configure()
            .dataSource(source)
            .locations("classpath:db/migration")
            .cleanDisabled(false)
            .target("4")
            .load();
    v4.clean();
    v4.migrate();
    jdbc.update("INSERT INTO people(id,name) VALUES('preserved','기존 사용자 😀')");
    jdbc.update(
        "INSERT INTO config_versions(id,name,status,revision,created_at,published_at)"
            + " VALUES('published','Jev 설정','PUBLISHED',7,'2026-10-20 01:02:03.123456','2026-10-20"
            + " 02:03:04.123456'), ('draft','작성 중','DRAFT',3,'2026-10-21 01:02:03.123456',NULL)");
    String rootPrompt = "  기존 Jev 판단 😀\r\n\\b 원문  ";
    String childPrompt = "자식 고유 판단\n";
    jdbc.update(
        "INSERT INTO"
            + " config_version_tags(version_id,id,name,description,examples,guidance,jev_prompt,color,parent_id,sort_order)"
            + " VALUES('published','root','부모','기존 설명',JSON_ARRAY('예시 😀'),'기존"
            + " 가이드',?,'#123456',NULL,5), ('published','child','자식','자식 설명',JSON_ARRAY(),'자체"
            + " 가이드',?,'#654321','root',6)",
        rootPrompt,
        childPrompt);
    jdbc.update(
        "INSERT INTO config_tag_closure(version_id,ancestor_id,descendant_id)"
            + " VALUES('published','root','root'),('published','root','child'),('published','child','child')");
    jdbc.update(
        "INSERT INTO config_version_policies(version_id,id,name,description,color,sort_order)"
            + " VALUES('published','review','검토','기존 정책','#ABCDEF',7)");
    jdbc.update("UPDATE active_config SET version_id='published' WHERE singleton_id=1");
    jdbc.update(
        "INSERT INTO"
            + " security_events(id,source_id,event_id,person_id,version_id,prompt,occurred_at,received_at,service,model,policy_state_id)"
            + " VALUES(991,'legacy-v4','external','preserved','published','😀"
            + " user@example.com','2026-10-20 01:02:03.123456', '2026-10-20"
            + " 01:02:04.654321','existing-service','기존 모델','review')");
    jdbc.update(
        "INSERT INTO detections(id,event_id,start_offset,end_offset,text)"
            + " VALUES(992,991,2,18,'user@example.com')");
    jdbc.update(
        "INSERT INTO detection_tags(detection_id,version_id,tag_id)"
            + " VALUES(992,'published','child')");
    jdbc.update(
        "INSERT INTO"
            + " saved_searches(id,name,version_id,created_at,filters,event_count,finding_count)"
            + " VALUES('snapshot','기존 저장 검색','published','2026-10-20"
            + " 04:05:06.123456',JSON_OBJECT('tagId','child'),1,1)");
    jdbc.update("INSERT INTO saved_search_events(saved_search_id,event_id) VALUES('snapshot',991)");
    String envelope =
        "{\"input_version\":123456789012345678901234567890,\"metadata\":\"  원문 😀\\n  \"}";
    jdbc.update(
        "INSERT INTO detector_events(event_id,envelope,content_hash) VALUES(991,?,?)",
        envelope,
        "f".repeat(64));
    jdbc.update(
        "INSERT INTO detector_event_images(id,event_id,name,media_type,data) VALUES(993,991,?,?,?)",
        "원본 😀.png",
        "image/png",
        new byte[] {0, 1, 2, -1});
    var before = snapshotVersionedData(jdbc);

    var latest = Flyway.configure().dataSource(source).locations("classpath:db/migration").load();
    assertThat(latest.migrate().migrationsExecuted).isEqualTo(1);
    assertVersionedDataPreserved(jdbc, before, "python_regex");
    assertThat(
            jdbc.queryForObject(
                "SELECT jev_prompt FROM config_version_tags WHERE version_id='published' AND"
                    + " id='root'",
                String.class))
        .isEqualTo(rootPrompt);
    assertThat(latest.migrate().migrationsExecuted).isZero();
    jdbc.update(
        "INSERT INTO"
            + " config_version_tags(version_id,id,name,description,examples,guidance,color,parent_id,sort_order)"
            + " VALUES('draft','legacy-client','호환','',JSON_ARRAY(),'','#222222',NULL,1)");
    var legacyTag =
        jdbc.queryForMap(
            "SELECT jev_prompt,python_regex FROM config_version_tags WHERE version_id='draft' AND"
                + " id='legacy-client'");
    assertThat(legacyTag).containsEntry("jev_prompt", "").containsEntry("python_regex", "");
  }

  @Test
  void freshLatestSchemaLeavesPeopleConfigurationAndDetectorEventsEmpty() {
    String url = System.getenv("TEST_MIGRATION_DB_URL");
    if (!url.matches("jdbc:mysql://[^/]+/[A-Za-z0-9_]+_test(?:\\?.*)?"))
      throw new IllegalStateException("Disposable migration database must end in _test");
    var source =
        new DriverManagerDataSource(
            url, System.getenv("TEST_DB_USERNAME"), System.getenv("TEST_DB_PASSWORD"));
    var latest =
        Flyway.configure()
            .dataSource(source)
            .locations("classpath:db/migration")
            .cleanDisabled(false)
            .load();
    latest.clean();
    latest.migrate();
    var jdbc = new JdbcTemplate(source);
    for (String table :
        List.of(
            "people",
            "config_versions",
            "config_version_tags",
            "config_version_policies",
            "security_events",
            "detections",
            "detector_events",
            "detector_event_images"))
      assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM " + table, Long.class))
          .as(table)
          .isZero();
    assertThat(
            jdbc.queryForObject(
                "SELECT version_id FROM active_config WHERE singleton_id=1", String.class))
        .isNull();
  }

  private static Map<String, List<Map<String, Object>>> snapshotVersionedData(JdbcTemplate jdbc) {
    Map<String, List<Map<String, Object>>> rows = new LinkedHashMap<>();
    for (String table : VERSIONED_DATA_TABLES)
      rows.put(table, jdbc.queryForList("SELECT * FROM " + table + " ORDER BY 1,2"));
    return rows;
  }

  private static void assertVersionedDataPreserved(
      JdbcTemplate jdbc, Map<String, List<Map<String, Object>>> before, String addedColumn) {
    var after = snapshotVersionedData(jdbc);
    for (var tag : after.get("config_version_tags"))
      assertThat(tag.remove(addedColumn)).isEqualTo("");
    assertThat(after).usingRecursiveComparison().isEqualTo(before);
  }
}
