package com.example.securitydashboard.savedsearch.model;

import com.example.securitydashboard.query.model.Filters;

public record CreateSavedSearch(String name, Filters filters) {}
