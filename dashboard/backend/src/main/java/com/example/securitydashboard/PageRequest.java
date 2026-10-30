package com.example.securitydashboard;

import org.springframework.util.MultiValueMap;

record PageRequest(int page, int size) {
    static PageRequest parse(MultiValueMap<String, String> query) {
        return new PageRequest(number(query, "page", 0, 0, Integer.MAX_VALUE), number(query, "size", 20, 1, 100));
    }

    private static int number(MultiValueMap<String, String> query, String name, int defaultValue, int min, int max) {
        String value = EventFilter.value(query, name);
        if (value == null) return defaultValue;
        try {
            if (!value.matches("[0-9]+")) throw new NumberFormatException();
            int result = Integer.parseInt(value);
            if (result < min || result > max) throw new NumberFormatException();
            return result;
        } catch (NumberFormatException exception) {
            throw ApiException.invalid(name, name.equals("size") ? "페이지 크기는 1~100이어야 합니다." : "페이지 번호는 0 이상의 정수여야 합니다.");
        }
    }

    long offset() { return (long) page * size; }
}
