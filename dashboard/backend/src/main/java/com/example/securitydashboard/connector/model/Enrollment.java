package com.example.securitydashboard.connector.model;

import java.time.Instant;

/**
 * 사람별 확장프로그램 연결 코드. code는 이 응답에서만 볼 수 있습니다. connectionInfo는 검사 서버 주소가 등록된 연결이 있을
 * 때 "<검사 서버 주소>#<code>" 한 줄이며, 확장 설정의 대시보드 연결 칸에 그대로 붙여 넣습니다.
 */
public record Enrollment(String code, String personId, Instant expiresAt, String connectionInfo) {}
