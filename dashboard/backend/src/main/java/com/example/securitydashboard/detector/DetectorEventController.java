package com.example.securitydashboard.detector;

import com.example.securitydashboard.detector.model.CreateDetectorEvent;
import com.example.securitydashboard.detector.model.StoredDetectorEvent;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.ExampleObject;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
@Tag(name = "탐지 서버 연동")
class DetectorEventController {
  private final DetectorEventService service;

  DetectorEventController(DetectorEventService service) {
    this.service = service;
  }

  @Operation(
      summary = "InspectResponse 원본 및 파일명·이미지 수집",
      description =
          "등록된 person_id와 활성 대시보드 version_id가 필요합니다. result는 검사 서버 InspectResponse 그대로입니다."
              + " source_id+request_id+타입을 구분한 input_version으로 이벤트 ID를 생성합니다. 같은 내용의 재전송은 활성 버전 변경"
              + " 후에도 200, 새 이벤트는 201, 변경된 결과·첨부는 409입니다. type과 같은 태그 ID에 연결하며 없는 유형은 미분류로 보관합니다."
              + " 명시적 tag_map의 없는 태그는 422입니다. 코드 포인트와 UTF-16 범위를 함께 검증하고 탐지 원문은 text에서 추출합니다. 최대 본문"
              + " 16MiB, 파일명 100개, 이미지 20개, 이미지 한 장 5MiB·합계 10MiB입니다.")
  @io.swagger.v3.oas.annotations.parameters.RequestBody(
      content =
          @Content(
              mediaType = "application/json",
              schema = @Schema(implementation = CreateDetectorEvent.class),
              examples =
                  @ExampleObject(
                      value =
                          """
{"source_id":"extension","person_id":"registered-person","version_id":"active-dashboard-version",
 "text":"A😀 hong@example.com",
 "result":{"request_id":"request/1","input_version":3,"status":"complete","decision":"block","signal":"red",
   "findings":[{"finding_id":"f1","type":"email","category":"personal","rule_id":"email","detector":"rule",
     "confidence":"high","severity":"medium","action":"mask","span":{"start":3,"end":19,"start_utf16":4,"end_utf16":20},
     "reason":"이메일 탐지","replacement":"[EMAIL_1]"}],"policy_version":"2026-10-31.draft4",
   "destination":{"provider":"openai","channel":"api","tier":"standard","verified":false,"basis":null},
   "detector_versions":{"rules":"rules-0.2.0"},"notices":[]},"files":[{"name":"보고서.txt"}],"images":[]}
""")))
  @ApiResponse(responseCode = "201", description = "원본 결과와 첨부를 원자적으로 저장. Location 헤더에 상세 경로 반환")
  @ApiResponse(responseCode = "200", description = "동일한 이벤트 재전송. 기존 이벤트와 첨부 메타데이터 반환")
  @ApiResponse(responseCode = "413", description = "요청 본문이 16MiB 초과")
  @PostMapping(value = "/detector-events", consumes = MediaType.APPLICATION_JSON_VALUE)
  ResponseEntity<StoredDetectorEvent> create(@Valid @RequestBody CreateDetectorEvent input) {
    var result = service.ingest(input);
    return result.created()
        ? ResponseEntity.created(URI.create("/api/v1/detector-events/" + result.event().id()))
            .body(result.event())
        : ResponseEntity.ok(result.event());
  }

  @Operation(
      summary = "저장한 InspectResponse와 첨부 메타데이터",
      description = "이미지 원본은 download_path로 조회합니다. 응답에 Base64를 포함하지 않습니다.")
  @GetMapping({"/detector-events/{id}", "/events/{id}/attachments"})
  StoredDetectorEvent get(@PathVariable long id) {
    return service.get(id);
  }

  @Operation(
      summary = "변환하지 않은 이미지 원본 다운로드",
      description =
          "제공한 media_type은 상세 메타데이터에 보존합니다. 다운로드는 application/octet-stream attachment와 nosniff로"
              + " 반환합니다.")
  @GetMapping(
      value = {"/detector-events/{id}/images/{imageId}", "/events/{id}/attachments/images/{imageId}"},
      produces = MediaType.APPLICATION_OCTET_STREAM_VALUE)
  ResponseEntity<byte[]> image(@PathVariable long id, @PathVariable long imageId) {
    var image = service.image(id, imageId);
    return ResponseEntity.ok()
        .contentType(MediaType.APPLICATION_OCTET_STREAM)
        .contentLength(image.data().length)
        .header(
            HttpHeaders.CONTENT_DISPOSITION,
            ContentDisposition.attachment()
                .filename(image.name(), StandardCharsets.UTF_8)
                .build()
                .toString())
        .header("X-Content-Type-Options", "nosniff")
        .body(image.data());
  }
}
