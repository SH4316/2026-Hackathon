package com.example.securitydashboard.web;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.Operation;
import io.swagger.v3.oas.models.examples.Example;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.media.ArraySchema;
import io.swagger.v3.oas.models.media.ComposedSchema;
import io.swagger.v3.oas.models.media.Content;
import io.swagger.v3.oas.models.media.DateTimeSchema;
import io.swagger.v3.oas.models.media.IntegerSchema;
import io.swagger.v3.oas.models.media.MapSchema;
import io.swagger.v3.oas.models.media.MediaType;
import io.swagger.v3.oas.models.media.ObjectSchema;
import io.swagger.v3.oas.models.media.Schema;
import io.swagger.v3.oas.models.media.StringSchema;
import io.swagger.v3.oas.models.parameters.Parameter;
import io.swagger.v3.oas.models.responses.ApiResponse;
import io.swagger.v3.oas.models.servers.Server;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
class OpenApiConfiguration {
  @Bean
  OpenAPI dashboardApi() {
    return new OpenAPI()
        .info(
            new Info()
                .title("AI 보안 대시보드 V2")
                .version("2.0")
                .description(
                    "사용자가 정의한 버전별 태그 트리, 프롬프트 범위 탐지, 불변 검색 스냅샷 API. 인증 없는 로컬 개발 대시보드입니다. 요청 본문 최대"
                        + " 1MiB(POST /api/v1/detector-events는 16MiB), 프롬프트 최대 200000 Unicode code"
                        + " point. 시각은 UTC 마이크로초로 저장합니다. 대시보드 ID는 [A-Za-z0-9_-]{1,80} 형식이며 detector"
                        + " request_id는 임의의 유니코드 1~128자입니다. 버전/저장 검색 ID는 서버가 생성합니다. 최초 데이터베이스는 비어"
                        + " 있습니다."))
        .servers(List.of(new Server().url("/")));
  }

