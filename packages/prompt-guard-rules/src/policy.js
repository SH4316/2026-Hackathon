// 정책 → 위험도·조치 결정(server/app/policy/engine.py).
// 전송 목적지 등급은 조치를 강화만 하고 완화하지 않는다.

const SEVERITY_RANK = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
const ACTION_RANK = { allow: 0, warn: 1, mask: 2, block: 3 };
const DECISION_RANK = { allow: 0, warn: 1, block: 2 };

const maxBy = (rank, a, b) => (rank[b] > rank[a] ? b : a);

function typePolicy(name, spec = {}) {
  return {
    category: spec.category ?? "uncategorized",
    severity: spec.severity ?? "medium",
    action: spec.action ?? "warn",
    token: spec.token ?? name.toUpperCase(),
  };
}

const toUtcDays = (d) => {
  const iso = typeof d === "string" ? d : d.toISOString().slice(0, 10);
  const [y, m, day] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, day) / 86_400_000;
};

export class Policy {
  /** @param bundle data/policy.js 와 같은 구조(server/policies/*.yaml 을 합친 것) */
  constructor(bundle) {
    this.version = String(bundle.version);
    this.modelRequired = !!bundle.model_required;
    this.default = typePolicy("UNKNOWN", bundle.default);
    this.types = Object.fromEntries(
      Object.entries(bundle.types ?? {}).map(([name, spec]) => [name, typePolicy(name, spec)]));

    const d = bundle.destinations;
    this.tiers = {};
    Object.entries(d.tiers).forEach(([name, spec], rank) => {
      this.tiers[name] = { name, rank, escalate: spec?.escalate ?? {}, minDecision: spec?.min_decision ?? "allow" };
    });
    if (!this.tiers[d.default_tier]) throw new Error("default_tier must be one of tiers");
    this.defaultTier = d.default_tier;
    this.staleAfterDays = Number(d.stale_after_days ?? 90);
    this.profiles = {};
    this.verifiedAt = {};
    for (const [provider, spec] of Object.entries(d.profiles ?? {})) {
      this.verifiedAt[provider] = spec.verified_at;
      this.profiles[provider] = {};
      for (const [channel, c] of Object.entries(spec.channels)) {
        if (!this.tiers[c.tier]) throw new Error(`unknown tier: ${c.tier}`);
        this.profiles[provider][channel] = { tier: c.tier, basis: c.basis ?? "" };
      }
    }
    this.orgContracts = new Set((d.org_contracts ?? []).map((c) => `${c.provider}/${c.channel}`));
  }

  /** 대시보드 항목(사용자 규칙·문맥 탐지기)의 유형 정책을 더한 새 Policy. 내장 유형은 덮어쓰지 않는다. */
  withCustomTypes(items) {
    const p = Object.create(Policy.prototype);
    Object.assign(p, this);
    p.types = { ...this.types };
    for (const i of items) {
      if (Object.hasOwn(this.types, i.id)) throw new Error(`내장 유형과 겹침: ${i.id}`);
      p.types[i.id] = typePolicy(i.id, i);
    }
    return p;
  }

  forType(type) {
    return this.types[type] ?? this.default;
  }

  actionFor(type, tier) {
    const base = this.forType(type).action;
    return maxBy(ACTION_RANK, base, tier.escalate[base] ?? base);
  }

  priority(c) {
    const tp = this.forType(c.type);
    return [ACTION_RANK[tp.action], SEVERITY_RANK[tp.severity], c.detector === "rule" ? 1 : 0, c.cpEnd - c.cpStart];
  }

  isStale(provider, today) {
    return toUtcDays(today) - toUtcDays(this.verifiedAt[provider]) > this.staleAfterDays;
  }

  /** @returns {[{provider, channel, tier, basis, verified}, string[]]} */
  resolveDestination(provider, channel, today) {
    const def = this.tiers[this.defaultTier];
    const channels = this.profiles[provider ?? ""];
    if (!channels) return [{ provider: "unknown", channel: "unknown", tier: def, basis: null, verified: false }, ["destination_unknown"]];
    if (!Object.hasOwn(channels, channel ?? "")) {
      return [{ provider, channel: "unknown", tier: def, basis: null, verified: false }, ["destination_channel_unknown"]];
    }
    const { tier: tierName, basis } = channels[channel];
    const tier = this.tiers[tierName];
    if (this.isStale(provider, today) && tier.rank < def.rank) {
      return [{ provider, channel, tier: def, basis, verified: false }, ["destination_policy_stale"]];
    }
    if (tier.rank >= def.rank) return [{ provider, channel, tier, basis, verified: false }, []];
    if (this.orgContracts.has(`${provider}/${channel}`)) return [{ provider, channel, tier, basis, verified: true }, []];
    return [{ provider, channel, tier: def, basis, verified: false }, ["destination_channel_unverified"]];
  }
}

/** 원문 기준 판단. mask 대상이 남아 있으면 원문은 전송할 수 없으므로 block. */
export function decide(actions, minDecision = "allow") {
  let decision = "allow";
  if (actions.some((a) => a === "block" || a === "mask")) decision = "block";
  else if (actions.includes("warn")) decision = "warn";
  return maxBy(DECISION_RANK, decision, minDecision);
}
