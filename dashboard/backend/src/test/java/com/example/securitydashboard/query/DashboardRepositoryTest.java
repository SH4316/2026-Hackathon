package com.example.securitydashboard.query;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.example.securitydashboard.event.model.Event;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.ResultSet;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;

class DashboardRepositoryTest {
  @Test
  void attachmentCountsPreserveLongtextPayloadsWithVeryLargeInputVersions() throws Exception {
    var jdbc = mock(NamedParameterJdbcTemplate.class);
    var row = mock(ResultSet.class);
    when(row.getString("detector_envelope"))
        .thenReturn(
            "{\"result\":{\"input_version\":"
                + "9".repeat(401)
                + "},\"files\":[{\"name\":\"데모.pdf\"},{\"name\":\"데모.png\"}]}");
    when(row.getString("send_action")).thenReturn("forced");
    when(row.getInt("image_count")).thenReturn(1);
    when(jdbc.query(
            anyString(),
            org.mockito.ArgumentMatchers.<Map<String, ?>>any(),
            org.mockito.ArgumentMatchers.<RowMapper<Event>>any()))
        .thenAnswer(
            invocation -> {
              RowMapper<Event> mapper = invocation.getArgument(2);
              return List.of(mapper.mapRow(row, 0));
            });
    var repository = new DashboardRepository(jdbc, new ObjectMapper());
    var event = repository.event(1);
    assertThat(event.fileCount()).isEqualTo(2);
    assertThat(event.imageCount()).isEqualTo(1);
    assertThat(event.sendAction()).isEqualTo("forced");
    when(row.getString("detector_envelope")).thenReturn(null);
    assertThat(repository.event(1).fileCount()).isZero();
  }
}
