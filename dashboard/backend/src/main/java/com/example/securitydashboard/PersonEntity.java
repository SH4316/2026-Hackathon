package com.example.securitydashboard;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "people")
class PersonEntity {
    @Id
    @Column(length = 80, nullable = false)
    private String id;

    @Column(length = 80, nullable = false)
    private String name;

    protected PersonEntity() {}

    PersonEntity(String id, String name) {
        this.id = id;
        this.name = name;
    }

    String getId() { return id; }
    String getName() { return name; }
}
