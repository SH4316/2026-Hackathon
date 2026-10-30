// 화면 관측과 제공사 정책은 안내용이다. 판정이나 전송 승인을 만들지 않는다.
var PG = (globalThis.PG = globalThis.PG || {});
PG.entryPolicy = (() => {
  const unknown = "확인하지 못했습니다";
  const observed = field => field?.status === "observed" ? field.value : null;
  const boolean = field => typeof observed(field) === "boolean" ? (observed(field) ? "ON" : "OFF") : unknown;

  function evaluate(snapshot, destinations) {
    if (!snapshot?.provider || typeof PG.resolveDestination !== "function") return null;
    const destination = PG.resolveDestination();
    if (!destination || destination.provider !== snapshot.provider) return null;
    const name = PG.PROVIDER_LABELS?.[snapshot.provider] || snapshot.provider;
    // 서버 번들은 provider → channel, vendor 번들은 providers → channels 구조다.
    const provider = destinations?.profiles?.[snapshot.provider] || destinations?.providers?.[snapshot.provider] || destinations?.[snapshot.provider];
    const policy = provider?.channels?.[destination.channel] || provider?.[destination.channel];
    const model = observed(snapshot.model);
    return { kind: "site-information", provider: snapshot.provider, name,
      key: JSON.stringify([snapshot.provider, model ?? null]),
      observedAt: snapshot.checkedAt,
      items: [
        { label: "선택 모델", text: model ?? unknown },
        { label: "계정·워크스페이스", text: observed(snapshot.account) ?? unknown },
        { label: "요금제", text: observed(snapshot.plan) ?? unknown },
        { label: "학습·모델 개선 설정", text: boolean(snapshot.training) },
        { label: "학습 opt-in 상태", text: typeof observed(snapshot.optIn) === "boolean"
          ? (observed(snapshot.optIn) ? "동의 ON (화면 관측)" : "동의 OFF (화면 관측)") : unknown },
        { label: "임시 대화", text: boolean(snapshot.temporary) },
        { label: "제공사·접근 경로 정책", text: policy?.basis || unknown },
        { label: "전송 대상 등급", text: policy?.tier ? (PG.TIER_LABELS?.[policy.tier] || policy.tier) : unknown },
        { label: "정책 확인일", text: policy?.verified_at || provider?.verified_at || unknown },
        { label: "모델별 학습 정책", text: unknown },
      ] };
  }
  return { evaluate };
})();
