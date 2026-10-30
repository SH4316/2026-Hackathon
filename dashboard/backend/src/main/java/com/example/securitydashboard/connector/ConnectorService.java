package com.example.securitydashboard.connector;

import com.example.securitydashboard.common.ApiException;
import com.example.securitydashboard.common.InputValidation;
import com.example.securitydashboard.connector.model.Connector;
import com.example.securitydashboard.connector.model.CreateConnector;
import com.example.securitydashboard.connector.model.CreatedConnector;
import com.example.securitydashboard.connector.model.DetectorSettings;
import com.example.securitydashboard.connector.model.UpdateDetectorSettings;
import java.net.URI;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.util.Base64;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 검사 서버 연결 발급·해지와 연결 인증, 검사 서버가 따르는 조직 설정.
 *
 * <p>연결 URL은 {@code <대시보드 주소>/api/v1/connectors/<id>#<secret>} 형식입니다. 검사 서버는 주소와 비밀값을 나눠
 * {@code Authorization: Bearer <secret>}으로 요청하므로 비밀값이 요청 경로·접근 로그에 남지 않습니다.
 */
@Service
public class ConnectorService {
  static final String CONNECTOR_PATH = "/api/v1/connectors/";
  private static final Set<String> REPORT_TEXT = Set.of("masked", "full", "off");
  private static final Set<String> TAG_ACTIONS = Set.of("warn", "mask", "block");
  private static final int MAX_TAG_MAP = 500;
  private final ConnectorRepository repository;
  private final Clock clock;
  private final TransactionTemplate transaction;
  private final SecureRandom random = new SecureRandom();

  ConnectorService(ConnectorRepository repository, Clock clock, PlatformTransactionManager manager) {
    this.repository = repository;
    this.clock = clock;
    this.transaction = new TransactionTemplate(manager);
  }

  CreatedConnector create(CreateConnector input, String requestBaseUrl) {
    String name = InputValidation.name(input == null ? null : input.name(), "name");
    String base = baseUrl(input.dashboardUrl() == null || input.dashboardUrl().isBlank()
        ? requestBaseUrl : input.dashboardUrl());
    String id = "c_" + token(9);
    String secret = "sk_" + token(32);
    var now = clock.instant();
    repository.insert(id, name, hash(secret), now);
    return new CreatedConnector(
        new Connector(id, name, now, null, null), base + CONNECTOR_PATH + id + "#" + secret);
  }

  List<Connector> list() {
    return repository.list();
  }

  void revoke(String id) {
    InputValidation.validateId(id, "id");
    if (repository.revoke(id, clock.instant()) == 0)
      throw new ApiException(
          HttpStatus.NOT_FOUND, "CONNECTOR_NOT_FOUND", "연결이 없거나 이미 해지되었습니다.");
  }

  /** 연결을 한 번이라도 발급했으면 검사 서버 엔드포인트에 연결 인증을 요구한다(그 전에는 기존 로컬 무인증 동작). */
  boolean authRequired() {
    return repository.anyIssued();
  }

  /** 유효한 연결이면 연결 ID. */
  Optional<String> authenticate(String secret) {
    if (secret == null || !secret.startsWith("sk_")) return Optional.empty();
    var id = repository.activeIdByHash(hash(secret));
    id.ifPresent(value -> repository.touch(value, clock.instant()));
    return id;
  }

  public DetectorSettings settings() {
    return repository.settings(false);
  }

  DetectorSettings updateSettings(UpdateDetectorSettings input) {
    if (input == null || input.revision() == null)
      throw ApiException.invalid("revision", "revision이 필요합니다.");
    String report = choice(input.reportText(), REPORT_TEXT, "reportText");
    String action = choice(input.tagAction(), TAG_ACTIONS, "tagAction");
    if (input.jevEnabled() == null) throw ApiException.invalid("jevEnabled", "jevEnabled가 필요합니다.");
    Map<String, String> map = tagMap(input.tagMap());
    return transaction.execute(
        status -> {
          var current = repository.settings(true);
          if (current.revision() != input.revision())
            throw new ApiException(
                HttpStatus.CONFLICT, "REVISION_CONFLICT", "다른 변경이 저장되었습니다. 최신 설정을 불러와 주세요.");
          repository.updateSettings(
              report, map, action, input.jevEnabled(), current.revision() + 1, clock.instant());
          return repository.settings(false);
        });
  }

  private static String choice(String value, Set<String> allowed, String field) {
    if (value == null || !allowed.contains(value))
      throw ApiException.invalid(field, String.join("|", allowed.stream().sorted().toList()) + " 중 하나여야 합니다.");
    return value;
  }

  private static Map<String, String> tagMap(Map<String, String> value) {
    if (value == null) return Map.of();
    if (value.size() > MAX_TAG_MAP)
      throw ApiException.invalid("tagMap", "태그 매핑은 " + MAX_TAG_MAP + "개 이하여야 합니다.");
    Map<String, String> out = new LinkedHashMap<>();
    value.forEach(
        (type, tag) -> {
          InputValidation.validateId(type, "tagMap");
          InputValidation.validateId(tag, "tagMap");
          out.put(type, tag);
        });
    return out;
  }

  private static String baseUrl(String value) {
    try {
      var uri = new URI(value.trim());
      if (!Set.of("http", "https").contains(String.valueOf(uri.getScheme()).toLowerCase())
          || uri.getHost() == null
          || uri.getQuery() != null
          || uri.getFragment() != null
          || uri.getUserInfo() != null)
        throw ApiException.invalid("dashboardUrl", "http(s) 주소만 입력할 수 있습니다.");
      return uri.toString().replaceAll("/+$", "");
    } catch (URISyntaxException exception) {
      throw ApiException.invalid("dashboardUrl", "http(s) 주소만 입력할 수 있습니다.");
    }
  }

  private String token(int bytes) {
    byte[] value = new byte[bytes];
    random.nextBytes(value);
    return Base64.getUrlEncoder().withoutPadding().encodeToString(value);
  }

  static String hash(String secret) {
    try {
      return HexFormat.of()
          .formatHex(MessageDigest.getInstance("SHA-256").digest(secret.getBytes(StandardCharsets.UTF_8)));
    } catch (NoSuchAlgorithmException exception) {
      throw new IllegalStateException(exception);
    }
  }
}
