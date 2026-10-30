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

    var latest =
        Flyway.configure()
            .dataSource(source)
            .locations("classpath:db/migration")
            .target("5")
            .load();
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
  void v6CapturesEachEventsVersionDetailsAndPreservesEventsMetadataAndSavedSearches() {
    String url = System.getenv("TEST_MIGRATION_DB_URL");
    if (!url.matches("jdbc:mysql://[^/]+/[A-Za-z0-9_]+_test(?:\\?.*)?"))
      throw new IllegalStateException("Disposable migration database must end in _test");
    var source =
        new DriverManagerDataSource(
            url, System.getenv("TEST_DB_USERNAME"), System.getenv("TEST_DB_PASSWORD"));
    var jdbc = new JdbcTemplate(source);
    var v5 =
        Flyway.configure()
            .dataSource(source)
            .locations("classpath:db/migration")
            .cleanDisabled(false)
            .target("5")
            .load();
    v5.clean();
    v5.migrate();
    jdbc.update("INSERT INTO people(id,name) VALUES('preserved','기존 사용자 😀')");
    jdbc.update(
        "INSERT INTO config_versions(id,name,status,revision,created_at,published_at)"
            + " VALUES('v1','기존 설정','PUBLISHED',7,'2026-10-20 01:02:03.123456','2026-10-20"
            + " 02:03:04.123456'),('v2','새 설정','PUBLISHED',3,'2026-10-21 01:02:03.123456',"
            + " '2026-10-21 02:03:04.123456')");
    jdbc.update(
        "INSERT INTO"
            + " config_version_tags(version_id,id,name,description,examples,guidance,jev_prompt,python_regex,color,parent_id,sort_order)"
            + " VALUES('v1','email','이전 이메일 😀','기존 설명',JSON_ARRAY('예시'),'가이드','  판단\\n"
            + "', '(?P<email>.+)','#123456',NULL,5), ('v2','email','변경된 이메일','다른"
            + " 설명',JSON_ARRAY(),'다른 가이드','새 판단','[', '#ABCDEF',NULL,2)");
    jdbc.update(
        "INSERT INTO config_tag_closure(version_id,ancestor_id,descendant_id)"
            + " VALUES('v1','email','email'),('v2','email','email')");
    jdbc.update(
        "INSERT INTO config_version_policies(version_id,id,name,description,color,sort_order)"
            + " VALUES('v1','review','검토','기존 정책','#654321',7)");
    jdbc.update("UPDATE active_config SET version_id='v2' WHERE singleton_id=1");
    jdbc.update(
        "INSERT INTO"
            + " security_events(id,source_id,event_id,person_id,version_id,prompt,occurred_at,received_at,service,model,policy_state_id)"
            + " VALUES(991,'demo-sql-v2','demo-existing','preserved','v1','😀"
            + " user@example.com','2026-10-20 01:02:03.123456','2026-10-20"
            + " 01:02:04.654321','existing-service','기존 모델','review'),"
            + " (993,'detector','existing','preserved','v2','user@example.com', '2026-10-21"
            + " 01:02:03.123456','2026-10-21 01:02:04.654321','detector',NULL,NULL)");
    jdbc.update(
        "INSERT INTO detections(id,event_id,start_offset,end_offset,text)"
            + " VALUES(992,991,2,18,'user@example.com'),(994,993,0,16,'user@example.com')");
    jdbc.update(
        "INSERT INTO detection_tags(detection_id,version_id,tag_id)"
            + " VALUES(992,'v1','email'),(994,'v2','email')");
    jdbc.update(
        "INSERT INTO"
            + " saved_searches(id,name,version_id,created_at,filters,event_count,finding_count)"
            + " VALUES('snapshot','저장 검색','v1','2026-10-22 04:05:06.123456',"
            + " JSON_OBJECT('tagId','email'),2,2)");
    jdbc.update(
        "INSERT INTO saved_search_events(saved_search_id,event_id)"
            + " VALUES('snapshot',991),('snapshot',993)");
    String envelope = "{\"metadata\":\"  원문 😀\\n  \"}";
    jdbc.update(
        "INSERT INTO detector_events(event_id,envelope,content_hash) VALUES(993,?,?)",
        envelope,
        "f".repeat(64));
    jdbc.update(
        "INSERT INTO detector_event_images(id,event_id,name,media_type,data) VALUES(995,993,?,?,?)",
        "원본 😀.png",
        "image/png",
        new byte[] {0, 1, 2, -1});
    var before = snapshotVersionedData(jdbc);

    var v6 =
        Flyway.configure()
            .dataSource(source)
            .locations("classpath:db/migration")
            .target("6")
            .load();
    assertThat(v6.migrate().migrationsExecuted).isEqualTo(1);
    assertThat(
            jdbc.queryForMap(
                "SELECT captured_name,captured_color FROM detection_tags WHERE detection_id=992"))
        .containsEntry("captured_name", "이전 이메일 😀")
        .containsEntry("captured_color", "#123456");
    assertThat(
            jdbc.queryForMap(
                "SELECT captured_name,captured_color FROM detection_tags WHERE detection_id=994"))
        .containsEntry("captured_name", "변경된 이메일")
        .containsEntry("captured_color", "#ABCDEF");
    var after = snapshotVersionedData(jdbc);
    for (var tag : after.get("detection_tags")) {
      tag.remove("captured_name");
      tag.remove("captured_color");
    }
    assertThat(after).usingRecursiveComparison().isEqualTo(before);
    assertThat(
            jdbc.queryForList(
                "SELECT IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()"
                    + " AND TABLE_NAME='detection_tags' AND COLUMN_NAME IN"
                    + " ('captured_name','captured_color')",
                String.class))
        .containsExactly("NO", "NO");
    assertThat(v6.migrate().migrationsExecuted).isZero();
    jdbc.update("UPDATE config_version_tags SET name='편집됨',color='#000000'");
    assertThat(
            jdbc.queryForList(
                "SELECT captured_name FROM detection_tags ORDER BY detection_id", String.class))
        .containsExactly("이전 이메일 😀", "변경된 이메일");
  }

  @Test
  void v7SeparatesEveryNonemptyLegacyPromptWithoutChangingArchivedTagsOrCapturedHistory() {
    var source = migrationSource();
    var jdbc = new JdbcTemplate(source);
    var v6 =
        Flyway.configure()
            .dataSource(source)
            .locations("classpath:db/migration")
            .cleanDisabled(false)
            .target("6")
            .load();
    v6.clean();
    v6.migrate();
    jdbc.update("INSERT INTO people(id,name) VALUES('preserved','기존 사용자 😀')");
    jdbc.update(
        "INSERT INTO config_versions(id,name,status,revision,created_at,published_at)"
            + " VALUES('published','게시 버전','PUBLISHED',7,'2026-10-20 01:02:03.123456','2026-10-20"
            + " 02:03:04.123456'), ('draft','작성 버전','DRAFT',3,'2026-10-21 01:02:03.123456',NULL)");
    String publishedPrompt = "  기존 판단 😀\r\n\t원문 유지\n ";
    String draftPrompt = "다른 버전의 같은 ID 판단\n";
    String spacesOnlyPrompt = "  \r\n\t  ";
    jdbc.update(
        "INSERT INTO"
            + " config_version_tags(version_id,id,name,description,examples,guidance,jev_prompt,python_regex,color,parent_id,sort_order)"
            + " VALUES('published','email','게시 이메일','기존 설명',JSON_ARRAY('sample@example.com'),'기존"
            + " 가이드',?,'(?P<email>[','#123456',NULL,5), ('draft','email','초안 이메일','초안"
            + " 설명',JSON_ARRAY(),'초안 가이드',?,'(?im)raw','#ABCDEF',NULL,2), ('published','spaces','공백"
            + " 판단','',JSON_ARRAY(),'',?,'','#654321','email',6), ('draft','empty','빈"
            + " 판단','',JSON_ARRAY(),'','','','#111111','email',3)",
        publishedPrompt,
        draftPrompt,
        spacesOnlyPrompt);
    jdbc.update(
        "INSERT INTO config_tag_closure(version_id,ancestor_id,descendant_id)"
            + " VALUES('published','email','email'),('published','email','spaces'),('published','spaces','spaces'),"
            + " ('draft','email','email'),('draft','email','empty'),('draft','empty','empty')");
    jdbc.update(
        "INSERT INTO config_version_policies(version_id,id,name,description,color,sort_order)"
            + " VALUES('published','review','검토','정책 메타데이터','#987654',7)");
    jdbc.update("UPDATE active_config SET version_id='published' WHERE singleton_id=1");
    jdbc.update(
        "INSERT INTO"
            + " security_events(id,source_id,event_id,person_id,version_id,prompt,occurred_at,received_at,service,model,policy_state_id)"
            + " VALUES(991,'legacy-v6','existing','preserved','published','😀 user@example.com',"
            + " '2026-10-20 01:02:03.123456','2026-10-20 01:02:04.654321','existing-service','기존"
            + " 모델','review')");
    jdbc.update(
        "INSERT INTO detections(id,event_id,start_offset,end_offset,text)"
            + " VALUES(992,991,2,18,'user@example.com')");
    jdbc.update(
        "INSERT INTO detection_tags(detection_id,version_id,tag_id,captured_name,captured_color)"
            + " VALUES(992,'published','email','편집 전 캡처 이름','#FEDCBA')");
    jdbc.update(
        "INSERT INTO"
            + " saved_searches(id,name,version_id,created_at,filters,event_count,finding_count)"
            + " VALUES('snapshot','기존 저장 검색','published','2026-10-20"
            + " 04:05:06.123456',JSON_OBJECT('tagId','email'),1,1)");
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
    var v7 =
        Flyway.configure()
            .dataSource(source)
            .locations("classpath:db/migration")
            .target("7")
            .load();
    assertThat(v7.migrate().migrationsExecuted).isEqualTo(1);
    var after = snapshotVersionedData(jdbc);
    for (var tag : after.get("config_version_tags")) {
      assertThat(tag).containsKey("jev_threshold");
      assertThat(tag.remove("jev_threshold")).isNull();
    }
    assertThat(after).usingRecursiveComparison().isEqualTo(before);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM config_version_jev_prompts", Long.class))
        .isEqualTo(3);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM config_version_jev_outputs", Long.class))
        .isEqualTo(3);
    var migrated =
        jdbc.queryForList(
            "SELECT o.version_id,o.tag_id,p.name,p.prompt FROM config_version_jev_outputs o JOIN"
                + " config_version_jev_prompts p ON p.version_id=o.version_id AND p.id=o.prompt_id"
                + " ORDER BY o.version_id,o.tag_id");
    assertThat(migrated)
        .containsExactly(
            Map.of(
                "version_id", "draft", "tag_id", "email", "name", "초안 이메일", "prompt", draftPrompt),
            Map.of(
                "version_id",
                "published",
                "tag_id",
                "email",
                "name",
                "게시 이메일",
                "prompt",
                publishedPrompt),
            Map.of(
                "version_id",
                "published",
                "tag_id",
                "spaces",
                "name",
                "공백 판단",
                "prompt",
                spacesOnlyPrompt));
    assertThat(
            jdbc.queryForObject(
                "SELECT COUNT(DISTINCT id) FROM config_version_jev_prompts", Long.class))
        .isEqualTo(3);
    assertThat(
            jdbc.queryForObject(
                "SELECT envelope FROM detector_events WHERE event_id=991", String.class))
        .isEqualTo(envelope);
    assertThat(v7.migrate().migrationsExecuted).isZero();
  }

  @Test
  void v8DefaultsExistingAndNewSettingsToEnabledWithoutChangingConfigurationOrHistory() {
    var source = migrationSource();
    var jdbc = new JdbcTemplate(source);
    var v7 =
        Flyway.configure()
            .dataSource(source)
            .locations("classpath:db/migration")
            .cleanDisabled(false)
            .target("7")
            .load();
    v7.clean();
    v7.migrate();
    jdbc.update("INSERT INTO people(id,name) VALUES('preserved','기존 사용자 😀')");
    jdbc.update(
        "INSERT INTO config_versions(id,name,status,revision,created_at,published_at)"
            + " VALUES('published','게시 설정','PUBLISHED',7,'2026-10-20 01:02:03.123456',"
            + " '2026-10-20 02:03:04.123456'),('draft','작성 설정','DRAFT',3,"
            + " '2026-10-21 01:02:03.123456',NULL)");
    jdbc.update(
        "INSERT INTO config_version_tags"
            + "(version_id,id,name,description,examples,guidance,jev_prompt,jev_threshold,python_regex,color,parent_id,sort_order)"
            + " VALUES('published','email','이메일','설명',JSON_ARRAY('😀'),'가이드','원본 보관',"
            + " 0.123456,'(?P<email>[','#123456',NULL,5),"
            + " ('published','child','자식','',JSON_ARRAY(),'','',NULL,'','#ABCDEF','email',6),"
            + " ('draft','email','다른 이메일','다른 설명',JSON_ARRAY(),'','',1,'raw','#654321',NULL,2)");
    jdbc.update(
        "INSERT INTO config_tag_closure(version_id,ancestor_id,descendant_id)"
            + " VALUES('published','email','email'),('published','email','child'),"
            + " ('published','child','child'),('draft','email','email')");
    jdbc.update(
        "INSERT INTO config_version_policies(version_id,id,name,description,color,sort_order)"
            + " VALUES('published','review','검토','정책','#987654',7)");
    String raw = "  독립 판단 😀\r\n\t원문 유지\n ";
    jdbc.update(
        "INSERT INTO config_version_jev_prompts(version_id,id,name,prompt,sort_order)"
            + " VALUES('published','judge','게시 판단',?,8),('draft','judge','초안 판단','다른 원문',3)",
        raw);
    jdbc.update(
        "INSERT INTO config_version_jev_outputs(version_id,prompt_id,tag_id,sort_order)"
            + " VALUES('published','judge','email',0),('published','judge','child',1),"
            + " ('draft','judge','email',0)");
    jdbc.update("UPDATE active_config SET version_id='published' WHERE singleton_id=1");
    jdbc.update(
        "INSERT INTO security_events"
            + "(id,source_id,event_id,person_id,version_id,prompt,occurred_at,received_at,service,model,policy_state_id)"
            + " VALUES(991,'legacy-v7','existing','preserved','published','user@example.com',"
            + " '2026-10-20 01:02:03.123456','2026-10-20 01:02:04.654321','service','모델','review')");
    jdbc.update(
        "INSERT INTO detections(id,event_id,start_offset,end_offset,text)"
            + " VALUES(992,991,0,16,'user@example.com')");
    jdbc.update(
        "INSERT INTO detection_tags(detection_id,version_id,tag_id,captured_name,captured_color)"
            + " VALUES(992,'published','email','캡처 이름','#FEDCBA')");
    jdbc.update(
        "INSERT INTO saved_searches(id,name,version_id,created_at,filters,event_count,finding_count)"
            + " VALUES('snapshot','기존 저장 검색','published','2026-10-20 04:05:06.123456',"
            + " JSON_OBJECT('tagId','email'),1,1)");
    jdbc.update("INSERT INTO saved_search_events(saved_search_id,event_id) VALUES('snapshot',991)");
    jdbc.update(
        "INSERT INTO detector_events(event_id,envelope,content_hash) VALUES(991,?,?)",
        "{\"input_version\":123456789012345678901234567890,\"metadata\":\" 원문 😀\\n \"}",
        "f".repeat(64));
    jdbc.update(
        "INSERT INTO detector_event_images(id,event_id,name,media_type,data) VALUES(993,991,?,?,?)",
        "원본 😀.png", "image/png", new byte[] {0, 1, 2, -1});
    var before = snapshotVersionedData(jdbc);
    var promptsBefore = jdbc.queryForList("SELECT * FROM config_version_jev_prompts ORDER BY 1,2");
    var outputsBefore = jdbc.queryForList("SELECT * FROM config_version_jev_outputs ORDER BY 1,2,3");

    var v8 =
        Flyway.configure()
            .dataSource(source)
            .locations("classpath:db/migration")
            .target("8")
            .load();
    assertThat(v8.migrate().migrationsExecuted).isEqualTo(1);
    var after = snapshotVersionedData(jdbc);
    for (var tag : after.get("config_version_tags"))
      assertThat(tag.remove("enabled")).isEqualTo(true);
    assertThat(after).usingRecursiveComparison().isEqualTo(before);
    var promptsAfter = jdbc.queryForList("SELECT * FROM config_version_jev_prompts ORDER BY 1,2");
    for (var prompt : promptsAfter) assertThat(prompt.remove("enabled")).isEqualTo(true);
    assertThat(promptsAfter).usingRecursiveComparison().isEqualTo(promptsBefore);
    assertThat(jdbc.queryForList("SELECT * FROM config_version_jev_outputs ORDER BY 1,2,3"))
        .isEqualTo(outputsBefore);
    assertThat(
            jdbc.queryForList(
                "SELECT IS_NULLABLE,COLUMN_DEFAULT FROM information_schema.COLUMNS"
                    + " WHERE TABLE_SCHEMA=DATABASE() AND COLUMN_NAME='enabled'"
                    + " AND TABLE_NAME IN ('config_version_tags','config_version_jev_prompts')"))
        .hasSize(2)
        .allSatisfy(column -> assertThat(column).containsEntry("IS_NULLABLE", "NO").containsEntry("COLUMN_DEFAULT", "1"));
    assertThat(v8.migrate().migrationsExecuted).isZero();

    jdbc.update("UPDATE config_version_tags SET enabled=FALSE WHERE version_id='published' AND id='email'");
    jdbc.update("UPDATE config_version_jev_prompts SET enabled=FALSE WHERE version_id='published'");
    jdbc.update(
        "INSERT INTO config_version_tags(version_id,id,name,description,examples,guidance,color,parent_id,sort_order)"
            + " VALUES('draft','new','새 태그','',JSON_ARRAY(),'','#222222',NULL,9)");
    jdbc.update(
        "INSERT INTO config_version_jev_prompts(version_id,id,name,prompt,sort_order)"
            + " VALUES('draft','new','새 판단','',9)");
    for (String table : List.of("config_version_tags", "config_version_jev_prompts")) {
      assertThat(jdbc.queryForObject("SELECT enabled FROM " + table + " WHERE version_id='draft' AND id='new'", Boolean.class))
          .as(table + " default").isTrue();
      assertThat(jdbc.queryForObject("SELECT enabled FROM " + table + " WHERE version_id='published' AND id=?", Boolean.class,
          table.equals("config_version_tags") ? "email" : "judge"))
          .as(table + " explicit false").isFalse();
    }
    assertThat(jdbc.queryForList("SELECT * FROM config_version_jev_outputs ORDER BY 1,2,3"))
        .isEqualTo(outputsBefore);
  }

  @Test
  void freshV8SchemaLeavesConfigurationAndHistoryEmpty() {
    var source = migrationSource();
    var latest =
        Flyway.configure()
            .dataSource(source)
            .locations("classpath:db/migration")
            .cleanDisabled(false)
            .target("8")
            .load();
    latest.clean();
    assertThat(latest.migrate().migrationsExecuted).isEqualTo(8);
    var jdbc = new JdbcTemplate(source);
    var tables = new ArrayList<>(VERSIONED_DATA_TABLES);
    tables.remove("active_config");
    tables.addAll(List.of("config_version_jev_prompts", "config_version_jev_outputs"));
    for (String table : tables)
      assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM " + table, Long.class)).as(table).isZero();
    assertThat(jdbc.queryForObject("SELECT version_id FROM active_config WHERE singleton_id=1", String.class))
        .isNull();
  }

  @Test
  void freshV7SchemaDoesNotSeedPromptsOutputsOrConfiguration() {
    var source = migrationSource();
    var latest =
        Flyway.configure()
            .dataSource(source)
            .locations("classpath:db/migration")
            .cleanDisabled(false)
            .target("7")
            .load();
    latest.clean();
    assertThat(latest.migrate().migrationsExecuted).isEqualTo(7);
    var jdbc = new JdbcTemplate(source);
    for (String table :
        List.of(
            "config_versions",
            "config_version_tags",
            "config_version_jev_prompts",
            "config_version_jev_outputs",
            "security_events",
            "detections",
            "detector_events"))
      assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM " + table, Long.class))
          .as(table)
          .isZero();
    assertThat(
            jdbc.queryForObject(
                "SELECT version_id FROM active_config WHERE singleton_id=1", String.class))
        .isNull();
  }

  @Test
  void v11AddsNullableSendActionWithoutChangingExistingEventsOrPayloads() {
    var source = migrationSource();
    var previous =
        Flyway.configure()
            .dataSource(source)
            .locations("classpath:db/migration")
            .cleanDisabled(false)
            .target("10")
            .load();
    previous.clean();
    previous.migrate();
    var jdbc = new JdbcTemplate(source);
    jdbc.update("INSERT INTO people(id,name) VALUES('demo','데모 사용자')");
    jdbc.update(
        "INSERT INTO config_versions(id,name,status,revision,created_at,published_at)"
            + " VALUES('demo','데모 정책','PUBLISHED',0,'2026-10-30','2026-10-30')");
    jdbc.update(
        "INSERT INTO"
            + " security_events(id,source_id,event_id,person_id,version_id,prompt,occurred_at,received_at,service)"
            + " VALUES(991,'demo','demo','demo','demo','데모 원문','2026-10-30','2026-10-30','demo')");
    jdbc.update(
        "INSERT INTO detector_events(event_id,envelope,content_hash) VALUES(991,?,?)",
        "{\"files\":[{\"name\":\"데모.pdf\"}],\"result\":{}}",
        "a".repeat(64));
    var before = snapshotVersionedData(jdbc);
    var next =
        Flyway.configure()
            .dataSource(source)
            .locations("classpath:db/migration")
            .target("11")
            .load();
    assertThat(next.migrate().migrationsExecuted).isEqualTo(1);
    var after = snapshotVersionedData(jdbc);
    for (var event : after.get("security_events")) {
      assertThat(event).containsEntry("send_action", null);
      event.remove("send_action");
    }
    assertThat(after).usingRecursiveComparison().isEqualTo(before);
    jdbc.update("UPDATE security_events SET send_action='forced' WHERE id=991");
    assertThat(
            jdbc.queryForObject(
                "SELECT send_action FROM security_events WHERE id=991", String.class))
        .isEqualTo("forced");
    assertThat(next.migrate().migrationsExecuted).isZero();
  }

  private DriverManagerDataSource migrationSource() {
    String url = System.getenv("TEST_MIGRATION_DB_URL");
    if (!url.matches("jdbc:mysql://[^/]+/[A-Za-z0-9_]+_test(?:\\?.*)?"))
      throw new IllegalStateException("Disposable migration database must end in _test");
    return new DriverManagerDataSource(
        url, System.getenv("TEST_DB_USERNAME"), System.getenv("TEST_DB_PASSWORD"));
  }

  @Test
  void freshV6SchemaLeavesPeopleConfigurationAndDetectorEventsEmpty() {
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
            .target("6")
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
            "detection_tags",
            "saved_searches",
            "saved_search_events",
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
