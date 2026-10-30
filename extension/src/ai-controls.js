const defaults = { enabled: true, serverEnabled: true, localAiEnabled: false };

export async function initAIControls() {
  const server = document.getElementById("serverEnabled");
  const ai = document.getElementById("localAiEnabled");
  const status = document.getElementById("aiStatus");
  const progress = document.getElementById("aiProgress");
  const retry = document.getElementById("aiRetry");
  const mode = document.getElementById("inspectionMode");
  let settings = await chrome.storage.local.get(defaults);
  let current = { phase: "idle" };

  function render() {
    server.checked = settings.serverEnabled;
    ai.checked = settings.localAiEnabled;
    const phase = !settings.localAiEnabled || !settings.enabled ? "off" : current.phase;
    const messages = {
      off: settings.localAiEnabled ? "전체 검사가 꺼져 있습니다." : "꺼짐 · 켜면 모델을 준비합니다.",
      idle: "AI 모델 준비를 시작합니다…",
      downloading: `모델 다운로드 중 · ${Math.round((current.loaded || 0) / 1e6)} / 266 MB`,
      verifying: "다운로드한 모델을 확인하는 중…",
      loading: "AI 모델을 메모리에 불러오는 중…",
      ready: "준비 완료 · 이 기기에서 검사합니다.",
      error: "AI를 준비하지 못했습니다. 연결·저장 공간을 확인하고 다시 시도하세요.",
    };
    status.textContent = messages[phase] || messages.error;
    status.dataset.state = phase === "ready" ? "ok" : phase === "error" ? "error" : "checking";
    progress.hidden = phase !== "downloading";
    progress.max = current.total || 265651170;
    progress.value = current.loaded || 0;
    retry.hidden = !settings.localAiEnabled || !settings.enabled || !["error", "idle"].includes(phase);
    mode.textContent = !settings.enabled ? "전체 검사가 꺼져 있어 전송을 검사하지 않습니다."
      : settings.serverEnabled && settings.localAiEnabled ? "서버와 기기 내 AI가 함께 검사합니다. 서버 연결 실패 시 기기 내 검사로 계속합니다."
      : settings.localAiEnabled ? "기기 내 AI와 기본 규칙으로 검사합니다. 원문을 검사 서버로 보내지 않습니다."
      : settings.serverEnabled ? "서버로 검사합니다. 서버 연결이 끊기면 전송을 보류합니다."
      : "검사 방식이 모두 꺼져 있어 전송을 보류합니다. 하나 이상 켜 주세요.";
  }
  async function refresh() {
    const res = await chrome.runtime.sendMessage({ type: "ai:status" }).catch(() => null);
    current = res?.ok ? res.data : { phase: "error" };
    render();
  }
  for (const [el, key] of [[server, "serverEnabled"], [ai, "localAiEnabled"]]) {
    el.addEventListener("change", async () => {
      settings[key] = el.checked;
      current = { phase: "loading" };
      render();
      await chrome.storage.local.set({ [key]: el.checked });
      if (key === "localAiEnabled" && el.checked) {
        chrome.runtime.sendMessage({ type: "ai:prepare" }).then(refresh).catch(refresh);
      } else void refresh();
    });
  }
  retry.addEventListener("click", async () => {
    current = { phase: "loading" }; render();
    await chrome.runtime.sendMessage({ type: "ai:prepare" }).catch(() => null);
    await refresh();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    for (const key of Object.keys(defaults)) if (changes[key]) settings[key] = changes[key].newValue ?? defaults[key];
    if (changes.aiState) current = changes.aiState.newValue;
    render();
  });
  render();
  void refresh();
}
