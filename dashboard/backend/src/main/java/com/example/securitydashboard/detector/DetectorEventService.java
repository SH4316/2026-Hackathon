package com.example.securitydashboard.detector;

import com.example.securitydashboard.common.ApiException;
import com.example.securitydashboard.detector.model.CreateDetectorEvent;
import com.example.securitydashboard.detector.model.ImageMetadata;
import com.example.securitydashboard.detector.model.StoredDetectorEvent;
import com.example.securitydashboard.event.EventIngestResult;
import com.example.securitydashboard.event.EventService;
import com.example.securitydashboard.query.DashboardQueryService;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

/** Coordinates detector validation and persistence within the event transaction. */
@Service
class DetectorEventService {
  private final DetectorEventRepository repository;
  private final DashboardQueryService queries;
  private final EventService events;
  private final DetectorEventNormalizer normalizer;

  DetectorEventService(
      DetectorEventRepository repository,
      DashboardQueryService queries,
      EventService events,
      DetectorEventNormalizer normalizer) {
    this.repository = repository;
    this.queries = queries;
    this.events = events;
    this.normalizer = normalizer;
  }

  DetectorIngestResult ingest(CreateDetectorEvent input) {
    var normalized = normalizer.normalize(input);
    var written = events.ingest(normalized.event(), event -> writeMetadata(event, normalized));
    return new DetectorIngestResult(get(written.event().id()), written.created());
  }

  private void writeMetadata(EventIngestResult event, NormalizedEvent normalized) {
    if (!event.created()) {
      String storedHash = repository.contentHash(event.event().id());
      if (!normalized.contentHash().equals(storedHash)) {
        throw new ApiException(
            HttpStatus.CONFLICT, "EVENT_CONFLICT", "동일한 탐지 이벤트에 다른 원본 결과나 첨부가 이미 등록되어 있습니다.");
      }
      return;
    }
    repository.insert(event.event().id(), normalized);
  }

  StoredDetectorEvent get(long id) {
    validateId(id, "id");
    var envelope = repository.envelope(id);
    if (envelope == null) {
      throw missing();
    }
    var event = queries.event(id);
    var images =
        repository.imageMetadata(id).stream()
            .map(
                image ->
                    new ImageMetadata(
                        image.id(),
                        image.name(),
                        image.mediaType(),
                        image.sizeBytes(),
                        "/api/v1/detector-events/" + id + "/images/" + image.id()))
            .toList();
    return new StoredDetectorEvent(
        id,
        event.eventId(),
        event,
        event.sourceId(),
        event.personId(),
        event.versionId(),
        event.prompt(),
        envelope.result(),
        event.occurredAt(),
        event.service(),
        event.model(),
        event.policyStateId(),
        event.sendAction(),
        envelope.tagMap(),
        envelope.files(),
        images);
  }

  ImageDownload image(long eventId, long imageId) {
    validateId(eventId, "id");
    validateId(imageId, "imageId");
    var image = repository.image(eventId, imageId);
    if (image == null) {
      throw missing();
    }
    return image;
  }

  private static void validateId(long id, String field) {
    if (id < 1) {
      throw ApiException.invalid(field, "ID는 1 이상의 정수여야 합니다.");
    }
  }

  private static ApiException missing() {
    return new ApiException(
        HttpStatus.NOT_FOUND, "DETECTOR_EVENT_NOT_FOUND", "탐지 이벤트 또는 이미지를 찾을 수 없습니다.");
  }
}
