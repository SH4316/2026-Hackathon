CREATE TABLE detector_events (
 event_id BIGINT NOT NULL PRIMARY KEY,
 -- MySQL JSON and JSON_VALID either round large integers or reject double overflow. The API
 -- validates JSON before this write; plain text preserves InspectResponse.input_version exactly.
 envelope LONGTEXT NOT NULL,
 content_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 FOREIGN KEY(event_id) REFERENCES security_events(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE detector_event_images (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 event_id BIGINT NOT NULL,
 name VARCHAR(255) NOT NULL,
 media_type VARCHAR(255) NOT NULL,
 data MEDIUMBLOB NOT NULL,
 FOREIGN KEY(event_id) REFERENCES security_events(id) ON DELETE CASCADE,
 INDEX ix_detector_images_event(event_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
