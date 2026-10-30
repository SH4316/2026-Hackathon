-- V2 explicitly resets legacy fixed-category demo data once. V1 is immutable.
DROP TABLE findings;
DROP TABLE security_events;
DELETE FROM people;

CREATE TABLE config_versions (
 id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 name VARCHAR(80) NOT NULL,
 status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 revision BIGINT NOT NULL DEFAULT 0,
 created_at DATETIME(6) NOT NULL,
 published_at DATETIME(6) NULL,
 CONSTRAINT ck_config_status CHECK (status IN ('DRAFT','PUBLISHED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE config_version_tags (
 version_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 name VARCHAR(80) NOT NULL,
 description TEXT NOT NULL,
 examples JSON NOT NULL,
 guidance TEXT NOT NULL,
 color VARCHAR(7) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 parent_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NULL,
 sort_order INT NOT NULL DEFAULT 0,
 PRIMARY KEY(version_id,id),
 FOREIGN KEY(version_id) REFERENCES config_versions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE config_tag_closure (
 version_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 ancestor_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 descendant_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 PRIMARY KEY(version_id,ancestor_id,descendant_id),
 FOREIGN KEY(version_id,ancestor_id) REFERENCES config_version_tags(version_id,id) ON DELETE CASCADE,
 FOREIGN KEY(version_id,descendant_id) REFERENCES config_version_tags(version_id,id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE config_version_policies (
 version_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 name VARCHAR(80) NOT NULL,
 description TEXT NOT NULL,
 color VARCHAR(7) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 sort_order INT NOT NULL DEFAULT 0,
 PRIMARY KEY(version_id,id),
 FOREIGN KEY(version_id) REFERENCES config_versions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE active_config (
 singleton_id INT PRIMARY KEY,
 version_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NULL,
 CONSTRAINT ck_active_singleton CHECK(singleton_id=1),
 FOREIGN KEY(version_id) REFERENCES config_versions(id)
) ENGINE=InnoDB;
INSERT INTO active_config(singleton_id,version_id) VALUES(1,NULL);
CREATE TABLE security_events (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 source_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 event_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 person_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 version_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 prompt MEDIUMTEXT NOT NULL,
 occurred_at DATETIME(6) NOT NULL,
 received_at DATETIME(6) NOT NULL,
 service VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 model VARCHAR(120) NULL,
 policy_state_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NULL,
 UNIQUE KEY uk_events_source_event(source_id,event_id),
 FOREIGN KEY(person_id) REFERENCES people(id),
 FOREIGN KEY(version_id) REFERENCES config_versions(id),
 FOREIGN KEY(version_id,policy_state_id) REFERENCES config_version_policies(version_id,id),
 INDEX ix_events_occurred(occurred_at DESC,id DESC),
 INDEX ix_events_person(person_id,occurred_at),
 INDEX ix_events_service(service,occurred_at),
 INDEX ix_events_policy(policy_state_id,occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE detections (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 event_id BIGINT NOT NULL,
 start_offset INT NOT NULL,
 end_offset INT NOT NULL,
 text MEDIUMTEXT NOT NULL,
 UNIQUE KEY uk_detection_range(event_id,start_offset,end_offset),
 CONSTRAINT ck_detection_range CHECK(start_offset>=0 AND end_offset>start_offset),
 FOREIGN KEY(event_id) REFERENCES security_events(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE detection_tags (
 detection_id BIGINT NOT NULL,
 version_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 tag_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 PRIMARY KEY(detection_id,tag_id),
 FOREIGN KEY(detection_id) REFERENCES detections(id) ON DELETE CASCADE,
 FOREIGN KEY(version_id,tag_id) REFERENCES config_version_tags(version_id,id),
 INDEX ix_detection_tags_tag(tag_id,detection_id)
) ENGINE=InnoDB;
CREATE TABLE saved_searches (
 id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 name VARCHAR(80) NOT NULL,
 version_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 created_at DATETIME(6) NOT NULL,
 filters JSON NOT NULL,
 event_count BIGINT NOT NULL,
 finding_count BIGINT NOT NULL,
 FOREIGN KEY(version_id) REFERENCES config_versions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE saved_search_events (
 saved_search_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 event_id BIGINT NOT NULL,
 PRIMARY KEY(saved_search_id,event_id),
 FOREIGN KEY(saved_search_id) REFERENCES saved_searches(id) ON DELETE CASCADE,
 FOREIGN KEY(event_id) REFERENCES security_events(id)
) ENGINE=InnoDB;
