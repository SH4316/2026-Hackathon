package com.example.securitydashboard;

import jakarta.persistence.*;

@Entity
@Table(name = "findings", uniqueConstraints = @UniqueConstraint(name = "uk_findings_event_category", columnNames = {"event_id", "category"}))
class FindingEntity {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "event_id", nullable = false)
    private EventEntity event;
    @Enumerated(EnumType.STRING)
    @Column(length = 32, nullable = false)
    private Category category;
    @Column(nullable = false)
    private int quantity;

    protected FindingEntity() {}

    FindingEntity(EventEntity event, Category category, int quantity) {
        this.event = event;
        this.category = category;
        this.quantity = quantity;
    }

    ApiModels.Finding toDto() { return new ApiModels.Finding(category, quantity); }
}
