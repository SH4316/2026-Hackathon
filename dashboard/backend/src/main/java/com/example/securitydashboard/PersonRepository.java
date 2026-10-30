package com.example.securitydashboard;

import org.springframework.data.jpa.repository.JpaRepository;

interface PersonRepository extends JpaRepository<PersonEntity, String> {}
