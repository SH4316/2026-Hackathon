package com.example.securitydashboard.common;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.List;
import java.util.TimeZone;
import org.springframework.jdbc.core.JdbcTemplate;

/** Shared UTC row conversion and bounded multi-row writes for JDBC persistence. */
public final class JdbcRows {
  private JdbcRows() {}

  public static void insert(
      JdbcTemplate jdbc, String insertPrefix, int width, List<Object[]> rows) {
    String placeholders = "(" + String.join(",", Collections.nCopies(width, "?")) + ")";
    for (int offset = 0; offset < rows.size(); offset += 250) {
      var chunk = rows.subList(offset, Math.min(offset + 250, rows.size()));
      List<Object> values = new ArrayList<>(chunk.size() * width);
      for (Object[] row : chunk) {
        if (row.length != width) throw new IllegalArgumentException("Inconsistent SQL row width");
        Collections.addAll(values, row);
      }
      // Prefixes are internal constants; every submitted value remains a bound parameter.
      jdbc.update(
          insertPrefix + String.join(",", Collections.nCopies(chunk.size(), placeholders)),
          values.toArray());
    }
  }

  public static Instant instant(ResultSet rs, String column) throws SQLException {
    Timestamp t = rs.getTimestamp(column, Calendar.getInstance(TimeZone.getTimeZone("UTC")));
    return t == null ? null : t.toInstant();
  }
}
