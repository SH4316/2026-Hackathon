package com.example.securitydashboard.connector.model;

/** connectionUrl은 이 응답에서만 볼 수 있습니다. 검사 서버의 PG_DASHBOARD_CONNECTION에 넣습니다. */
public record CreatedConnector(Connector connector, String connectionUrl) {}
