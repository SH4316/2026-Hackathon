package com.example.securitydashboard.connector.model;

import java.time.Instant;

/** 대시보드가 발급한 검사 서버 연결. 연결 비밀값은 발급 응답에서만 보이고 저장하지 않는다. */
public record Connector(
    String id,
    String name,
    String serverUrl,
    Instant createdAt,
    Instant lastUsedAt,
    Instant revokedAt) {}
