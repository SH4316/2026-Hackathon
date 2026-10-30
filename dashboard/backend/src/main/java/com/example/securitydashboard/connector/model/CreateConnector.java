package com.example.securitydashboard.connector.model;

/**
 * dashboardUrl은 검사 서버가 이 대시보드에 접속할 주소입니다. 생략하면 요청 주소를 사용합니다(예: 컨테이너 안의 검사 서버는
 * http://host.docker.internal:8080).
 */
public record CreateConnector(String name, String dashboardUrl) {}
