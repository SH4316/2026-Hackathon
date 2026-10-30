-- Event labels preserve the tag details that existed at capture time, even after metadata edits.
ALTER TABLE detection_tags
 ADD COLUMN captured_name VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL,
 ADD COLUMN captured_color VARCHAR(7) CHARACTER SET ascii COLLATE ascii_bin NULL;

UPDATE detection_tags dt
JOIN config_version_tags t ON t.version_id=dt.version_id AND t.id=dt.tag_id
SET dt.captured_name=t.name,dt.captured_color=t.color;

ALTER TABLE detection_tags
 MODIFY COLUMN captured_name VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
 MODIFY COLUMN captured_color VARCHAR(7) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;
