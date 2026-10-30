package com.example.securitydashboard.detector;

import com.example.securitydashboard.api.ApiModels;
import com.example.securitydashboard.common.ApiException;
import com.example.securitydashboard.common.InputValidation;
import com.example.securitydashboard.configuration.ConfigurationService;
import com.example.securitydashboard.event.CanonicalEvent;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.validation.Validator;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

/**
 * Validates the producer payload and prepares a byte-preserving, deterministic event submission.
 */
@Component
class DetectorEventNormalizer {
  private static final int MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  private static final int MAX_TOTAL_IMAGE_BYTES = 10 * 1024 * 1024;
  private final ObjectMapper json;
  private final Validator validator;
  private final ConfigurationService configs;
  private final Clock clock;

  DetectorEventNormalizer(
      ObjectMapper json, Validator validator, ConfigurationService configs, Clock clock) {
    this.json = json;
    this.validator = validator;
    this.configs = configs;
    this.clock = clock;
  }

  NormalizedEvent normalize(DetectorModels.CreateDetectorEvent input) {
    if (!validator.validate(input).isEmpty())
      throw ApiException.invalid("detector_event", "필수 값과 수집 봉투 형식을 확인해 주세요.");
    var result = inspectResponse(input.result());
    validateUnicode(input.result());
    if (result.requestId().codePointCount(0, result.requestId().length()) > 128
        || result.requestId().isEmpty())
      throw ApiException.invalid("result.request_id", "요청 ID는 유니코드 문자 1~128자여야 합니다.");
    JsonNode inputVersion = result.inputVersion();
    if (!inputVersion.isTextual() && !inputVersion.isIntegralNumber())
      throw ApiException.invalid("result.input_version", "입력 버전은 정수 또는 문자열이어야 합니다.");

    var tagMap = input.tagMap() == null ? Map.<String, String>of() : input.tagMap();
    Set<String> tags = new HashSet<>();
    configs.tags(input.versionId()).forEach(tag -> tags.add(tag.id()));
    tagMap.forEach(
        (type, tag) -> {
          if (type == null || tag == null || InputValidation.hasUnpairedSurrogate(type))
            throw ApiException.invalid("tag_map", "유형과 태그 ID는 문자열이어야 합니다.");
          InputValidation.validateId(tag, "tag_map");
          if (!tags.contains(tag))
            throw new ApiException(
                HttpStatus.UNPROCESSABLE_ENTITY, "TAG_NOT_IN_VERSION", "설정 버전에 등록되지 않은 태그 매핑입니다.");
        });

    String text = input.text();
    if (InputValidation.hasUnpairedSurrogate(text)
        || text.codePointCount(0, text.length()) > 200000)
      throw ApiException.invalid("text", "원문은 올바른 유니코드 문자 200000자 이하여야 합니다.");
    int length = text.codePointCount(0, text.length());
    List<ApiModels.CreateDetection> detections = new ArrayList<>();
    for (var finding : result.findings()) {
      var span = finding.span();
      if (span.start() < 0 || span.end() <= span.start() || span.end() > length)
        throw ApiException.invalid("result.findings.span", "탐지 범위는 원문의 유니코드 문자 범위 안에 있어야 합니다.");
      int startUtf16 = text.offsetByCodePoints(0, span.start());
      int endUtf16 = text.offsetByCodePoints(0, span.end());
      if (span.startUtf16() != startUtf16 || span.endUtf16() != endUtf16)
        throw ApiException.invalid("result.findings.span", "코드 포인트와 UTF-16 탐지 범위가 일치하지 않습니다.");
      String mapped = tagMap.getOrDefault(finding.type(), finding.type());
      List<String> mappedTags = tags.contains(mapped) ? List.of(mapped) : List.of();
      detections.add(
          new ApiModels.CreateDetection(
              span.start(), span.end(), text.substring(startUtf16, endUtf16), mappedTags));
    }
    var files = input.files() == null ? List.<DetectorModels.FileName>of() : input.files();
    files.forEach(file -> validateName(file.name(), "files.name"));
    List<DecodedImage> images = decodeImages(input.images());
    var identity = json.createArrayNode().add(input.sourceId()).add(result.requestId());
    identity.add(inputVersion);
    String eventId = "d_" + hash(encode(identity).getBytes(StandardCharsets.UTF_8));
    var canonical =
        CanonicalEvent.from(
            new ApiModels.CreateEvent(
                input.sourceId(),
                eventId,
                input.personId(),
                input.versionId(),
                text,
                detections,
                input.occurredAt(),
                input.service() == null ? result.destination().provider() : input.service(),
                input.model(),
                input.policyStateId()),
            clock,
            true);

    ObjectNode envelope = json.valueToTree(input);
    envelope.set("files", json.valueToTree(files));
    envelope.set("tag_map", json.valueToTree(tagMap));
    ArrayNode imageMetadata = json.createArrayNode();
    for (var image : images)
      imageMetadata.add(
          json.createObjectNode()
              .put("name", image.name())
              .put("media_type", image.mediaType())
              .put("size_bytes", image.data().length)
              .put("sha256", hash(image.data())));
    envelope.set("images", imageMetadata);
    // Use normalized event fields in the replay fingerprint, retaining the raw response itself.
    ObjectNode fingerprint = envelope.deepCopy();
    fingerprint.put("service", canonical.service());
    fingerprint.put("model", canonical.model());
    fingerprint.put(
        "occurred_at", canonical.occurredAt() == null ? null : canonical.occurredAt().toString());
    String contentHash = hash(encode(sorted(fingerprint)).getBytes(StandardCharsets.UTF_8));
    String storedEnvelope = encode(envelope);

    return new NormalizedEvent(canonical, storedEnvelope, contentHash, List.copyOf(images));
  }

