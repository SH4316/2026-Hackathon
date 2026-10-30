// 공식 소비자 정책에서 필수 수집과 학습 거부 불가가 모두 검증된 항목만 추가한다.
// 필수 스키마: provider, name, status="verified", channel="consumer", hosts,
// mandatoryCollection=true, trainingOptOut="unavailable", checkedAt, sources, items.
// Kimi와 DeepSeek는 학습 거부를 제공한다:
// https://www.kimi.com/user/agreement/userPrivacy?lang=en-US&version=v2
// https://cdn.deepseek.com/policies/en-US/model-algorithm-disclosure.html
// Grok의 일부 비로그인 사용자는 거부할 수 없지만 수집은 조건부다:
// https://x.ai/legal/faq
var PG = (globalThis.PG = globalThis.PG || {});
PG.entryPolicy = (() => {
  const confirmedPolicies = Object.freeze(Object.create(null));

  function observed(field) {
    if (field && typeof field === "object") {
      if (field.status !== "observed") return "";
      field = field.value;
    }
    if (typeof field === "boolean") return String(field);
    return typeof field === "string" ? field.trim().toLowerCase() : "";
  }

  function assess(policy, snapshot, destination, hostname) {
    if (!policy || !snapshot || !destination || typeof hostname !== "string") return null;
    if (policy.status !== "verified" || policy.channel !== "consumer" ||
        policy.mandatoryCollection !== true || policy.trainingOptOut !== "unavailable" ||
        typeof policy.provider !== "string" || !policy.provider ||
        typeof policy.name !== "string" || !policy.name ||
        typeof policy.checkedAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(policy.checkedAt) ||
        !Array.isArray(policy.hosts) || !policy.hosts.includes(hostname) ||
        !Array.isArray(policy.sources) || !policy.sources.length ||
        !policy.sources.every((source) => typeof source === "string" && /^https:\/\//.test(source)) ||
        !Array.isArray(policy.items) || !policy.items.length ||
        !policy.items.every((item) => item && ["retention", "training"].includes(item.kind) &&
          typeof item.text === "string" && item.text && policy.sources.includes(item.source)) ||
        destination.channel !== "consumer" || destination.provider !== policy.provider ||
        snapshot.provider !== policy.provider) return null;

    const account = `${observed(snapshot.account)} ${observed(snapshot.plan)}`;
    if (/business|enterprise|team|work|school|organization|organisation|workspace|edu|회사|기업|조직|업무|학교|교육기관/.test(account)) return null;
    const training = observed(snapshot.training);
    const temporary = observed(snapshot.temporary);
    if (/^(false|off|disabled|no|꺼짐|사용 안 함|비활성화)$/.test(training) ||
        /^(true|on|enabled|yes|active|임시 대화|임시 채팅)$/.test(temporary)) return null;

    const items = policy.items.map(({ kind, text, source }) => ({ kind, text, source }));
    return { kind: "mandatory-collection", provider: policy.provider, name: policy.name, items, checkedAt: policy.checkedAt,
      key: JSON.stringify([policy.provider, hostname, policy.checkedAt, items]) };
  }

  function assessTraining(snapshot, destination, hostname) {
    if (!snapshot || !destination || typeof hostname !== "string" ||
        !snapshot.training || snapshot.training.status !== "observed" || snapshot.training.value !== true ||
        destination.channel !== "consumer" || destination.provider !== snapshot.provider ||
        !Array.isArray(PG.SITES) || !PG.SITES.some((site) => site.provider === snapshot.provider &&
          Array.isArray(site.hosts) && site.hosts.includes(hostname))) return null;
    const account = `${observed(snapshot.account)} ${observed(snapshot.plan)}`;
    if (/business|enterprise|team|work|school|organization|organisation|workspace|edu|회사|기업|조직|업무|학교|교육기관/.test(account) ||
        observed(snapshot.temporary) === "true") return null;
    const name = PG.PROVIDER_LABELS && Object.hasOwn(PG.PROVIDER_LABELS, snapshot.provider)
      ? PG.PROVIDER_LABELS[snapshot.provider] : snapshot.provider;
    return { kind: "training-enabled", provider: snapshot.provider, name,
      key: `training-enabled:${snapshot.provider}`, observedAt: snapshot.checkedAt, items: [] };
  }

  function evaluate(snapshot) {
    if (!snapshot || typeof snapshot.provider !== "string" ||
        typeof PG.resolveDestination !== "function" || typeof location === "undefined") return null;
    const destination = PG.resolveDestination();
    const training = assessTraining(snapshot, destination, location.hostname);
    if (training) return training;
    if (!Object.hasOwn(confirmedPolicies, snapshot.provider)) return null;
    return assess(confirmedPolicies[snapshot.provider], snapshot, destination, location.hostname);
  }
  return { assess, assessTraining, evaluate };
})();
