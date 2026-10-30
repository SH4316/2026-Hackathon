package com.example.securitydashboard;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;

/** Bounded multi-row writes keep maximum-size catalogs from requiring thousands of round trips. */
final class JdbcRows {
  private JdbcRows() {}

  static void insert(JdbcTemplate jdbc, String insertPrefix, int width, List<Object[]> rows) {
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
}
