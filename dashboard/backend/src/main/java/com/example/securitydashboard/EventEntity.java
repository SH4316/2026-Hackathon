package com.example.securitydashboard;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

@Entity
@Table(name = "security_events", uniqueConstraints = @UniqueConstraint(name = "uk_security_events_source_event", columnNames = {"source_id", "event_id"}))
class EventEntity {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @Column(name = "source_id", length = 80, nullable = false)
    private String sourceId;
    @Column(name = "event_id", length = 80, nullable = false)
    private String eventId;
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "person_id", nullable = false)
    private PersonEntity person;
    @Column(name = "occurred_at", nullable = false, columnDefinition = "datetime(6)")
    private Instant occurredAt;
    @Column(name = "received_at", nullable = false, columnDefinition = "datetime(6)")
    private Instant receivedAt;
    @Column(length = 64, nullable = false)
    private String service;
    @Column(length = 120)
    private String model;
    @Enumerated(EnumType.STRING)
    @Column(name = "policy_state", length = 32)
    private PolicyState policyState;
    @OneToMany(mappedBy = "event", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("category ASC")
    private List<FindingEntity> findings = new ArrayList<>();

    protected EventEntity() {}

    EventEntity(CanonicalEvent input, PersonEntity person, Instant receivedAt) {
        this.sourceId = input.sourceId();
        this.eventId = input.eventId();
        this.person = person;
        this.occurredAt = input.occurredAt();
        this.receivedAt = receivedAt;
        this.service = input.service();
        this.model = input.model();
        this.policyState = input.policyState();
        input.findings().forEach(finding -> findings.add(new FindingEntity(this, finding.category(), finding.quantity())));
    }

    ApiModels.Event toDto() {
        var values = findings.stream().map(FindingEntity::toDto)
            .sorted(java.util.Comparator.comparing(ApiModels.Finding::category)).toList();
        return new ApiModels.Event(id, sourceId, eventId, person.getId(), person.getName(), occurredAt,
            receivedAt, service, model, policyState, values, values.stream().mapToLong(ApiModels.Finding::quantity).sum());
    }
}
