import { getSettings } from "../core/storage.js";

const nodes = {
  modeText: document.querySelector("#modeText"),
  statusDot: document.querySelector("#statusDot"),
  statusText: document.querySelector("#statusText"),
  lastSync: document.querySelector("#lastSync"),
  created: document.querySelector("#created"),
  updated: document.querySelector("#updated"),
  pulled: document.querySelector("#pulled"),
  skipped: document.querySelector("#skipped"),
  rules: document.querySelector("#rules"),
  syncNow: document.querySelector("#syncNow"),
  pauseToggle: document.querySelector("#pauseToggle"),
  openOptions: document.querySelector("#openOptions")
};

let settings = await getSettings();
render();

nodes.syncNow.addEventListener("click", async () => {
  nodes.syncNow.disabled = true;
  nodes.syncNow.textContent = "同步中";
  try {
    const response = await sendMessage({ type: "RUN_SYNC" });
    settings = await getSettings();
    render();
    if (response?.result?.alreadyRunning) {
      nodes.statusDot.className = "dot warn";
      nodes.statusText.textContent = "同步中";
    }
    if (!response?.ok) {
      nodes.statusDot.className = "dot warn";
      nodes.statusText.textContent = "同步失败";
    }
  } finally {
    nodes.syncNow.disabled = false;
    nodes.syncNow.textContent = "同步";
  }
});

nodes.pauseToggle.addEventListener("click", async () => {
  await sendMessage({ type: settings.syncPaused ? "RESUME_SYNC" : "PAUSE_SYNC" });
  settings = await getSettings();
  render();
});

nodes.openOptions.addEventListener("click", () => chrome.runtime.openOptionsPage());

function render() {
  nodes.modeText.textContent = settings.officeMode ? "Office Mode · 脱敏显示" : "Private Mode";
  nodes.pauseToggle.textContent = settings.syncPaused ? "恢复" : "暂停";

  const hasToken = Boolean(settings.raindropToken);
  const enabledRules = (settings.rules || []).filter((rule) => rule.enabled);
  const healthy = hasToken && enabledRules.length > 0 && !settings.syncPaused;
  nodes.statusDot.className = `dot ${healthy ? "" : "warn"}`;
  nodes.statusText.textContent = settings.syncPaused ? "已暂停" : healthy ? "正常" : "待配置";

  nodes.lastSync.textContent = `最近同步：${settings.lastSyncAt ? formatTime(settings.lastSyncAt) : "未同步"}`;
  nodes.created.textContent = settings.lastSyncSummary.created || 0;
  nodes.updated.textContent = settings.lastSyncSummary.updated || 0;
  nodes.pulled.textContent = settings.lastSyncSummary.pulled || 0;
  nodes.skipped.textContent = settings.lastSyncSummary.skipped || 0;

  nodes.rules.innerHTML = "";
  if (enabledRules.length === 0) {
    nodes.rules.innerHTML = "<div class=\"empty-state\">暂无启用规则</div>";
    return;
  }

  for (const rule of enabledRules) {
    const item = document.createElement("div");
    item.className = "popup-rule";
    item.innerHTML = `
      <div class="item-title">${escapeHtml(rule.name)}</div>
      <div class="hint">${escapeHtml(rule.sourceChromeFolderName || "Chrome 文件夹")} → ${settings.officeMode ? "已授权 collection" : escapeHtml(rule.targetRaindropCollectionName || "Raindrop")}</div>
    `;
    nodes.rules.append(item);
  }
}

function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

function formatTime(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  }[char]));
}
