package com.example.securitydashboard;

import io.swagger.v3.oas.models.*;
import io.swagger.v3.oas.models.examples.Example;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.media.*;
import io.swagger.v3.oas.models.parameters.Parameter;
import io.swagger.v3.oas.models.responses.ApiResponse;
import io.swagger.v3.oas.models.servers.Server;
import java.util.*;
import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springframework.context.annotation.*;

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
                        + " 1MiB, 프롬프트 최대 200000 Unicode code point. 시각은 UTC 마이크로초로 저장합니다. ID는"
                        + " [A-Za-z0-9_-]{1,80} 형식이며 버전/저장 검색 ID는 서버가 생성합니다. 최초 데이터베이스는 비어 있습니다."))
        .servers(List.of(new Server().url("/")));
  }

  @Bean
  OpenApiCustomizer examples() {
    return api -> {
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
    };
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