  @Bean
  OpenApiCustomizer examples() {
    return api -> {
      detectorSchemas(api);
      configurationSchemas(api);
      var errorSchema =
          new ObjectSchema()
              .addProperty("code", new StringSchema().example("INVALID_INPUT"))
              .addProperty("message", new StringSchema().example("입력값을 확인해 주세요."))
              .addProperty("fieldErrors", new MapSchema().additionalProperties(new StringSchema()));
      api.getComponents().addSchemas("ApiError", errorSchema);
      api.getPaths()
          .forEach(
              (path, item) ->
                  item.readOperations()
                      .forEach(
                          op -> {
                            for (String status : List.of("400", "404", "409", "422"))
                              op.getResponses()
                                  .addApiResponse(
                                      status,
                                      new ApiResponse()
                                          .description(
                                              switch (status) {
                                                case "400" -> "잘못된 JSON, 필드 또는 검색 조건";
                                                case "404" -> "대상 없음 / NO_ACTIVE_VERSION";
                                                case "409" ->
                                                    "REVISION_CONFLICT, VERSION_IMMUTABLE,"
                                                        + " VERSION_MISMATCH 또는 EVENT_CONFLICT";
                                                default ->
                                                    "PERSON_NOT_REGISTERED / TAG_NOT_IN_VERSION /"
                                                        + " POLICY_NOT_IN_VERSION /"
                                                        + " VERSION_NOT_PUBLISHED";
                                              })
                                          .content(
                                              new Content()
                                                  .addMediaType(
                                                      "application/json",
                                                      new MediaType()
                                                          .schema(
                                                              new Schema<>()
                                                                  .$ref(
                                                                      "#/components/schemas/ApiError")))));
                          }));
      for (String path :
          List.of("/api/v1/events", "/api/v1/people", "/api/v1/metrics", "/api/v1/people/{id}")) {
        var operation = api.getPaths().get(path).getGet();
        operation.setParameters(
            operation.getParameters() == null
                ? new ArrayList<>()
                : new ArrayList<>(
                    operation.getParameters().stream()
                        .filter(p -> !p.getName().equals("parameters"))
                        .toList()));
        parameter(
            operation, "from", "시작 포함. 기본 서울 6일 전 00:00, ISO 8601 시간대 필수", new DateTimeSchema());
        parameter(operation, "to", "종료 제외. 기본 서울 내일 00:00, 최대 366일", new DateTimeSchema());
        parameter(
            operation,
            "versionId",
            "게시한 해석 트리 ID. 생략 시 활성 버전. 캡처 버전에 관계없이 모든 이벤트에 적용",
            new StringSchema());
        parameter(operation, "service", "서비스 영문 소문자 slug", new StringSchema().example("chatgpt"));
        parameter(operation, "personId", "사용자 ID 정확히 일치", new StringSchema());
        parameter(operation, "tagId", "자기 자신 + 모든 하위 태그 ID의 합집합", new StringSchema());
        parameter(operation, "policyStateId", "정책 논리 ID 정확히 일치", new StringSchema());
        parameter(
            operation,
            "hasDetections",
            "이벤트의 원래 탐지 존재 여부",
            new StringSchema()._enum(List.of("true", "false")));
        parameter(operation, "q", "프롬프트 부분 문자열. %와 _는 일반 문자이며 검색어를 그대로 적용", new StringSchema());
        parameter(
            operation,
            "interval",
            "집계 간격. day는 서울 날짜, hour는 UTC 시각이며 최대 31일",
            new StringSchema()._enum(List.of("day", "hour"))._default("day"));
        parameter(
            operation,
            "unmapped",
            "모든 태그가 해석 트리에 없는 탐지. tagId와 동시에 사용 불가",
            new StringSchema()._enum(List.of("true")));
        if (path.equals("/api/v1/people"))
          parameter(operation, "personQuery", "사용자 ID/이름 부분 문자열. 프롬프트 q와 독립", new StringSchema());
        if (path.equals("/api/v1/people") || path.equals("/api/v1/events")) {
          parameter(
              operation,
              "page",
              "0부터 시작",
              new IntegerSchema().minimum(java.math.BigDecimal.ZERO)._default(0));
          parameter(
              operation,
              "size",
              "1~100",
              new IntegerSchema()
                  .minimum(java.math.BigDecimal.ONE)
                  .maximum(java.math.BigDecimal.valueOf(100))
                  ._default(20));
        }
      }
      for (String path :
          List.of(
              "/api/v1/events",
              "/api/v1/people",
              "/api/v1/config-versions",
              "/api/v1/config-versions/{versionId}/jev-prompts",
              "/api/v1/saved-searches")) {
        var op = api.getPaths().get(path).getPost();
        var original = op.getResponses().get("200");
        op.getResponses()
            .addApiResponse(
                "201",
                new ApiResponse()
                    .description("생성 완료. Location 헤더로 상세 경로 반환")
                    .content(original == null ? null : original.getContent()));
        if (!path.equals("/api/v1/events")) op.getResponses().remove("200");
        else original.setDescription("동일한 sourceId+eventId와 정규화한 내용의 재전송. 기존 이벤트 반환");
      }
      var eventMedia = media(api, "/api/v1/events");
      eventMedia.addExamples(
          "유니코드 범위",
          new Example()
              .value(
                  Map.of(
                      "sourceId",
                      "extension",
                      "eventId",
                      "example-1",
                      "personId",
                      "demo-person",
                      "versionId",
                      "published-version-id",
                      "prompt",
                      "A😀메일",
                      "detections",
                      List.of(
                          Map.of(
                              "start",
                              1,
                              "end",
                              2,
                              "text",
                              "😀",
                              "tagIds",
                              List.of("custom-tag"))))));
      eventMedia.addExamples(
          "탐지 없음",
          new Example()
              .value(
                  Map.of(
                      "sourceId",
                      "extension",
                      "eventId",
                      "example-2",
                      "personId",
                      "demo-person",
                      "versionId",
                      "published-version-id",
                      "prompt",
                      "안전한 예시 질문",
                      "detections",
                      List.of())));
      media(api, "/api/v1/people")
          .addExamples("사용자 등록", new Example().value(Map.of("id", "demo-person", "name", "김담당")));
      media(api, "/api/v1/config-versions")
          .addExamples("빈 초안", new Example().value(Map.of("name", "새 분류 기준")))
          .addExamples(
              "복제 초안",
              new Example()
                  .value(Map.of("name", "개정 초안", "baseVersionId", "published-version-id")));
      media(api, "/api/v1/saved-searches")
          .addExamples(
              "절대 기간 저장",
              new Example()
                  .value(
                      Map.of(
                          "name",
                          "검토 대상",
                          "filters",
                          Map.of(
                              "from",
                              "2026-10-01T00:00:00+09:00",
                              "to",
                              "2026-10-08T00:00:00+09:00",
                              "versionId",
                              "published-version-id",
                              "hasDetections",
                              "true",
                              "interval",
                              "day"))));
      var update =
          api.getPaths()
              .get("/api/v1/config-versions/{id}")
              .getPut()
              .getRequestBody()
              .getContent()
              .get("application/json");
      update.addExamples(
          "초안 저장",
          new Example()
              .value(
                  Map.of(
                      "revision",
                      0,
                      "name",
                      "개인정보 기준",
                      "tags",
                      List.of(
                          Map.of(
                              "id",
                              "pii",
                              "name",
                              "개인정보",
                              "description",
                              "개인 식별 정보",
                              "examples",
                              List.of("김예시"),
                              "guidance",
                              "맥락과 범위를 함께 확인하세요.",
                              "jevThreshold",
                              0.8,
                              "pythonRegex",
                              "(?i)(?P<email>[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,})",
                              "color",
                              "#315EA8",
                              "order",
                              0)),
                      "policyStates",
                      List.of(
                          Map.of(
                              "id",
                              "review",
                              "name",
                              "검토 필요",
                              "description",
                              "관리자가 정의한 상태",
                              "color",
                              "#C68524",
                              "order",
                              0)))));
      var jevExample =
          new Example()
              .value(
                  Map.of(
                      "revision",
                      2,
                      "name",
                      "개인정보 판단",
                      "prompt",
                      "개인 식별 정보 여부를 판단하고 해당 출력 태그를 선택하세요.\n맥락을 확인하세요.",
                      "outputs",
                      List.of(Map.of("tagId", "pii", "threshold", 0.8))));
      media(api, "/api/v1/config-versions/{versionId}/jev-prompts")
          .addExamples("판단 프롬프트와 출력 태그 추가", jevExample);
      var jevItem =
          api.getPaths().get("/api/v1/config-versions/{versionId}/jev-prompts/{promptId}");
      jevItem
          .getPut()
          .getRequestBody()
          .getContent()
          .get("application/json")
          .addExamples("판단 프롬프트와 출력 태그 저장", jevExample);
      jevItem
          .getDelete()
          .getRequestBody()
          .getContent()
          .get("application/json")
          .addExamples("판단 프롬프트 삭제", new Example().value(Map.of("revision", 3)));
      api.getPaths()
          .get("/api/v1/config-versions/{id}/tags/{tagId}")
          .getPut()
          .getRequestBody()
          .getContent()
          .get("application/json")
          .addExamples(
              "선택한 버전의 태그 상세 수정",
              new Example()
                  .value(
                      Map.of(
                          "revision", 2,
                          "name", "개인정보",
                          "description", "개인 식별 정보",
                          "examples", List.of("김예시"),
                          "guidance", "맥락과 범위를 함께 확인하세요.",
                          "jevThreshold", 0.8,
                          "pythonRegex", "(?i)(?P<email>[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,})",
                          "color", "#315EA8")));
    };
  }

