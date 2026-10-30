let worker;
let state = { phase: "idle" };
let preparing;
let active = false;
let sequence = 0;
const waiting = new Map();
const queue = new Map();

function publish(next) {
  state = next;
  chrome.runtime.sendMessage({ type: "ai:state", state }).catch(() => {});
}
function stop(code) {
  worker?.terminate(); worker = null;
  for (const { resolve, timer } of waiting.values()) {
    clearTimeout(timer); resolve({ ok: false, error: code });
  }
  waiting.clear();
  for (const job of queue.values()) job.resolve({ ok: false, error: code });
  queue.clear();
  publish({ phase: "error", error: code });
}
function getWorker() {
  if (worker) return worker;
  worker = new Worker(chrome.runtime.getURL("vendor/ai/worker.js"), { type: "module" });
  worker.onmessage = ({ data }) => {
    if (data.state) { publish(data.state); return; }
    const item = waiting.get(data.id);
    if (!item) return;
    waiting.delete(data.id);
    clearTimeout(item.timer);
    item.resolve(data);
  };
  worker.onerror = () => stop("local_ai_load_failed");
  return worker;
}
function call(type, text) {
  return new Promise((resolve) => {
    const id = ++sequence;
    const timer = setTimeout(() => stop("local_ai_timeout"), type === "prepare" ? 360000 : 120000);
    waiting.set(id, { resolve, timer });
    try { getWorker().postMessage({ id, type, text }); }
    catch { stop("local_ai_load_failed"); }
  });
}
async function drain() {
  if (active) return;
  active = true;
  try {
    while (queue.size) {
      const [key, job] = queue.entries().next().value;
      queue.delete(key);
      job.resolve(await call("inspect", job.text));
    }
  } finally { active = false; }
}
function inspect(msg) {
  if (state.phase !== "ready") return Promise.resolve({ ok: false, error: "local_ai_not_ready" });
  return new Promise((resolve) => {
    const key = msg.owner;
    if (queue.has(key)) queue.get(key).resolve({ ok: false, error: "local_ai_superseded" });
    if (queue.size >= 16 && !queue.has(key)) { resolve({ ok: false, error: "local_ai_busy" }); return; }
    queue.set(key, { text: msg.text, resolve });
    void drain();
  });
}
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || msg?.target !== "qoamo-offscreen") return false;
  if (msg.type === "status") { sendResponse({ ok: true, data: state }); return false; }
  if (msg.type === "prepare") {
    if (!preparing) preparing = call("prepare").finally(() => { preparing = null; });
    preparing.then(sendResponse);
  } else if (msg.type === "inspect") inspect(msg).then(sendResponse);
  else { sendResponse({ ok: false, error: "unknown_message" }); return false; }
  return true;
});
