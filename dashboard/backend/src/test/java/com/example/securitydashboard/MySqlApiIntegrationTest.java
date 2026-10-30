package com.example.securitydashboard;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.Executors;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@EnabledIfEnvironmentVariable(named = "TEST_DB_URL", matches = ".+")
class MySqlApiIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String url = System.getenv("TEST_DB_URL");
        if (url == null || !url.matches("jdbc:mysql://[^/]+/[A-Za-z0-9_]+_test(?:\\?.*)?")) {
            throw new IllegalStateException("TEST_DB_URL must point to a separate MySQL schema ending in _test");
        }
        registry.add("spring.datasource.url", () -> url);
        registry.add("spring.datasource.username", () -> System.getenv().getOrDefault("TEST_DB_USERNAME", "dashboard"));
        registry.add("spring.datasource.password", () -> System.getenv().getOrDefault("TEST_DB_PASSWORD", "dashboard-local"));
    }

    @BeforeEach
    void resetDedicatedDatabase() {
        assertThat(jdbc.queryForObject("SELECT VERSION()", String.class)).doesNotContainIgnoringCase("mariadb");
        jdbc.update("DELETE FROM findings");
        jdbc.update("DELETE FROM security_events");
        jdbc.update("DELETE FROM people");
    }

    @Test
    void registrationRetainsZeroEventPeopleAndLiteralSearchAndNeverOverwritesDuplicate() throws Exception {
        person("alpha", "  김_보안  ");
        person("beta", "이보안");
        mvc.perform(post("/api/v1/people").contentType(MediaType.APPLICATION_JSON)
            .content("{\"id\":\"alpha\",\"name\":\"바뀐 이름\"}")).andExpect(status().isConflict());
        mvc.perform(get("/api/v1/people").param("q", "_")).andExpect(status().isOk())
            .andExpect(jsonPath("$.totalElements").value(1)).andExpect(jsonPath("$.items[0].name").value("김_보안"))
            .andExpect(jsonPath("$.items[0].eventCount").value(0)).andExpect(jsonPath("$.items[0].lastEventAt").isEmpty());
        mvc.perform(get("/api/v1/people").param("q", "%")).andExpect(jsonPath("$.totalElements").value(0));
        mvc.perform(get("/api/v1/people").param("service", "claude")).andExpect(jsonPath("$.totalElements").value(2));
    }

    @Test
    void canonicalReplayIsOrderInsensitivePrecisionStableAndConflictsAreAtomic() throws Exception {
        person("alpha", "보안 담당");
        String original = """
            {"sourceId":"src","eventId":"same","personId":"alpha","occurredAt":"2026-04-01T09:00:00.123456789+09:00",
             "service":" ChatGPT ","model":" demo ","findings":[{"category":"CREDENTIAL","quantity":3},{"category":"PERSONAL_DATA","quantity":2}]}
            """;
        JsonNode created = postEvent(original, 201);
        String replay = """
            {"sourceId":"src","eventId":"same","personId":"alpha","occurredAt":"2026-04-01T00:00:00.123456Z",
             "service":"chatgpt","model":"demo","findings":[{"category":"PERSONAL_DATA","quantity":2},{"category":"CREDENTIAL","quantity":3}]}
            """;
        JsonNode existing = postEvent(replay, 200);
        assertThat(existing).isEqualTo(created);
        assertThat(created.path("occurredAt").asText()).isEqualTo("2026-04-01T00:00:00.123456Z");
        assertThat(created.path("policyState").isNull()).isTrue();
        postEvent(replay.replace("\"quantity\":3", "\"quantity\":4"), 409);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM security_events", Long.class)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT SUM(quantity) FROM findings", Long.class)).isEqualTo(5);
    }

    @Test
    void validatesStrictPayloadAndDoesNotEchoSensitiveValues() throws Exception {
        person("alpha", "담당자");
        String valid = event("one", "alpha", "2026-04-01T00:00:00Z", "claude", "UNKNOWN", List.of());
        for (String malformed : List.of(
            valid.replace("\"sourceId\":\"src\"", "\"sourceId\":123"),
            valid.replace("\"eventId\":\"one\"", "\"eventId\":\"one\",\"prompt\":\"sensitive-example\""),
            valid.replace("\"policyState\":\"UNKNOWN\"", "\"policyState\":123"),
            valid.replace("\"policyState\":\"UNKNOWN\"", "\"policyState\":\"invalid\""),
            valid.replace("2026-04-01T00:00:00Z", "2026-04-01T00:00:00"),
            valid.replace("2026-04-01T00:00:00Z", "2099-04-01T00:00:00Z"),
            valid.replace("\"policyState\":\"UNKNOWN\",", ""),
            valid.replace("\"findings\":[]", "\"findings\":[{\"category\":\"CREDENTIAL\",\"quantity\":1.5}]"),
            valid.replace("\"findings\":[]", "\"findings\":[{\"category\":\"CREDENTIAL\",\"quantity\":\"1\"}]"),
            valid.replace("\"findings\":[]", "\"findings\":[{\"category\":\"CREDENTIAL\",\"quantity\":1,\"secret\":\"sensitive-example\"}]"),
            valid.replace("\"findings\":[]", "\"findings\":[{\"category\":\"CREDENTIAL\",\"quantity\":1},{\"category\":\"CREDENTIAL\",\"quantity\":2}]"),
            valid.replace("\"findings\":[]", "\"findings\":[null]"),
            valid.replace("\"service\":\"claude\"", "\"service\":\"claude\",\"service\":\"gemini\"")
        )) {
            var result = mvc.perform(post("/api/v1/events").contentType(MediaType.APPLICATION_JSON).content(malformed))
                .andExpect(status().isBadRequest()).andReturn();
            assertThat(result.getResponse().getContentAsString()).doesNotContain("sensitive-example");
        }
        postEvent(valid.replace("\"personId\":\"alpha\"", "\"personId\":\"missing\""), 422);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM security_events", Long.class)).isZero();
    }

    @Test
    void concurrentIdenticalIngestionCreatesExactlyOneCompleteEvent() throws Exception {
        person("alpha", "담당자");
        String payload = event("concurrent", "alpha", "2026-04-01T00:00:00Z", "gemini", null,
            List.of(Map.of("category", "CONFIDENTIAL", "quantity", 7)));
        var barrier = new CyclicBarrier(6);
        try (var pool = Executors.newFixedThreadPool(6)) {
            List<Callable<Integer>> calls = new ArrayList<>();
            for (int i = 0; i < 6; i++) calls.add(() -> {
                barrier.await();
                return mvc.perform(post("/api/v1/events").contentType(MediaType.APPLICATION_JSON).content(payload))
                    .andReturn().getResponse().getStatus();
            });
            List<Integer> statuses = new ArrayList<>();
            for (var future : pool.invokeAll(calls)) statuses.add(future.get());
            assertThat(statuses).filteredOn(status -> status == 201).hasSize(1);
            assertThat(statuses).filteredOn(status -> status == 200).hasSize(5);
        }
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM security_events", Long.class)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM findings", Long.class)).isEqualTo(1);
    }

    @Test
    void concurrentConflictingContentReturnsOneCreatedAndOneConflict() throws Exception {
        person("alpha", "담당자");
        var barrier = new CyclicBarrier(2);
        try (var pool = Executors.newFixedThreadPool(2)) {
            List<Callable<Integer>> calls = new ArrayList<>();
            for (int quantity : List.of(1, 2)) {
                String payload = event("race", "alpha", "2026-04-01T00:00:00Z", "custom-ai", null,
                    List.of(Map.of("category", "CREDENTIAL", "quantity", quantity)));
                calls.add(() -> {
                    barrier.await();
                    return mvc.perform(post("/api/v1/events").contentType(MediaType.APPLICATION_JSON).content(payload))
                        .andReturn().getResponse().getStatus();
                });
            }
            List<Integer> statuses = new ArrayList<>();
            for (var future : pool.invokeAll(calls)) statuses.add(future.get());
            assertThat(statuses).containsExactlyInAnyOrder(201, 409);
        }
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM security_events", Long.class)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM findings", Long.class)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT quantity FROM findings", Integer.class)).isIn(1, 2);
    }

    @Test
    void calendarBucketsHonorHistoricalSeoulDstAndFractionalRangeBounds() throws Exception {
        person("alpha", "담당자");
        postEvent(event("historical-dst", "alpha", "1987-06-01T14:30:00.123456Z", "chatgpt", "UNKNOWN", List.of()), 201);
        mvc.perform(get("/api/v1/metrics").param("from", "1987-05-31T14:00:00Z").param("to", "1987-06-02T14:00:00Z"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.daily[0].date").value("1987-06-01"))
            .andExpect(jsonPath("$.daily[0].eventCount").value(0)).andExpect(jsonPath("$.daily[1].date").value("1987-06-02"))
            .andExpect(jsonPath("$.daily[1].eventCount").value(1));
        mvc.perform(get("/api/v1/events").param("from", "1987-06-01T14:30:00.123456001Z")
            .param("to", "1987-06-01T14:30:01Z")).andExpect(jsonPath("$.totalElements").value(0));
        mvc.perform(get("/api/v1/events").param("from", "1987-06-01T14:30:00Z")
            .param("to", "1987-06-01T14:30:00.123456001Z")).andExpect(jsonPath("$.totalElements").value(1));
    }

    @Test
    void aggregatesInSqlWithoutEventFanoutAndUsesSeoulDailyBucketsAndAllFilters() throws Exception {
        person("alpha", "가나다"); person("beta", "라마바"); person("empty", "영 기록");
        postEvent(event("before-midnight", "alpha", "2026-04-01T14:59:59Z", "chatgpt", "TRAINING_ALLOWED",
            List.of(Map.of("category", "PERSONAL_DATA", "quantity", 2), Map.of("category", "CREDENTIAL", "quantity", 3))), 201);
        postEvent(event("midnight", "beta", "2026-04-01T15:00:00Z", "chatgpt", null,
            List.of(Map.of("category", "PERSONAL_DATA", "quantity", 4))), 201);
        postEvent(event("unknown", "alpha", "2026-04-02T03:00:00Z", "claude", "UNKNOWN", List.of()), 201);
        postEvent(event("disabled", "beta", "2026-04-02T04:00:00Z", "gemini", "TRAINING_DISABLED",
            List.of(Map.of("category", "CONFIDENTIAL", "quantity", 8))), 201);
        postEvent(event("exclusive-end", "alpha", "2026-04-03T15:00:00Z", "chatgpt", "UNKNOWN", List.of()), 201);

        mvc.perform(get("/api/v1/metrics").param("from", "2026-04-01T00:00:00+09:00").param("to", "2026-04-04T00:00:00+09:00"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.summary.eventCount").value(4))
            .andExpect(jsonPath("$.summary.findingCount").value(17)).andExpect(jsonPath("$.summary.personCount").value(2))
            .andExpect(jsonPath("$.summary.unknownPolicyCount").value(1))
            .andExpect(jsonPath("$.daily[0].date").value("2026-04-01")).andExpect(jsonPath("$.daily[0].eventCount").value(1))
            .andExpect(jsonPath("$.daily[1].eventCount").value(3)).andExpect(jsonPath("$.daily[2].eventCount").value(0))
            .andExpect(jsonPath("$.categories[0].count").value(6)).andExpect(jsonPath("$.categories[0].eventCount").value(2))
            .andExpect(jsonPath("$.policies[2].eventCount").value(1));

        mvc.perform(get("/api/v1/metrics").param("from", "2026-04-01T00:00:00+09:00").param("to", "2026-04-04T00:00:00+09:00")
            .param("category", "PERSONAL_DATA").param("service", "CHATGPT"))
            .andExpect(jsonPath("$.summary.eventCount").value(2)).andExpect(jsonPath("$.summary.findingCount").value(6))
            .andExpect(jsonPath("$.categories[1].count").value(0)).andExpect(jsonPath("$.services[0].findingCount").value(6));

        mvc.perform(get("/api/v1/people").param("from", "2026-04-01T00:00:00+09:00").param("to", "2026-04-04T00:00:00+09:00")
            .param("category", "PERSONAL_DATA").param("personId", "alpha"))
            .andExpect(jsonPath("$.totalElements").value(1)).andExpect(jsonPath("$.items[0].eventCount").value(1))
            .andExpect(jsonPath("$.items[0].findingCount").value(2));

        mvc.perform(get("/api/v1/events").param("from", "2026-04-01T00:00:00+09:00").param("to", "2026-04-04T00:00:00+09:00")
            .param("policyState", "TRAINING_ALLOWED").param("size", "1"))
            .andExpect(jsonPath("$.totalElements").value(1)).andExpect(jsonPath("$.totalPages").value(1))
            .andExpect(jsonPath("$.items[0].findingCount").value(5));
    }

    @Test
    void validatesQueriesAndDoesNotForwardMissingAssetsOrApis() throws Exception {
        for (String path : List.of("/api/v1/events?size=101", "/api/v1/events?page=-1", "/api/v1/metrics?category=INVALID",
            "/api/v1/metrics?from=2025-01-01T00:00:00Z&to=2026-10-30T00:00:00Z", "/api/v1/metrics?from=2026-10-30T00:00:00",
            "/api/v1/metrics?service=chatgpt&service=claude")) {
            mvc.perform(get(path)).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").exists());
        }
        mvc.perform(get("/api/v1/health")).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("UP"));
        mvc.perform(get("/api/v1/events/9999999")).andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/people/missing")).andExpect(status().isNotFound());
        mvc.perform(get("/assets/missing.js")).andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/missing")).andExpect(status().isNotFound());
        mvc.perform(get("/random-page")).andExpect(status().isNotFound());
        mvc.perform(get("/events/123")).andExpect(forwardedUrl("/index.html"));
    }

    @Test
    void boundsJsonParsingAndRejectsBothDeclaredAndChunkedOversizeBodies() throws Exception {
        byte[] oversized = ("{\"name\":\"" + "x".repeat(ApiBodyLimitFilter.MAX_BYTES) + "\"}").getBytes(java.nio.charset.StandardCharsets.UTF_8);
        mvc.perform(post("/api/v1/people").contentType(MediaType.APPLICATION_JSON).content(oversized))
            .andExpect(status().isPayloadTooLarge()).andExpect(jsonPath("$.code").value("PAYLOAD_TOO_LARGE"));
        mvc.perform(post("/api/v1/people").contentType(MediaType.APPLICATION_JSON).content(oversized)
            .with(request -> new org.springframework.mock.web.MockHttpServletRequest() {
                { setMethod("POST"); setRequestURI("/api/v1/people"); setContentType(MediaType.APPLICATION_JSON_VALUE); setContent(oversized); }
                @Override public int getContentLength() { return -1; }
                @Override public long getContentLengthLong() { return -1; }
            }))
            .andExpect(status().isPayloadTooLarge()).andExpect(jsonPath("$.code").value("PAYLOAD_TOO_LARGE"));
        mvc.perform(post("/api/v1/people").contentType(MediaType.APPLICATION_JSON)
            .content("{\"id\":\"oversized-name\",\"name\":\"" + "x".repeat(5000) + "\"}"))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_JSON"));
        mvc.perform(post("/api/v1/people").contentType(MediaType.APPLICATION_JSON)
            .content("{\"id\":" + "[".repeat(20) + "0" + "]".repeat(20) + "}"))
            .andExpect(status().isBadRequest());
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM people", Long.class)).isZero();
    }

    private void person(String id, String name) throws Exception {
        mvc.perform(post("/api/v1/people").contentType(MediaType.APPLICATION_JSON)
            .content(json.writeValueAsString(Map.of("id", id, "name", name)))).andExpect(status().isCreated());
    }

    private JsonNode postEvent(String body, int status) throws Exception {
        return json.readTree(mvc.perform(post("/api/v1/events").contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().is(status)).andReturn().getResponse().getContentAsString());
    }

    private String event(String eventId, String personId, String time, String service, String policy, List<Map<String, Object>> findings) throws Exception {
        var value = new java.util.LinkedHashMap<String, Object>();
        value.put("sourceId", "src"); value.put("eventId", eventId); value.put("personId", personId);
        value.put("occurredAt", time); value.put("service", service);
        if (policy != null) value.put("policyState", policy);
        value.put("findings", findings);
        return json.writeValueAsString(value);
    }
}
