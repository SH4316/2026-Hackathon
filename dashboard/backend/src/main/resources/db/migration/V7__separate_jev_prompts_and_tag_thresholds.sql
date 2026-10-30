-- Jev judges own their prompt text; their output labels reference version-scoped tags.
-- Keep the old jev_prompt column as an archive and migrate every nonempty byte sequence.
ALTER TABLE config_version_tags
 ADD COLUMN jev_threshold DECIMAL(7,6) NULL,
 ADD CONSTRAINT ck_tag_jev_threshold CHECK (jev_threshold IS NULL OR (jev_threshold>=0 AND jev_threshold<=1));

CREATE TABLE config_version_jev_prompts (
 version_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 name VARCHAR(80) NOT NULL,
 prompt TEXT NOT NULL,
 sort_order INT NOT NULL DEFAULT 0,
 PRIMARY KEY(version_id,id),
 FOREIGN KEY(version_id) REFERENCES config_versions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE config_version_jev_outputs (
 version_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 prompt_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 tag_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 sort_order INT NOT NULL DEFAULT 0,
 PRIMARY KEY(version_id,prompt_id,tag_id),
 FOREIGN KEY(version_id,prompt_id) REFERENCES config_version_jev_prompts(version_id,id) ON DELETE CASCADE,
 FOREIGN KEY(version_id,tag_id) REFERENCES config_version_tags(version_id,id) ON DELETE CASCADE
) ENGINE=InnoDB;

INSERT INTO config_version_jev_prompts(version_id,id,name,prompt,sort_order)
SELECT version_id,CONCAT('j_',SHA2(CONCAT(version_id,'/',id),256)),name,jev_prompt,sort_order
FROM config_version_tags WHERE OCTET_LENGTH(jev_prompt)>0;

INSERT INTO config_version_jev_outputs(version_id,prompt_id,tag_id,sort_order)
SELECT version_id,CONCAT('j_',SHA2(CONCAT(version_id,'/',id),256)),id,0
FROM config_version_tags WHERE OCTET_LENGTH(jev_prompt)>0;