  private static void configurationSchemas(OpenAPI api) {
    var details = api.getComponents().getSchemas().get("UpdateTagDetails");
    details
        .description(
            "선택한 버전의 기존 태그 상세 전체를 저장합니다. 초안과 게시 버전에서 사용할 수 있으며 트리 구조는 바꾸지 않습니다."
                + " 같은 논리 ID의 다른 버전에는 적용하지 않습니다. 알 수 없는 필드는 400입니다.")
        .additionalProperties(false)
        .addProperty(
            "name",
            new StringSchema().minLength(1).maxLength(80).description("필수 이름. 앞뒤 공백을 제거합니다."))
        .addProperty("description", nullableString().maxLength(4000)._default(""))
        .addProperty(
            "examples",
            new ArraySchema()
                .maxItems(20)
                .items(new StringSchema().maxLength(1000))
                .description(
                    "예시 문자열 최대 20개. 각 예시는 최대 1000 Unicode code point입니다. 생략하거나 null이면 빈 목록입니다."))
        .addProperty("guidance", nullableString().maxLength(4000)._default(""))
        .addProperty(
            "color",
            nullableString()
                .pattern("^#[a-fA-F0-9]{6}$")
                ._default("#64748B")
                .description("#RRGGBB 색상. 대문자로 저장하며 생략·null·빈 값이면 #64748B입니다."));
    details.addRequiredItem("name");
    var threshold =
        new Schema<>()
            .types(new LinkedHashSet<>(List.of("number", "null")))
            .minimum(java.math.BigDecimal.ZERO)
            .maximum(java.math.BigDecimal.ONE)
            .multipleOf(new java.math.BigDecimal("0.000001"))
            .description(
                "태그의 공통 Jev 출력 임계값. null은 임계값 사용 안 함이며 0은 유효한 값입니다."
                    + " 소수점 아래 최대 6자리만 허용하며 초과 자릿수는 반올림하지 않고 거부합니다."
                    + " 같은 태그를 출력하는 모든 Jev 프롬프트에 공통으로 적용하며 다른 버전은 바꾸지 않습니다.");
    api.getComponents().getSchemas().get("Tag").addProperty("jevThreshold", threshold);
    api.getComponents()
        .getSchemas()
        .get("Tag")
        .addProperty(
            "pythonRegex",
            nullableString()
                .maxLength(4000)
                ._default("")
                .description(
                    "태그별 Python 정규식. 최대 4000 Unicode code point이며 공백·줄바꿈·백슬래시·인라인 플래그를 그대로 보존합니다."
                        + " 입력에서 생략하거나 null이면 빈 문자열로 저장하고 응답은 항상 문자열입니다. 부모 패턴을 상속하지 않습니다. 대시보드에서는"
                        + " 문법 검사나 실행을 하지 않으며 Python 문법의 유효성은 탐지기가 판단합니다."));
    var tag = api.getComponents().getSchemas().get("Tag");
    details.addProperty("jevThreshold", (Schema<?>) tag.getProperties().get("jevThreshold"));
    details.addProperty("pythonRegex", (Schema<?>) tag.getProperties().get("pythonRegex"));
    var schemas = api.getComponents().getSchemas();
    var prompt =
        new StringSchema()
            .maxLength(12000)
            .description(
                "독립적인 Jev 판단 프롬프트. 최대 12000 Unicode code point이며 공백·줄바꿈을 그대로 보존합니다."
                    + " 생략하거나 null이면 빈 문자열이며 빈 값도 저장할 수 있습니다. 저장·조회만 하며 Jev를 실행하지 않습니다.");
    schemas
        .get("JevPrompt")
        .description("선택한 버전의 독립적인 Jev 판단 프롬프트. 출력 tagIds는 같은 버전의 기존 태그를 참조합니다.")
        .addProperty("prompt", prompt)
        .addProperty(
            "tagIds", new ArraySchema().maxItems(1000).uniqueItems(true).items(new StringSchema()));
    var save = schemas.get("SaveJevPrompt");
    save.description(
            "초안과 게시 버전의 Jev 프롬프트를 저장합니다. 출력 태그를 새로 만들지 않으며 트리 구조는 바꾸지 않습니다."
                + " 새 프롬프트 추가는 버전당 최대 100개입니다. 기존 데이터 마이그레이션과 복제는 모든 정의를 보존합니다."
                + " 출력에서 제외한 태그와 그 임계값은 유지합니다. 알 수 없는 필드는 400입니다.")
        .additionalProperties(false)
        .addProperty("name", new StringSchema().minLength(1).maxLength(80))
        .addProperty(
            "prompt",
            nullableString().maxLength(12000)._default("").description(prompt.getDescription()))
        .addProperty(
            "outputs",
            new ArraySchema()
                .maxItems(1000)
                .items(new Schema<>().$ref("#/components/schemas/JevOutput"))
                .description("같은 버전의 기존 태그. tagId 중복은 허용하지 않으며 빈 목록은 허용합니다."));
    save.addRequiredItem("name");
    save.addRequiredItem("outputs");
    schemas
        .get("JevOutput")
        .additionalProperties(false)
        .addProperty("tagId", new StringSchema().pattern("^[A-Za-z0-9_-]{1,80}$"))
        .addProperty("threshold", threshold)
        .addRequiredItem("tagId");
    schemas.get("DeleteJevPrompt").additionalProperties(false);
  }

  private static void detectorSchemas(OpenAPI api) {
    var schemas = api.getComponents().getSchemas();
    // JsonNode preserves integer precision at runtime but is not the wire type of input_version.
    schemas
        .get("InspectResponse")
        .addProperty(
            "input_version",
            new ComposedSchema()
                .addOneOfItem(new Schema<>().types(Set.of("integer")))
                .addOneOfItem(new StringSchema()));
    // OpenAPI 3.1 uses a type union for nullability. Required/optional presence stays unchanged.
    schemas.get("Destination").addProperty("basis", nullableString());
    schemas.get("Finding").addProperty("replacement", nullableString());
  }

  private static Schema<?> nullableString() {
    return new Schema<>().types(new LinkedHashSet<>(List.of("string", "null")));
  }

  private static void parameter(
      Operation operation, String name, String description, Schema<?> schema) {
    operation.addParametersItem(
        new Parameter()
            .name(name)
            .in("query")
            .description(description)
            .required(false)
            .schema(schema));
  }

  private static MediaType media(OpenAPI api, String path) {
    return api.getPaths().get(path).getPost().getRequestBody().getContent().get("application/json");
  }
}
