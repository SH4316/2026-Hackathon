package com.example.securitydashboard.connector.model;

/** ttlMinutes: 5~10080(7일), 생략하면 1440(24시간). */
public record CreateEnrollment(Integer ttlMinutes) {}
