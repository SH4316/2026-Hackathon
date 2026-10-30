// Browser orchestration only. The server API and its implementation are unchanged.
import { mergeInspect, mergeSanitize } from "./personal.js";
const rank = { allow: 0, warn: 1, block: 2 };
const signal = { allow: "green", warn: "yellow", block: "red" };
const disconnected = (r) => !r?.ok && ["network", "timeout"].includes(r?.error);

export function withAI(base, ai, source, fallback = false) {
  if (!ai?.ok || !Object.hasOwn(rank, ai.data?.decision) || !["none", "tier1", "tier2"].includes(ai.data?.tier)) {
    return { ...base, status: "incomplete", decision: base.decision === "block" ? "block" : "warn", signal: "gray",
      inspection_source: source, notices: [...(base.notices || []), ai?.error || "local_ai_failed"] };
  }
  const decision = rank[base.decision] >= rank[ai.data.decision] ? base.decision : ai.data.decision;
  return { ...base, decision, signal: base.status === "complete" ? signal[decision] : "gray",
    inspection_source: source, ai_assessment: ai.data,
    detector_versions: { ...base.detector_versions, local_ai: "qoamo-a7650cb-int8" },
    notices: [...(base.notices || []), ...(fallback ? ["server_unavailable_local_check"] : []),
      ...(ai.data.decision !== "allow" ? ["local_ai_pii_without_location"] : [])] };
}

export async function runInspection({ kind, request, settings, server, ai, guard, personalRules = [] }) {
  if (!settings.serverEnabled && !settings.localAiEnabled) return { ok: false, error: "no_inspector" };
  // Personal rules strengthen either inspection path. Sanitize them BEFORE AI
  // assessment so the model checks exactly the text that will reach the editor.
  const addPersonal = (result) => {
    try {
      return kind === "sanitize" ? mergeSanitize(result, personalRules, request.context?.destination)
        : mergeInspect(result, request.text, personalRules, request.context?.destination);
    } catch { return result; } // Preserve main's behavior for invalid personal rules.
  };
  // Both run independently. A server failure cannot hide an unfinished AI check.
  const remoteTask = settings.serverEnabled ? server(kind, request) : Promise.resolve(null);
  const aiTask = settings.localAiEnabled && kind === "inspect" ? ai(request.text) : null;
  const remote = await remoteTask;
  if (!settings.localAiEnabled) return remote?.ok ? { ok: true, data: addPersonal(remote.data) } : remote;
  if (remote && !remote.ok && !disconnected(remote)) {
    if (aiTask) await aiTask;
    return remote; // Authentication / server errors are not a disconnected client.
  }
  const useServer = remote?.ok;
  const base = addPersonal(useServer ? remote.data
    : kind === "sanitize" ? guard.sanitizeRequest(request) : guard.inspectRequest(request));
  if (!base || !Object.hasOwn(rank, base.decision) || !["complete", "incomplete", "error"].includes(base.status)
      || !Array.isArray(kind === "sanitize" ? base.remaining_findings : base.findings)) {
    if (aiTask) await aiTask;
    return { ok: false, error: "invalid_inspection" };
  }
  const assessed = kind === "sanitize" ? base.sanitized_text : request.text;
  if (typeof assessed !== "string") return { ok: false, error: "invalid_inspection" };
  const prediction = aiTask ? await aiTask : await ai(assessed);
  return { ok: true, data: withAI(base, prediction, useServer ? "server_and_local_ai" : "local_ai", !!remote && !useServer) };
}
