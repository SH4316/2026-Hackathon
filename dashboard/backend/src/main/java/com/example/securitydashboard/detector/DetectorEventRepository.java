package com.example.securitydashboard.detector;

import com.example.securitydashboard.detector.model.FileName;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
class DetectorEventRepository {
  private final JdbcTemplate jdbc;
  private final ObjectMapper json;

  DetectorEventRepository(JdbcTemplate jdbc, ObjectMapper json) {
    this.jdbc = jdbc;
    this.json = json;
  }

  String contentHash(long eventId) {
    var hashes =
        jdbc.queryForList(
            "SELECT content_hash FROM detector_events WHERE event_id=?", String.class, eventId);
    return hashes.size() == 1 ? hashes.getFirst() : null;
  }

  void insert(long eventId, NormalizedEvent normalized) {
    jdbc.update(
        "INSERT INTO detector_events(event_id,envelope,content_hash) VALUES(?,?,?)",
        eventId,
        normalized.envelope(),
        normalized.contentHash());
    for (var image : normalized.images()) {
      insertImage(eventId, image);
    }
  }

  private void insertImage(long eventId, DecodedImage image) {
    jdbc.update(
        connection -> {
          var statement =
              connection.prepareStatement(
                  "INSERT INTO detector_event_images(event_id,name,media_type,data)"
                      + " VALUES(?,?,?,?)",
                  Statement.NO_GENERATED_KEYS);
          statement.setLong(1, eventId);
          statement.setString(2, image.name());
          statement.setString(3, image.mediaType());
          statement.setBytes(4, image.data());
          return statement;
        });
  }

  DetectorEnvelope envelope(long eventId) {
    var envelopes =
        jdbc.queryForList(
            "SELECT envelope FROM detector_events WHERE event_id=?", String.class, eventId);
    return envelopes.isEmpty() ? null : mapEnvelope(read(envelopes.getFirst()));
  }

  private DetectorEnvelope mapEnvelope(JsonNode envelope) {
    Map<String, String> tagMap = new LinkedHashMap<>();
    envelope
        .path("tag_map")
        .fields()
        .forEachRemaining(entry -> tagMap.put(entry.getKey(), entry.getValue().asText()));
    List<FileName> files = new ArrayList<>();
    envelope.path("files").forEach(file -> files.add(new FileName(file.path("name").asText())));
    return new DetectorEnvelope(envelope.get("result"), Map.copyOf(tagMap), List.copyOf(files));
  }

  List<StoredImageMetadata> imageMetadata(long eventId) {
    return jdbc.query(
        "SELECT id,name,media_type,OCTET_LENGTH(data) AS size_bytes FROM detector_event_images"
            + " WHERE event_id=? ORDER BY id",
        (rs, row) ->
            new StoredImageMetadata(
                rs.getLong("id"),
                rs.getString("name"),
                rs.getString("media_type"),
                rs.getLong("size_bytes")),
        eventId);
  }

  ImageDownload image(long eventId, long imageId) {
    var images =
        jdbc.query(
            "SELECT name,media_type,data FROM detector_event_images WHERE event_id=? AND id=?",
            (rs, row) ->
                new ImageDownload(
                    rs.getString("name"), rs.getString("media_type"), rs.getBytes("data")),
            eventId,
            imageId);
    return images.isEmpty() ? null : images.getFirst();
  }

  private JsonNode read(String value) {
    try {
      return json.readTree(value);
    } catch (JsonProcessingException exception) {
      throw new IllegalStateException("Stored detector payload invalid");
    }
  }
}
