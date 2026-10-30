CREATE TABLE people (
    id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    name VARCHAR(80) NOT NULL,
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE security_events (
    id BIGINT NOT NULL AUTO_INCREMENT,
    source_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    event_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    person_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    occurred_at DATETIME(6) NOT NULL,
    received_at DATETIME(6) NOT NULL,
    service VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    model VARCHAR(120) NULL,
    policy_state VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
    PRIMARY KEY (id),
    CONSTRAINT uk_security_events_source_event UNIQUE (source_id, event_id),
    CONSTRAINT fk_security_events_person FOREIGN KEY (person_id) REFERENCES people(id),
    CONSTRAINT ck_security_events_policy CHECK (policy_state IS NULL OR policy_state IN ('TRAINING_ALLOWED', 'TRAINING_DISABLED', 'UNKNOWN')),
    INDEX ix_security_events_occurred (occurred_at DESC, id DESC),
    INDEX ix_security_events_person_occurred (person_id, occurred_at),
    INDEX ix_security_events_service_occurred (service, occurred_at),
    INDEX ix_security_events_policy_occurred (policy_state, occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE findings (
    id BIGINT NOT NULL AUTO_INCREMENT,
    event_id BIGINT NOT NULL,
    category VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    quantity INT NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uk_findings_event_category UNIQUE (event_id, category),
    CONSTRAINT fk_findings_event FOREIGN KEY (event_id) REFERENCES security_events(id) ON DELETE CASCADE,
    CONSTRAINT ck_findings_category CHECK (category IN ('PERSONAL_DATA', 'CREDENTIAL', 'CONFIDENTIAL')),
    CONSTRAINT ck_findings_quantity CHECK (quantity BETWEEN 1 AND 1000000),
    INDEX ix_findings_category_event (category, event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
