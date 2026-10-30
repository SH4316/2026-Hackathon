// 겹치는 탐지 구간 병합(server/app/detection/merge.py).
// 겹치는 후보는 합집합 구간 하나로 묶고, 우선순위가 가장 높은 후보의 유형을 대표로 쓴다.

/** 사전식 튜플 비교 */
export function compareTuple(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

export function merge(candidates, priority) {
  const ordered = [...candidates].sort((a, b) => a.start - b.start || b.end - a.end);
  const groups = [];
  let groupEnd = -1;
  for (const c of ordered) {
    if (groups.length && c.start < groupEnd) {
      groups[groups.length - 1].push(c);
      groupEnd = Math.max(groupEnd, c.end);
    } else {
      groups.push([c]);
      groupEnd = c.end;
    }
  }
  return groups.map((g) => {
    // Python max() 처럼 같은 우선순위면 먼저 나온 후보
    let best = g[0];
    for (const c of g.slice(1)) if (compareTuple(priority(c), priority(best)) > 0) best = c;
    const start = Math.min(...g.map((c) => c.start));
    const end = Math.max(...g.map((c) => c.end));
    const cpStart = Math.min(...g.map((c) => c.cpStart));
    const cpEnd = Math.max(...g.map((c) => c.cpEnd));
    return { primary: { ...best, start, end, cpStart, cpEnd }, members: g };
  });
}
