package com.example.securitydashboard.detector;

import com.example.securitydashboard.common.ApiException;
import com.example.securitydashboard.event.EventWriter;
import com.example.securitydashboard.query.DashboardQueries;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.Statement;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** Stores normalized detector payloads and images in the event writer's transaction. */
@Service
class DetectorEventService {
  private final JdbcTemplate jdbc;
  private final ObjectMapper json;
  private final DashboardQueries queries;
  private final EventWriter writer;
  private final DetectorEventNormalizer normalizer;

  DetectorEventService(
      JdbcTemplate jdbc,
      ObjectMapper json,
      DashboardQueries queries,
      EventWriter writer,
      DetectorEventNormalizer normalizer) {
    this.jdbc = jdbc;
    this.json = json;
    this.queries = queries;
    this.writer = writer;
    this.normalizer = normalizer;
  }

  IngestResult ingest(DetectorModels.CreateDetectorEvent input) {
    var normalized = normalizer.normalize(input);
    var written = writer.ingest(normalized.event(), event -> writeMetadata(event, normalized));
    return new IngestResult(get(written.event().id()), written.created());
  }

  private void writeMetadata(
      EventWriter.IngestResult event, DetectorEventNormalizer.NormalizedEvent normalized) {
    if (!event.created()) {
      var existing =
          jdbc.queryForList(
              "SELECT content_hash FROM detector_events WHERE event_id=?",
              String.class,
              event.event().id());
      if (existing.size() != 1 || !existing.getFirst().equals(normalized.contentHash()))
        throw conflict();
      return;
    }
    jdbc.update(
        "INSERT INTO detector_events(event_id,envelope,content_hash) VALUES(?,?,?)",
        event.event().id(),
        normalized.envelope(),
        normalized.contentHash());
    for (var image : normalized.images())
      jdbc.update(
          connection -> {
            var statement =
                connection.prepareStatement(
                    "INSERT INTO detector_event_images(event_id,name,media_type,data)"
                        + " VALUES(?,?,?,?)",
                    Statement.NO_GENERATED_KEYS);
            statement.setLong(1, event.event().id());
            statement.setString(2, image.name());
            statement.setString(3, image.mediaType());
            statement.setBytes(4, image.data());
            return statement;
          });
  }

  DetectorModels.StoredDetectorEvent get(long id) {
    validateId(id, "id");
    var stored =
        jdbc.queryForList(
            "SELECT envelope FROM detector_events WHERE event_id=?", String.class, id);
    if (stored.isEmpty()) throw missing();
    JsonNode envelope = read(stored.getFirst());
    var event = queries.event(id);
    Map<String, String> tagMap = new LinkedHashMap<>();
    envelope
        .path("tag_map")
        .fields()
        .forEachRemaining(e -> tagMap.put(e.getKey(), e.getValue().asText()));
    List<DetectorModels.FileName> files = new ArrayList<>();
    envelope
        .path("files")
        .forEach(file -> files.add(new DetectorModels.FileName(file.path("name").asText())));
    var images =
        jdbc.query(
            "SELECT id,name,media_type,OCTET_LENGTH(data) AS size_bytes FROM detector_event_images"
                + " WHERE event_id=? ORDER BY id",
            (rs, n) ->
                new DetectorModels.ImageMetadata(
                    rs.getLong("id"),
                    rs.getString("name"),
                    rs.getString("media_type"),
                    rs.getLong("size_bytes"),
                    "/api/v1/detector-events/" + id + "/images/" + rs.getLong("id")),
            id);
    return new DetectorModels.StoredDetectorEvent(
        id,
        event.eventId(),
        event,
        event.sourceId(),
        event.personId(),
        event.versionId(),
        event.prompt(),
        envelope.get("result"),
        event.occurredAt(),
        event.service(),
        event.model(),
        event.policyStateId(),
        Map.copyOf(tagMap),
        List.copyOf(files),
        images);
  }

  ImageDownload image(long eventId, long imageId) {
    validateId(eventId, "id");
    validateId(imageId, "imageId");
    var images =
        jdbc.query(
            "SELECT name,media_type,data FROM detector_event_images WHERE event_id=? AND id=?",
            (rs, n) ->
                new ImageDownload(
                    rs.getString("name"), rs.getString("media_type"), rs.getBytes("data")),
            eventId,
            imageId);
    if (images.isEmpty()) throw missing();
    return images.getFirst();
  }

  private static void validateId(long id, String field) {
    if (id < 1) throw ApiException.invalid(field, "ID는 1 이상의 정수여야 합니다.");
  }

  private JsonNode read(String value) {
    try {
      return json.readTree(value);
    } catch (JsonProcessingException exception) {
      throw new IllegalStateException("Stored detector payload invalid");
    }
  }

  private static ApiException conflict() {
    return new ApiException(
        HttpStatus.CONFLICT, "EVENT_CONFLICT", "동일한 탐지 이벤트에 다른 원본 결과나 첨부가 이미 등록되어 있습니다.");
  }

  private static ApiException missing() {
    return new ApiException(
        HttpStatus.NOT_FOUND, "DETECTOR_EVENT_NOT_FOUND", "탐지 이벤트 또는 이미지를 찾을 수 없습니다.");
  }

  record ImageDownload(String name, String mediaType, byte[] data) {}

  record IngestResult(DetectorModels.StoredDetectorEvent event, boolean created) {}
}
