// 검증된 구간을 코드로 치환한다(server/app/sanitize/replacer.py).
// 같은 요청 안에서 같은 (유형, 값)은 같은 토큰으로 치환하고, 뒤쪽부터 적용한다.
// 복원 매핑은 반환하지 않는다.

/** @param items {start, end, type, tokenPrefix}[] (UTF-16 위치) */
export function assignTokens(text, items) {
  const seen = new Map();
  const counters = new Map();
  return [...items].sort((a, b) => a.start - b.start).map((r) => {
    const key = `${r.type}\u0000${text.slice(r.start, r.end)}`;
    if (!seen.has(key)) {
      const n = (counters.get(r.tokenPrefix) ?? 0) + 1;
      counters.set(r.tokenPrefix, n);
      seen.set(key, `[${r.tokenPrefix}_${n}]`);
    }
    return [r, seen.get(key)];
  });
}

export function applyTokens(text, tokens) {
  for (const [r, token] of [...tokens].sort((a, b) => b[0].start - a[0].start)) {
    text = text.slice(0, r.start) + token + text.slice(r.end);
  }
  return text;
}