  private DetectorModels.InspectResponse inspectResponse(JsonNode value) {
    if (!value.isObject()) throw ApiException.invalid("result", "InspectResponse 객체를 입력해 주세요.");
    try {
      var result = json.treeToValue(value, DetectorModels.InspectResponse.class);
      if (!validator.validate(result).isEmpty()
          || (value.has("notices") && value.get("notices").isNull()))
        throw ApiException.invalid("result", "InspectResponse의 필수 값과 형식을 확인해 주세요.");
      return result;
    } catch (JsonProcessingException exception) {
      throw new ApiException(
          HttpStatus.BAD_REQUEST, "INVALID_JSON", "InspectResponse의 필드와 열거형을 확인해 주세요.");
    }
  }

  private List<DecodedImage> decodeImages(List<DetectorModels.ImageInput> input) {
    if (input == null) return List.of();
    List<DecodedImage> result = new ArrayList<>();
    int total = 0;
    for (var image : input) {
      validateName(image.name(), "images.name");
      String mediaType = image.mediaType();
      if (mediaType.length() > 255 || !mediaType.matches("(?i)image/[a-z0-9!#$%&'*+.^_`|~\\-]+"))
        throw ApiException.invalid("images.media_type", "image/* MIME 형식을 입력해 주세요.");
      String base64 = image.dataBase64();
      if (base64.length() > 4 * ((MAX_IMAGE_BYTES + 2) / 3) || !standardBase64(base64))
        throw ApiException.invalid("images.data_base64", "한 장당 최대 5MiB의 표준 Base64를 입력해 주세요.");
      byte[] data;
      try {
        data = Base64.getDecoder().decode(base64);
      } catch (IllegalArgumentException exception) {
        throw ApiException.invalid("images.data_base64", "올바른 표준 Base64를 입력해 주세요.");
      }
      if (data.length > MAX_IMAGE_BYTES || !Base64.getEncoder().encodeToString(data).equals(base64))
        throw ApiException.invalid("images.data_base64", "한 장당 최대 5MiB의 표준 Base64를 입력해 주세요.");
      total += data.length;
      if (total > MAX_TOTAL_IMAGE_BYTES)
        throw ApiException.invalid("images", "이미지 원본의 합계는 최대 10MiB입니다.");
      result.add(new DecodedImage(image.name(), mediaType, data));
    }
    return result;
  }

  private static void validateName(String name, String field) {
    if (name.isBlank()
        || name.equals(".")
        || name.equals("..")
        || name.codePointCount(0, name.length()) > 255
        || InputValidation.hasUnpairedSurrogate(name)
        || name.indexOf('/') >= 0
        || name.indexOf('\\') >= 0
        || name.codePoints().anyMatch(Character::isISOControl))
      throw ApiException.invalid(field, "파일명은 경로와 제어문자 없이 유니코드 문자 1~255자여야 합니다.");
  }

  private static boolean standardBase64(String value) {
    if (value.length() % 4 != 0) return false;
    int end = value.length();
    if (end > 0 && value.charAt(end - 1) == '=') end--;
    if (end > 0 && value.charAt(end - 1) == '=') end--;
    for (int i = 0; i < end; i++) {
      char c = value.charAt(i);
      if (!((c >= 'A' && c <= 'Z')
          || (c >= 'a' && c <= 'z')
          || (c >= '0' && c <= '9')
          || c == '+'
          || c == '/')) return false;
    }
    return true;
  }

  private static void validateUnicode(JsonNode node) {
    if (node.isTextual() && InputValidation.hasUnpairedSurrogate(node.textValue()))
      throw ApiException.invalid("result", "올바른 유니코드 문자열을 입력해 주세요.");
    if (node.isObject())
      node.fields()
          .forEachRemaining(
              e -> {
                if (InputValidation.hasUnpairedSurrogate(e.getKey()))
                  throw ApiException.invalid("result", "올바른 유니코드 필드명을 입력해 주세요.");
                validateUnicode(e.getValue());
              });
    else if (node.isArray()) node.forEach(DetectorEventNormalizer::validateUnicode);
  }

  private JsonNode sorted(JsonNode node) {
    if (node.isObject()) {
      ObjectNode result = json.createObjectNode();
      TreeSet<String> names = new TreeSet<>();
      node.fieldNames().forEachRemaining(names::add);
      names.forEach(name -> result.set(name, sorted(node.get(name))));
      return result;
    }
    if (node.isArray()) {
      ArrayNode result = json.createArrayNode();
      node.forEach(value -> result.add(sorted(value)));
      return result;
    }
    return node;
  }

  private String encode(JsonNode value) {
    try {
      return json.writeValueAsString(value);
    } catch (JsonProcessingException exception) {
      throw new IllegalStateException("JSON encoding failed");
    }
  }

  private static String hash(byte[] bytes) {
    try {
      return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    } catch (NoSuchAlgorithmException exception) {
      throw new IllegalStateException("SHA-256 unavailable");
    }
  }

  record DecodedImage(String name, String mediaType, byte[] data) {}

  record NormalizedEvent(
      CanonicalEvent event, String envelope, String contentHash, List<DecodedImage> images) {}
}
