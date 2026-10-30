package com.example.securitydashboard.query;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;

/** Prepared event membership and detection-scope SQL for one resolved dashboard request. */
record DashboardQuery(String where, String cte, MapSqlParameterSource parameters) {}
