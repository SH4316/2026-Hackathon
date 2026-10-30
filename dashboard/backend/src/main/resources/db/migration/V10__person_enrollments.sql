-- One-time codes the dashboard issues per person so a browser extension can join a connected
-- inspection server. Only SHA-256 hashes of codes are stored. Connectors may record the inspection
-- server address users enter in the extension.
ALTER TABLE detector_connectors ADD COLUMN server_url VARCHAR(500) NULL;

CREATE TABLE person_enrollments (
 code_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
 person_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 created_at DATETIME(6) NOT NULL,
 expires_at DATETIME(6) NOT NULL,
 used_at DATETIME(6) NULL,
 used_by VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NULL,
 KEY ix_person_enrollments_person(person_id),
 CONSTRAINT fk_person_enrollments_person FOREIGN KEY(person_id) REFERENCES people(id) ON DELETE CASCADE
) ENGINE=InnoDB;
