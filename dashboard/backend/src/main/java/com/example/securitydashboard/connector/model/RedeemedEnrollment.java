package com.example.securitydashboard.connector.model;

/** 검사 서버가 코드를 사용 처리한 결과. 검사 서버는 이 사람 ID로 확장 클라이언트를 등록합니다. */
public record RedeemedEnrollment(String personId, String name) {}
