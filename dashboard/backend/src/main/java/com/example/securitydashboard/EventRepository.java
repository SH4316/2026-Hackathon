package com.example.securitydashboard;

import java.util.Optional;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

interface EventRepository extends JpaRepository<EventEntity, Long> {
    @EntityGraph(attributePaths = {"person", "findings"})
    Optional<EventEntity> findBySourceIdAndEventId(String sourceId, String eventId);
}
