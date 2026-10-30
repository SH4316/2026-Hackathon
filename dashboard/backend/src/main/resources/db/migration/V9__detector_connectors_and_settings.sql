-- Detector (inspection server) connections issued from the dashboard, and the organization's
-- detector settings that connected servers fetch. Only SHA-256 hashes of connection secrets are stored.
CREATE TABLE detector_connectors (
 id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
 name VARCHAR(80) NOT NULL,
 secret_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 created_at DATETIME(6) NOT NULL,
 last_used_at DATETIME(6) NULL,
 revoked_at DATETIME(6) NULL,
 UNIQUE KEY uk_detector_connector_secret(secret_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE detector_settings (
 id TINYINT NOT NULL PRIMARY KEY,
 report_text VARCHAR(10) NOT NULL,
 tag_action VARCHAR(10) NOT NULL,
 jev_enabled BOOLEAN NOT NULL,
 tag_map JSON NOT NULL,
 revision INT NOT NULL,
 updated_at DATETIME(6) NULL,
 CONSTRAINT ck_detector_settings_singleton CHECK (id=1),
 CONSTRAINT ck_detector_settings_report CHECK (report_text IN ('masked','full','off')),
 CONSTRAINT ck_detector_settings_action CHECK (tag_action IN ('warn','mask','block'))
) ENGINE=InnoDB;

INSERT INTO detector_settings(id,report_text,tag_action,jev_enabled,tag_map,revision,updated_at)
VALUES (1,'masked','mask',TRUE,JSON_OBJECT(),0,NULL);
