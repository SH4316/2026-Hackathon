package com.example.securitydashboard.connector.model;

import java.time.Instant;
import java.util.Map;

/**
 * 연결된 검사 서버가 따르는 조직 설정. reportText: masked(탐지 구간을 토큰으로 바꾼 문장)|full(원문)|off(기록 안 함).
 * tagMap: 검사 서버 탐지 유형 → 태그 ID. tagAction: 대시보드 태그 탐지 시 조치(warn|mask|block).
 */
public record DetectorSettings(
    String reportText,
    Map<String, String> tagMap,
    String tagAction,
    boolean jevEnabled,
    int revision,
    Instant updatedAt) {}
