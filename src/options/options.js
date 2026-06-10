import { listBookmarkFolders } from "../core/chrome-bookmarks.js";
import { RaindropApi } from "../core/raindrop-api.js";
import { ensureAccessToken, getRedirectUri } from "../core/raindrop-auth.js";
import { createRule } from "../core/rules.js";
import { appendLog, clearLogs, getLogs, getSettings, saveSettings } from "../core/storage.js";

const nodes = {
  token: document.querySelector("#token"),
  clientId: document.querySelector("#clientId"),
  clientSecret: document.querySelector("#clientSecret"),
  redirectUri: document.querySelector("#redirectUri"),
  redirectPath: document.querySelector("#redirectPath"),
  connectRaindrop: document.querySelector("#connectRaindrop"),
  disconnectRaindrop: document.querySelector("#disconnectRaindrop"),
  loadCollections: document.querySelector("#loadCollections"),
  syncNow: document.querySelector("#syncNow"),
  connectionBadge: document.querySelector("#connectionBadge"),
  tokenBadge: document.querySelector("#tokenBadge"),
  statusHeadline: document.querySelector("#statusHeadline"),
  created: document.querySelector("#created"),
  updated: document.querySelector("#updated"),
  archived: document.querySelector("#archived"),
  pulled: document.querySelector("#pulled"),
  skipped: document.querySelector("#skipped"),
  failed: document.querySelector("#failed"),
  statusLine: document.querySelector("#statusLine"),
  rules: document.querySelector("#rules"),
  ruleSearch: document.querySelector("#ruleSearch"),
  ruleCount: document.querySelector("#ruleCount"),
  ruleDetail: document.querySelector("#ruleDetail"),
  ruleDetailHint: document.querySelector("#ruleDetailHint"),
  directionHint: document.querySelector("#directionHint"),
  resetRuleFromChrome: document.querySelector("#resetRuleFromChrome"),
  bulkChromeRoot: document.querySelector("#bulkChromeRoot"),
  bulkRaindropRoot: document.querySelector("#bulkRaindropRoot"),
  bulkMode: document.querySelector("#bulkMode"),
  bulkHint: document.querySelector("#bulkHint"),
  dedupeCollection: document.querySelector("#dedupeCollection"),
  dedupeRaindropCollection: document.querySelector("#dedupeRaindropCollection"),
  dedupeHint: document.querySelector("#dedupeHint"),
  generateRules: document.querySelector("#generateRules"),
  addRule: document.querySelector("#addRule"),
  saveRules: document.querySelector("#saveRules"),
  officeMode: document.querySelector("#officeMode"),
  syncPaused: document.querySelector("#syncPaused"),
  redactLogs: document.querySelector("#redactLogs"),
  sensitiveKeywords: document.querySelector("#sensitiveKeywords"),
  sensitiveDomains: document.querySelector("#sensitiveDomains"),
  sensitivePaths: document.querySelector("#sensitivePaths"),
  refreshLogs: document.querySelector("#refreshLogs"),
  clearLogs: document.querySelector("#clearLogs"),
  logs: document.querySelector("#logs"),
  ruleTemplate: document.querySelector("#ruleTemplate")
};

let settings = await getSettings();
let folders = await listBookmarkFolders();
let collections = normalizeCollections(settings.allowedCollections || []);
let selectedRuleId = settings.rules?.[0]?.id || "";
let resetTaskTimer = null;
let dedupeTaskTimer = null;
let latestDedupeTask = null;

render();
renderLogs();
startResetTaskPolling();
startDedupeTaskPolling();

nodes.token.addEventListener("change", saveFromForm);
nodes.clientId.addEventListener("change", saveFromForm);
nodes.clientSecret.addEventListener("change", saveFromForm);
nodes.redirectPath.addEventListener("change", saveFromForm);
nodes.officeMode.addEventListener("change", saveFromForm);
nodes.syncPaused.addEventListener("change", saveFromForm);
nodes.redactLogs.addEventListener("change", saveFromForm);
nodes.sensitiveKeywords.addEventListener("change", saveFromForm);
nodes.sensitiveDomains.addEventListener("change", saveFromForm);
nodes.sensitivePaths.addEventListener("change", saveFromForm);
nodes.ruleSearch.addEventListener("input", renderRules);
nodes.bulkChromeRoot.addEventListener("change", renderBulkPreview);
nodes.bulkRaindropRoot.addEventListener("change", renderBulkPreview);
nodes.bulkMode.addEventListener("change", renderBulkPreview);
nodes.dedupeCollection.addEventListener("change", () => {
  renderDedupeControls();
  renderDedupeTask(latestDedupeTask);
});
nodes.ruleDetail.addEventListener("change", () => {
  collectRuleDetail();
  renderRules();
  renderRuleDetail();
  renderStatus();
  renderBulkPreview();
  schedulePersistRules();
});

nodes.dedupeRaindropCollection.addEventListener("click", async () => {
  await saveFromForm();
  const collectionId = Number(nodes.dedupeCollection.value);
  const collection = collections.find((item) => item._id === collectionId);
  if (!collection) {
    nodes.dedupeHint.textContent = "请先选择一个 Raindrop Collection。";
    nodes.dedupeHint.classList.add("warning-text");
    return;
  }

  const confirmed = window.confirm(`将扫描「${collectionLabel(collection)}」中的全部书签，按 URL 保留最近更新的一条，并归档重复项。这个操作独立于同步规则，且可能触发 Raindrop 限流等待。继续吗？`);
  if (!confirmed) return;

  setButtonLoading(nodes.dedupeRaindropCollection, "去重中", true);
  try {
    const response = await chrome.runtime.sendMessage({
      type: "DEDUPE_RAINDROP_COLLECTION",
      collectionId,
      collectionName: collectionLabel(collection)
    });
    if (!response?.ok) throw new Error(response?.error || "去重失败");
    renderDedupeTask(response.result);
    startDedupeTaskPolling();
  } catch (error) {
    nodes.dedupeHint.textContent = `去重失败：${error.message}`;
    nodes.dedupeHint.classList.add("warning-text");
    setButtonLoading(nodes.dedupeRaindropCollection, "查重并归档重复项", false);
  }
});

nodes.resetRuleFromChrome.addEventListener("click", async () => {
  collectRuleDetail();
  const rule = selectedRule();
  if (!rule) return;
  if (rule.direction !== "chrome-to-raindrop") {
    nodes.ruleDetailHint.textContent = "只有 Chrome → Raindrop 推送规则支持按 Chrome 清空重建。";
    return;
  }
  if (!Number(rule.targetRaindropCollectionId)) {
    nodes.ruleDetailHint.textContent = "请先为规则选择有效的 Raindrop Collection。";
    return;
  }

  const confirmed = window.confirm(`将归档规则「${rule.name}」目标 Raindrop Collection 中的全部书签，然后按 Chrome 当前内容重新同步。这个操作可能需要较长时间，且会触发 Raindrop 限流等待。继续吗？`);
  if (!confirmed) return;

  setButtonLoading(nodes.resetRuleFromChrome, "正在重建", true);
  try {
    await persistRulesOnly();
    const response = await chrome.runtime.sendMessage({
      type: "RESET_RULE_FROM_CHROME",
      ruleId: rule.id
    });
    if (!response?.ok) throw new Error(response?.error || "重建失败");
    renderResetTask(response.result);
    startResetTaskPolling();
  } catch (error) {
    nodes.ruleDetailHint.textContent = `重建失败：${error.message}`;
    setButtonLoading(nodes.resetRuleFromChrome, "清空目标并以 Chrome 重建", false);
  }
});

nodes.addRule.addEventListener("click", async () => {
  collectRuleDetail();
  const folder = folders[0];
  const collection = sortCollectionsForDisplay(collections)[0];
  if (!folder || !collection) {
    nodes.statusLine.textContent = "请先确认 Chrome 文件夹可读取，并读取 Raindrop Collections。";
    return;
  }
  const rule = createRule({
    name: "工作书签备份",
    sourceChromeFolderId: folder?.id || "",
    sourceChromeFolderName: folder?.path || "",
    targetRaindropCollectionId: collection?._id || 0,
    targetRaindropCollectionName: collection?.path || collection?.title || "Work Backup"
  });
  settings.rules = [...(settings.rules || []), rule];
  selectedRuleId = rule.id;
  renderRules();
  renderRuleDetail();
  renderStatus();
  await persistRulesOnly();
});

nodes.generateRules.addEventListener("click", async () => {
  collectRuleDetail();
  const result = generateBulkRules();
  renderRules();
  renderRuleDetail();
  renderStatus();
  renderBulkPreview(result);
  if (result.created > 0) await persistRulesOnly();
});

nodes.saveRules.addEventListener("click", async () => {
  collectRuleDetail();
  await saveFromForm();
});

nodes.loadCollections.addEventListener("click", async () => {
  await saveFromForm();
  setButtonLoading(nodes.loadCollections, "读取中", true);
  try {
    const accessToken = await ensureAccessToken(settings);
    const api = new RaindropApi(accessToken);
    const rawCollections = await api.listCollections();
    collections = normalizeCollections(rawCollections);
    settings.allowedCollections = collections;
    await appendLog({
      level: "info",
      event: "collections-loaded",
      message: `Loaded ${collections.length} unique collections.`,
      summary: collectionShapeSummary(rawCollections)
    });
    await saveSettings(settings);
    renderBulkControls();
    renderDedupeControls();
    renderDedupeTask(latestDedupeTask);
    renderRules();
    renderRuleDetail();
    renderStatus();
  } catch (error) {
    nodes.statusLine.textContent = `读取 collection 失败：${error.message}`;
  } finally {
    setButtonLoading(nodes.loadCollections, "读取 Collections", false);
  }
});

nodes.connectRaindrop.addEventListener("click", async () => {
  await saveFromForm();
  setButtonLoading(nodes.connectRaindrop, "授权中", true);
  try {
    const response = await chrome.runtime.sendMessage({ type: "CONNECT_RAINDROP" });
    if (!response?.ok) throw new Error(response?.error || "OAuth failed.");
    settings = await getSettings();
    render();
  } catch (error) {
    nodes.statusLine.textContent = `连接失败：${error.message}`;
  } finally {
    setButtonLoading(nodes.connectRaindrop, "连接 Raindrop", false);
  }
});

nodes.disconnectRaindrop.addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({ type: "DISCONNECT_RAINDROP" });
  if (!response?.ok) {
    nodes.statusLine.textContent = `断开失败：${response?.error || "unknown error"}`;
    return;
  }
  settings = await getSettings();
  render();
});

nodes.syncNow.addEventListener("click", async () => {
  setButtonLoading(nodes.syncNow, "同步中", true);
  try {
    const response = await chrome.runtime.sendMessage({ type: "RUN_SYNC" });
    if (!response?.ok) throw new Error(response?.error || "同步失败");
    const summary = response.result || {};
    settings = await getSettings();
    render();
    renderLogs();
    if (summary.alreadyRunning) {
      nodes.statusLine.textContent = "已有同步任务正在运行，本次点击已跳过。请稍后刷新日志或等待当前任务完成。";
    }
  } catch (error) {
    nodes.statusLine.textContent = `同步失败：${error.message}`;
    await renderLogs();
  } finally {
    setButtonLoading(nodes.syncNow, "立即同步", false);
  }
});

nodes.refreshLogs.addEventListener("click", renderLogs);
nodes.clearLogs.addEventListener("click", async () => {
  await clearLogs();
  renderLogs();
});

function render() {
  nodes.token.value = settings.raindropToken || "";
  nodes.clientId.value = settings.oauthClientId || "";
  nodes.clientSecret.value = settings.oauthClientSecret || "";
  nodes.redirectPath.value = settings.oauthRedirectPath || "";
  nodes.redirectUri.value = getRedirectUri(settings);
  nodes.officeMode.checked = Boolean(settings.officeMode);
  nodes.syncPaused.checked = Boolean(settings.syncPaused);
  nodes.redactLogs.checked = Boolean(settings.redactLogs);
  nodes.sensitiveKeywords.value = lines(settings.sensitiveFilters.keywords);
  nodes.sensitiveDomains.value = lines(settings.sensitiveFilters.domains);
  nodes.sensitivePaths.value = lines(settings.sensitiveFilters.paths);

  const summary = settings.lastSyncSummary || {};
  nodes.created.textContent = summary.created || 0;
  nodes.updated.textContent = summary.updated || 0;
  nodes.archived.textContent = summary.archived || 0;
  nodes.pulled.textContent = summary.pulled || 0;
  nodes.skipped.textContent = summary.skipped || 0;
  nodes.failed.textContent = summary.failed || 0;

  renderStatus();
  renderBulkControls();
  renderDedupeControls();
  renderDedupeTask(latestDedupeTask);
  renderBulkPreview();
  renderRules();
  renderRuleDetail();
}

function renderStatus() {
  const connected = Boolean(settings.raindropToken);
  const enabledRules = (settings.rules || []).filter((rule) => rule.enabled).length;
  const configured = connected && enabledRules > 0;

  if (settings.syncPaused) {
    nodes.statusHeadline.textContent = "同步已暂停";
    nodes.connectionBadge.className = "badge warn";
    nodes.connectionBadge.textContent = "已暂停";
  } else if (configured) {
    nodes.statusHeadline.textContent = "同步边界已启用";
    nodes.connectionBadge.className = "badge";
    nodes.connectionBadge.textContent = "运行中";
  } else if (connected) {
    nodes.statusHeadline.textContent = "等待同步规则";
    nodes.connectionBadge.className = "badge warn";
    nodes.connectionBadge.textContent = "需配置";
  } else {
    nodes.statusHeadline.textContent = "等待 Raindrop 授权";
    nodes.connectionBadge.className = "badge warn";
    nodes.connectionBadge.textContent = "未连接";
  }

  nodes.tokenBadge.innerHTML = connected
    ? "<span class=\"dot\"></span><span>已授权</span>"
    : "<span class=\"dot warn\"></span><span>未授权</span>";

  nodes.statusLine.textContent = [
    `最近同步：${settings.lastSyncAt ? formatTime(settings.lastSyncAt) : "未同步"}`,
    `启用规则：${enabledRules}`,
    settings.officeMode ? "Office Mode" : "Private Mode"
  ].join(" · ");
}

function renderBulkControls() {
  const previousFolder = nodes.bulkChromeRoot.value;
  const previousCollection = nodes.bulkRaindropRoot.value;
  const folderOptions = folders.map((folder) => `<option value="${escapeHtml(folder.id)}">${escapeHtml(folder.path)}</option>`).join("");
  const collectionOptions = sortCollectionsForDisplay(collections)
    .map((collection) => `<option value="${collection._id}">${escapeHtml(collectionLabel(collection))}</option>`)
    .join("");
  nodes.bulkChromeRoot.innerHTML = folderOptions || "<option value=\"\">无 Chrome 文件夹</option>";
  nodes.bulkRaindropRoot.innerHTML = collectionOptions || "<option value=\"0\">先读取 Collections</option>";
  if (previousFolder && folders.some((folder) => folder.id === previousFolder)) {
    nodes.bulkChromeRoot.value = previousFolder;
  }
  if (previousCollection && collections.some((collection) => String(collection._id) === previousCollection)) {
    nodes.bulkRaindropRoot.value = previousCollection;
  }
  nodes.addRule.disabled = folders.length === 0 || collections.length === 0;
  nodes.generateRules.disabled = folders.length === 0 || collections.length === 0;
}

function renderDedupeControls() {
  const previousCollection = nodes.dedupeCollection.value;
  const collectionOptions = sortCollectionsForDisplay(collections)
    .map((collection) => `<option value="${collection._id}">${escapeHtml(collectionLabel(collection))}</option>`)
    .join("");
  nodes.dedupeCollection.innerHTML = collectionOptions || "<option value=\"0\">先读取 Collections</option>";
  if (previousCollection && collections.some((collection) => String(collection._id) === previousCollection)) {
    nodes.dedupeCollection.value = previousCollection;
  }
  renderDedupeIdleState();
}

function renderDedupeIdleState() {
  nodes.dedupeRaindropCollection.disabled = collections.length === 0;
  nodes.dedupeHint.classList.remove("success-text", "warning-text");
  nodes.dedupeHint.textContent = collections.length
    ? "选择一个 collection 后，可独立查重并归档重复 URL 的多余副本。"
    : "先读取 Collections，再选择一个 Raindrop collection 执行独立去重。";
}

function renderBulkPreview(result = null) {
  nodes.bulkHint.classList.remove("success-text", "warning-text");
  const preview = buildBulkPairs();
  const duplicateCount = preview.pairs.filter(([folder, collection]) => ruleExists(folder.id, collection._id)).length;
  const newCount = preview.pairs.length - duplicateCount;

  if (result) {
    nodes.bulkHint.textContent = `已新增 ${result.created} 条，跳过 ${result.skipped} 条。候选 ${result.total} 条。`;
    nodes.bulkHint.classList.add(result.created > 0 ? "success-text" : "warning-text");
    return;
  }

  if (!preview.chromeRoot || !preview.raindropRoot) {
    nodes.bulkHint.textContent = nodes.bulkMode.value === "children-by-name"
      ? "选择 Chrome 扫描范围后，将与全部 Raindrop Collection 做同名匹配。"
      : "先选择 Chrome 文件夹和 Raindrop Collection。";
    return;
  }

  if (preview.pairs.length === 0) {
    nodes.bulkHint.textContent = preview.reason || "当前选择没有可生成的规则。";
    nodes.bulkHint.classList.add("warning-text");
    return;
  }

  const sample = preview.pairs.slice(0, 3)
    .map(([folder, collection]) => `${lastPathPart(folder.path)} → ${lastPathPart(collection.path || collection.title)}`)
    .join("，");
  nodes.bulkHint.textContent = `将生成 ${newCount} 条新规则，${duplicateCount} 条已存在会跳过。${sample ? `示例：${sample}` : ""}`;
}

function renderRules() {
  nodes.rules.innerHTML = "";
  const query = nodes.ruleSearch.value.trim().toLowerCase();
  const allRules = settings.rules || [];
  const filtered = allRules.filter((rule) => {
    const text = [
      rule.name,
      rule.sourceChromeFolderName,
      rule.targetRaindropCollectionName
    ].join(" ").toLowerCase();
    return !query || text.includes(query);
  });

  nodes.ruleCount.textContent = `${filtered.length} / ${allRules.length} 条`;
  if (allRules.length === 0) {
    nodes.rules.innerHTML = `
      <div class="empty-state">
        <div>
          <strong>还没有同步规则</strong>
          <p class="hint">先读取 Collections，再用批量生成创建规则。</p>
        </div>
      </div>
    `;
    selectedRuleId = "";
    return;
  }

  if (filtered.length === 0) {
    nodes.rules.innerHTML = "<div class=\"empty-state\">没有匹配的规则</div>";
    return;
  }

  if (!allRules.some((rule) => rule.id === selectedRuleId)) {
    selectedRuleId = allRules[0]?.id || "";
  }

  for (const rule of filtered) {
    const fragment = nodes.ruleTemplate.content.cloneNode(true);
    const row = fragment.querySelector(".compact-rule-row");
    row.classList.toggle("selected", rule.id === selectedRuleId);
    row.querySelector("[data-action='toggle']").checked = Boolean(rule.enabled);
    row.querySelector(".rule-row-title").textContent = rule.name || "未命名规则";
    row.querySelector(".rule-row-path").textContent = `${rule.sourceChromeFolderName || "Chrome 文件夹"} → ${rule.targetRaindropCollectionName || "Raindrop Collection"}`;
    row.querySelector(".badge").textContent = directionLabel(rule.direction);

    row.querySelector("[data-action='toggle']").addEventListener("change", (event) => {
      collectRuleDetail();
      rule.enabled = event.target.checked;
      renderRules();
      renderRuleDetail();
      renderStatus();
      renderBulkPreview();
      schedulePersistRules();
    });

    row.querySelector("[data-action='select']").addEventListener("click", () => {
      collectRuleDetail();
      selectedRuleId = rule.id;
      renderRules();
      renderRuleDetail();
    });

    row.querySelector("[data-action='delete']").addEventListener("click", () => {
      const confirmed = window.confirm(`删除规则「${rule.name || "未命名规则"}」？这不会删除 Chrome 或 Raindrop 中的书签。`);
      if (!confirmed) return;
      settings.rules = (settings.rules || []).filter((item) => item.id !== rule.id);
      selectedRuleId = settings.rules[0]?.id || "";
      renderRules();
      renderRuleDetail();
      renderStatus();
      renderBulkPreview();
      schedulePersistRules();
    });

    row.querySelector("[data-action='duplicate']").addEventListener("click", () => {
      collectRuleDetail();
      const copy = createRule({
        ...rule,
        id: crypto.randomUUID(),
        name: `${rule.name} 副本`
      });
      settings.rules = [...(settings.rules || []), copy];
      selectedRuleId = copy.id;
      renderRules();
      renderRuleDetail();
      renderStatus();
      renderBulkPreview();
      schedulePersistRules();
    });

    nodes.rules.append(fragment);
  }
}

function renderRuleDetail() {
  const rule = selectedRule();
  nodes.ruleDetail.classList.toggle("is-empty", !rule);
  setDetailDisabled(!rule);
  if (!rule) {
    nodes.ruleDetailHint.textContent = "选择左侧规则后编辑过滤、标签和同步间隔。";
    clearDetail();
    return;
  }

  nodes.ruleDetailHint.textContent = `${rule.sourceChromeFolderName || "Chrome 文件夹"} → ${rule.targetRaindropCollectionName || "Raindrop Collection"}`;
  normalizeRuleConflictPolicy(rule);
  setInput(nodes.ruleDetail, "name", rule.name);
  setInput(nodes.ruleDetail, "enabled", rule.enabled);
  setInput(nodes.ruleDetail, "direction", rule.direction || "chrome-to-raindrop");
  setInput(nodes.ruleDetail, "conflictPolicy", rule.conflictPolicy || "chrome-wins");
  setInput(nodes.ruleDetail, "excludePaths", lines(rule.excludePaths));
  setInput(nodes.ruleDetail, "domainBlocklist", lines(rule.domainBlocklist));
  setInput(nodes.ruleDetail, "domainAllowlist", lines(rule.domainAllowlist));
  setInput(nodes.ruleDetail, "titleBlocklist", lines(rule.titleBlocklist));
  setInput(nodes.ruleDetail, "urlBlocklist", lines(rule.urlBlocklist));
  setInput(nodes.ruleDetail, "tags", (rule.tags || []).join(", "));
  setInput(nodes.ruleDetail, "scheduleMinutes", rule.scheduleMinutes || 30);

  const folderSelect = nodes.ruleDetail.querySelector("[data-field='sourceChromeFolderId']");
  folderSelect.innerHTML = folders.map((folder) => `<option value="${escapeHtml(folder.id)}">${escapeHtml(folder.path)}</option>`).join("");
  folderSelect.value = rule.sourceChromeFolderId || folders[0]?.id || "";

  const collectionSelect = nodes.ruleDetail.querySelector("[data-field='targetRaindropCollectionId']");
  const collectionOptions = sortCollectionsForDisplay(collections);
  collectionSelect.innerHTML = collectionOptions.length
    ? collectionOptions.map((collection) => `<option value="${collection._id}">${escapeHtml(collectionLabel(collection))}</option>`).join("")
    : "<option value=\"0\">先读取 Collections</option>";
  collectionSelect.value = String(rule.targetRaindropCollectionId || collectionOptions[0]?._id || 0);
  renderDirectionControls(rule);
}

function startResetTaskPolling() {
  if (resetTaskTimer) clearInterval(resetTaskTimer);
  pollResetTask();
  resetTaskTimer = setInterval(pollResetTask, 2000);
}

async function pollResetTask() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_RESET_TASK" });
    if (!response?.ok) return;
    const task = response.result;
    renderResetTask(task);
    if (task?.status === "running") {
      await chrome.runtime.sendMessage({ type: "CONTINUE_RESET_TASK", taskId: task.id });
    }
    if (!task || task.status === "completed" || task.status === "completed-with-errors" || task.status === "failed") {
      if (resetTaskTimer) clearInterval(resetTaskTimer);
      resetTaskTimer = null;
      settings = await getSettings();
      renderStatus();
      renderLogs();
    }
  } catch {
    // Keep polling quiet; the next tick may reconnect to the service worker.
  }
}

function renderResetTask(task) {
  if (!task) {
    setButtonLoading(nodes.resetRuleFromChrome, "清空目标并以 Chrome 重建", false);
    renderDirectionControls(selectedRule());
    return;
  }

  const selected = selectedRule();
  if (selected && task.ruleId !== selected.id && task.status === "running") {
    nodes.ruleDetailHint.textContent = `另一条规则正在重建：${task.ruleName}`;
  }

  if (task.status === "running") {
    setButtonLoading(nodes.resetRuleFromChrome, "正在重建", true);
    if (!selected || task.ruleId === selected.id) {
      nodes.ruleDetailHint.textContent = task.message || `已归档 ${task.archived || 0}/${task.total || 0} 条`;
    }
    return;
  }

  setButtonLoading(nodes.resetRuleFromChrome, "清空目标并以 Chrome 重建", false);
  renderDirectionControls(selectedRule());
  if (!selected || task.ruleId === selected.id) {
    nodes.ruleDetailHint.textContent = task.message || "重建任务已结束";
  }
}

function startDedupeTaskPolling() {
  if (dedupeTaskTimer) clearInterval(dedupeTaskTimer);
  pollDedupeTask();
  dedupeTaskTimer = setInterval(pollDedupeTask, 2000);
}

async function pollDedupeTask() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_DEDUPE_TASK" });
    if (!response?.ok) return;
    const task = response.result;
    renderDedupeTask(task);
    if (task?.status === "running") {
      await chrome.runtime.sendMessage({ type: "CONTINUE_DEDUPE_TASK", taskId: task.id });
    }
    if (!task || task.status === "completed" || task.status === "completed-with-errors" || task.status === "failed") {
      if (dedupeTaskTimer) clearInterval(dedupeTaskTimer);
      dedupeTaskTimer = null;
      renderLogs();
    }
  } catch {
    // Keep polling quiet; the next tick may reconnect to the service worker.
  }
}

function renderDedupeTask(task) {
  latestDedupeTask = task || null;
  nodes.dedupeHint.classList.remove("success-text", "warning-text");
  if (!task) {
    setButtonLoading(nodes.dedupeRaindropCollection, "查重并归档重复项", collections.length === 0);
    renderDedupeIdleState();
    return;
  }

  const selectedCollectionId = Number(nodes.dedupeCollection.value);
  const matchesSelection = Number(task.collectionId) === selectedCollectionId;
  if (!matchesSelection) {
    if (task.status === "running") {
      setButtonLoading(nodes.dedupeRaindropCollection, "去重任务运行中", true);
      nodes.dedupeHint.textContent = `正在处理「${task.collectionName || task.collectionId}」，完成后才能启动新的 collection 去重。`;
      nodes.dedupeHint.classList.add("warning-text");
      return;
    }
    renderDedupeIdleState();
    return;
  }

  if (task.status === "running") {
    setButtonLoading(nodes.dedupeRaindropCollection, `去重中 ${task.archived || 0}/${task.itemIds?.length || "..."}`, true);
    nodes.dedupeHint.textContent = task.message || `已归档 ${task.archived || 0} 条`;
    return;
  }

  setButtonLoading(nodes.dedupeRaindropCollection, "查重并归档重复项", collections.length === 0);
  nodes.dedupeHint.textContent = task.message || "去重任务已结束";
  nodes.dedupeHint.classList.add(task.status === "failed" || task.status === "completed-with-errors" ? "warning-text" : "success-text");
}

function collectRuleDetail() {
  const rule = selectedRule();
  if (!rule || nodes.ruleDetail.classList.contains("is-empty")) return;

  const folderId = value(nodes.ruleDetail, "sourceChromeFolderId");
  const collectionId = Number(value(nodes.ruleDetail, "targetRaindropCollectionId"));
  const folder = folders.find((item) => item.id === folderId);
  const collection = collections.find((item) => item._id === collectionId);

  Object.assign(rule, {
    name: value(nodes.ruleDetail, "name") || "未命名规则",
    enabled: checked(nodes.ruleDetail, "enabled"),
    direction: value(nodes.ruleDetail, "direction") || "chrome-to-raindrop",
    conflictPolicy: value(nodes.ruleDetail, "conflictPolicy") || "chrome-wins",
    sourceChromeFolderId: folderId,
    sourceChromeFolderName: folder?.path || rule.sourceChromeFolderName || "",
    targetRaindropCollectionId: collectionId,
    targetRaindropCollectionName: collection?.path || collection?.title || rule.targetRaindropCollectionName || "",
    excludePaths: parseLines(value(nodes.ruleDetail, "excludePaths")),
    domainBlocklist: parseLines(value(nodes.ruleDetail, "domainBlocklist")),
    domainAllowlist: parseLines(value(nodes.ruleDetail, "domainAllowlist")),
    titleBlocklist: parseLines(value(nodes.ruleDetail, "titleBlocklist")),
    urlBlocklist: parseLines(value(nodes.ruleDetail, "urlBlocklist")),
    tags: value(nodes.ruleDetail, "tags").split(",").map((tag) => tag.trim()).filter(Boolean),
    scheduleMinutes: Number(value(nodes.ruleDetail, "scheduleMinutes") || 30),
    deletePolicy: "archive",
    updatedAt: new Date().toISOString()
  });
  normalizeRuleConflictPolicy(rule);
}

function generateBulkRules() {
  const preview = buildBulkPairs();
  let created = 0;
  let skipped = 0;

  for (const [folder, collection] of preview.pairs) {
    if (ruleExists(folder.id, collection._id)) {
      skipped += 1;
      continue;
    }
    const rule = createRule({
      name: lastPathPart(folder.path),
      sourceChromeFolderId: folder.id,
      sourceChromeFolderName: folder.path,
      targetRaindropCollectionId: collection._id,
      targetRaindropCollectionName: collection.path || collection.title,
      direction: "chrome-to-raindrop",
      conflictPolicy: "chrome-wins",
      tags: ["chrome-backup"],
      scheduleMinutes: 30
    });
    settings.rules = [...(settings.rules || []), rule];
    selectedRuleId = rule.id;
    created += 1;
  }

  return {
    total: preview.pairs.length,
    created,
    skipped
  };
}

function buildBulkPairs() {
  const chromeRoot = folders.find((folder) => folder.id === nodes.bulkChromeRoot.value);
  const raindropRoot = collections.find((collection) => String(collection._id) === nodes.bulkRaindropRoot.value);
  if (!chromeRoot || !raindropRoot) {
    return {
      chromeRoot,
      raindropRoot,
      pairs: [],
      reason: "先选择 Chrome 文件夹和 Raindrop Collection。"
    };
  }

  let pairs = [];
  if (nodes.bulkMode.value === "single-pair") {
    pairs = [[chromeRoot, raindropRoot]];
  } else if (nodes.bulkMode.value === "direct-children-to-root") {
    pairs = directChildFolders(chromeRoot).map((folder) => [folder, raindropRoot]);
  } else if (nodes.bulkMode.value === "subtree-to-root") {
    pairs = descendantFolders(chromeRoot).map((folder) => [folder, raindropRoot]);
  } else {
    pairs = matchFoldersToCollectionsByName(chromeRoot);
  }

  return {
    chromeRoot,
    raindropRoot,
    pairs,
    reason: emptyBulkReason(chromeRoot, raindropRoot)
  };
}

async function saveFromForm() {
  collectRuleDetail();
  settings.raindropToken = nodes.token.value.trim();
  settings.oauthClientId = nodes.clientId.value.trim();
  settings.oauthClientSecret = nodes.clientSecret.value.trim();
  settings.oauthRedirectPath = nodes.redirectPath.value.trim();
  settings.officeMode = nodes.officeMode.checked;
  settings.syncPaused = nodes.syncPaused.checked;
  settings.redactLogs = nodes.redactLogs.checked;
  settings.sensitiveFilters = {
    keywords: parseLines(nodes.sensitiveKeywords.value),
    domains: parseLines(nodes.sensitiveDomains.value),
    paths: parseLines(nodes.sensitivePaths.value)
  };
  settings = await saveSettings(settings);
  render();
}

async function persistRulesOnly() {
  settings = await saveSettings(settings);
  renderStatus();
}

let persistRulesTimer = null;

function schedulePersistRules() {
  if (persistRulesTimer) clearTimeout(persistRulesTimer);
  persistRulesTimer = setTimeout(() => {
    persistRulesOnly().catch((error) => {
      nodes.statusLine.textContent = `保存规则失败：${error.message}`;
    });
  }, 350);
}

async function renderLogs() {
  const logs = await getLogs();
  nodes.logs.innerHTML = logs.length ? "" : "<div class=\"empty-state\">暂无日志</div>";
  for (const log of logs.slice(0, 80)) {
    const entry = document.createElement("div");
    entry.className = `log-entry ${log.level || "info"}`;
    entry.textContent = `${formatTime(log.ts)} · ${log.event || log.level} · ${log.message || JSON.stringify(log.summary || log.bookmark || {})}`;
    nodes.logs.append(entry);
  }
}

function directChildFolders(root) {
  if (root.path === "Chrome") {
    return folders.filter((folder) => folder.id !== root.id && !folder.path.includes(" / "));
  }

  const prefix = root.path ? `${root.path} / ` : "";
  return folders.filter((folder) => {
    if (folder.id === root.id || !folder.path.startsWith(prefix)) return false;
    return !folder.path.slice(prefix.length).includes(" / ");
  });
}

function descendantFolders(root) {
  if (root.path === "Chrome") {
    return folders.filter((folder) => folder.id !== root.id);
  }

  const prefix = root.path ? `${root.path} / ` : "";
  return folders.filter((folder) => folder.id !== root.id && folder.path.startsWith(prefix));
}

function directChildCollections(root) {
  const byParentId = collections.filter((collection) => Number(collection.parentId) === Number(root._id));
  if (byParentId.length > 0) return byParentId;

  const rootPath = collectionLabel(root);
  const prefix = `${rootPath} / `;
  return collections.filter((collection) => {
    const path = collectionLabel(collection);
    if (Number(collection._id) === Number(root._id) || !path.startsWith(prefix)) return false;
    return !path.slice(prefix.length).includes(" / ");
  });
}

function descendantCollections(root) {
  const byParent = collections.filter((collection) => isDescendantCollectionByParent(collection, root));
  if (byParent.length > 0) return byParent;

  const rootPath = collectionLabel(root);
  const prefix = `${rootPath} / `;
  return collections.filter((collection) => {
    const path = collectionLabel(collection);
    return Number(collection._id) !== Number(root._id) && path.startsWith(prefix);
  });
}

function matchFoldersToCollectionsByName(chromeRoot) {
  const folderCandidates = descendantFolders(chromeRoot);
  const collectionCandidates = collections;
  const usedCollectionIds = new Set();
  const pairs = [];

  const collectionsByPathSuffix = new Map();
  for (const collection of collectionCandidates) {
    for (const key of collectionPathSuffixKeys(collection)) {
      if (!collectionsByPathSuffix.has(key)) collectionsByPathSuffix.set(key, []);
      collectionsByPathSuffix.get(key).push(collection);
    }
  }

  for (const folder of folderCandidates) {
    const exactMatch = findBestCollectionMatch(folder, collectionsByPathSuffix, usedCollectionIds);
    if (exactMatch) {
      pairs.push([folder, exactMatch]);
      usedCollectionIds.add(Number(exactMatch._id));
    }
  }

  const matchedFolderIds = new Set(pairs.map(([folder]) => folder.id));
  const collectionsByName = new Map();
  for (const collection of collectionCandidates) {
    if (usedCollectionIds.has(Number(collection._id))) continue;
    const key = normalizeName(lastPathPart(collectionLabel(collection)));
    if (!collectionsByName.has(key)) collectionsByName.set(key, []);
    collectionsByName.get(key).push(collection);
  }

  const foldersByName = new Map();
  for (const folder of folderCandidates) {
    if (matchedFolderIds.has(folder.id)) continue;
    const key = normalizeName(lastPathPart(folder.path));
    if (!foldersByName.has(key)) foldersByName.set(key, []);
    foldersByName.get(key).push(folder);
  }

  for (const [key, foldersForName] of foldersByName.entries()) {
    const collectionsForName = collectionsByName.get(key) || [];
    if (foldersForName.length === 1 && collectionsForName.length === 1) {
      pairs.push([foldersForName[0], collectionsForName[0]]);
      usedCollectionIds.add(Number(collectionsForName[0]._id));
    }
  }

  return pairs;
}

function emptyBulkReason(chromeRoot, raindropRoot) {
  if (nodes.bulkMode.value === "children-by-name") {
    const chromeFolders = descendantFolders(chromeRoot);
    const raindropCollections = collections;
    if (chromeFolders.length === 0) return `${chromeRoot.path} 下没有可匹配的子文件夹。`;
    if (raindropCollections.length === 0) return "还没有可匹配的 Raindrop Collection，请先读取 Collections。";
    const chromeNames = chromeFolders.slice(0, 6).map((item) => lastPathPart(item.path)).join("、");
    const raindropNames = raindropCollections.slice(0, 6).map((item) => lastPathPart(collectionLabel(item))).join("、");
    return `没有找到可一一匹配的同名项。Chrome 示例：${chromeNames}；Raindrop 示例：${raindropNames}。同名重复时会保守跳过，请缩小 Chrome 根范围或保持路径后缀一致。`;
  }
  if (nodes.bulkMode.value === "direct-children-to-root") {
    return `${chromeRoot.path} 下没有直接子文件夹。`;
  }
  if (nodes.bulkMode.value === "subtree-to-root") {
    return `${chromeRoot.path} 下没有子文件夹。`;
  }
  return "当前选择没有可生成的规则。";
}

function ruleExists(folderId, collectionId) {
  return (settings.rules || []).some((rule) => (
    rule.sourceChromeFolderId === folderId &&
    Number(rule.targetRaindropCollectionId) === Number(collectionId)
  ));
}

function directionLabel(direction) {
  if (direction === "bidirectional") return "双向";
  if (direction === "raindrop-to-chrome") return "拉取";
  return "推送";
}

function normalizeRuleConflictPolicy(rule) {
  if (!rule) return;
  if (!["chrome-wins", "raindrop-wins", "skip-conflicts"].includes(rule.conflictPolicy)) {
    rule.conflictPolicy = "skip-conflicts";
  }
}

function renderDirectionControls(rule) {
  const conflictSelect = nodes.ruleDetail.querySelector("[data-field='conflictPolicy']");
  const direction = rule?.direction || "chrome-to-raindrop";
  const canResetFromChrome = direction === "chrome-to-raindrop" && Number(rule?.targetRaindropCollectionId) > 0;

  if (conflictSelect) conflictSelect.disabled = false;
  nodes.resetRuleFromChrome.disabled = !canResetFromChrome;
  nodes.resetRuleFromChrome.title = canResetFromChrome
    ? "归档目标 collection 后按 Chrome 当前内容重建。"
    : "仅 Chrome → Raindrop 推送规则支持此操作。";

  if (!nodes.directionHint) return;
  const policyText = conflictPolicyText(rule?.conflictPolicy);
  if (direction === "chrome-to-raindrop") {
    nodes.directionHint.textContent = `推送模式：Chrome 写入 Raindrop；${policyText.push} 保存后点击顶部“立即同步”执行。`;
  } else if (direction === "raindrop-to-chrome") {
    nodes.directionHint.textContent = `拉取模式：Raindrop 写入 Chrome 书签文件夹；${policyText.pull} 保存后点击顶部“立即同步”执行。`;
  } else {
    nodes.directionHint.textContent = `双向模式：Chrome 与 Raindrop 都会读写；${policyText.bidirectional} 保存后点击顶部“立即同步”执行。`;
  }
}

function conflictPolicyText(policy) {
  if (policy === "chrome-wins") {
    return {
      push: "同 URL 已存在时用 Chrome 覆盖 Raindrop。",
      pull: "同 URL 已存在时保留 Chrome，不覆盖本地书签。",
      bidirectional: "同 URL 冲突时以 Chrome 为准。"
    };
  }
  if (policy === "raindrop-wins") {
    return {
      push: "同 URL 已存在时保留 Raindrop，不覆盖云端书签。",
      pull: "同 URL 已存在时用 Raindrop 覆盖 Chrome。",
      bidirectional: "同 URL 冲突时以 Raindrop 为准。"
    };
  }
  return {
    push: "同 URL 已存在时跳过，不覆盖 Raindrop。",
    pull: "同 URL 已存在时跳过，不覆盖 Chrome。",
    bidirectional: "同 URL 冲突时两边都跳过。"
  };
}

function selectedRule() {
  return (settings.rules || []).find((rule) => rule.id === selectedRuleId) || null;
}

function setDetailDisabled(disabled) {
  nodes.ruleDetail.querySelectorAll("input, select, textarea").forEach((input) => {
    input.disabled = disabled;
  });
  nodes.resetRuleFromChrome.disabled = disabled;
}

function clearDetail() {
  nodes.ruleDetail.querySelectorAll("input, textarea").forEach((input) => {
    if (input.type === "checkbox") input.checked = false;
    else input.value = "";
  });
  nodes.ruleDetail.querySelectorAll("select").forEach((select) => {
    select.innerHTML = "";
  });
  if (nodes.directionHint) nodes.directionHint.textContent = "";
}

function setButtonLoading(button, text, loading) {
  button.disabled = loading;
  button.textContent = text;
}

function setInput(scope, field, inputValue) {
  const input = scope.querySelector(`[data-field='${field}']`);
  if (!input) return;
  if (input.type === "checkbox") input.checked = Boolean(inputValue);
  else input.value = inputValue || "";
}

function value(scope, field) {
  return scope.querySelector(`[data-field='${field}']`)?.value || "";
}

function checked(scope, field) {
  return Boolean(scope.querySelector(`[data-field='${field}']`)?.checked);
}

function parseLines(valueText) {
  return String(valueText || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function lines(items) {
  return (items || []).join("\n");
}

function lastPathPart(path) {
  return String(path || "").split(" / ").filter(Boolean).pop() || String(path || "未命名");
}

function relativeFolderPath(folder, root) {
  if (!root?.path || root.path === "Chrome") return folder.path;
  const prefix = `${root.path} / `;
  return folder.path.startsWith(prefix) ? folder.path.slice(prefix.length) : folder.path;
}

function relativeCollectionPath(collection, root) {
  const path = collectionLabel(collection);
  const rootPath = collectionLabel(root);
  const prefix = `${rootPath} / `;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

function normalizePath(path) {
  return String(path || "")
    .split(" / ")
    .map(normalizeName)
    .filter(Boolean)
    .join(" / ");
}

function folderPathSuffixKeys(folder) {
  return pathSuffixKeys(relativeFolderPath(folder, { path: "Chrome" }));
}

function collectionPathSuffixKeys(collection) {
  return pathSuffixKeys(collectionLabel(collection));
}

function findBestCollectionMatch(folder, collectionsByPathSuffix, usedCollectionIds) {
  for (const key of folderPathSuffixKeys(folder)) {
    const available = uniqueCollections(collectionsByPathSuffix.get(key) || [])
      .filter((collection) => !usedCollectionIds.has(Number(collection._id)));
    if (available.length === 1) return available[0];
  }
  return null;
}

function pathSuffixKeys(path) {
  const parts = String(path || "").split(" / ").map(normalizeName).filter(Boolean);
  const keys = [];
  for (let index = 0; index < parts.length; index += 1) {
    keys.push(parts.slice(index).join(" / "));
  }
  return keys;
}

function uniqueCollections(items) {
  const byId = new Map();
  for (const item of items) byId.set(Number(item._id), item);
  return [...byId.values()];
}

function normalizeName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function isDescendantCollectionByParent(collection, root) {
  const rootId = Number(root._id);
  let current = collection;
  const seen = new Set();
  const byId = new Map(collections.map((item) => [Number(item._id), item]));

  while (current?.parentId && !seen.has(Number(current._id))) {
    seen.add(Number(current._id));
    if (Number(current.parentId) === rootId) return true;
    current = byId.get(Number(current.parentId));
  }

  return false;
}

function normalizeCollections(items) {
  const byId = new Map();
  for (const item of items || []) {
    const id = Number(item._id);
    if (!Number.isFinite(id)) continue;
    byId.set(id, {
      ...byId.get(id),
      _id: id,
      title: item.title || "Untitled",
      count: Number(item.count || 0),
      parentId: extractParentId(item),
      path: item.path || ""
    });
  }

  const normalized = [...byId.values()];
  return normalized.map((item) => ({
    ...item,
    path: item.path || collectionPath(item, normalized)
  }));
}

function sortCollectionsForDisplay(items) {
  return [...(items || [])].sort((a, b) => {
    return collectionPath(a, items).localeCompare(collectionPath(b, items), "zh-CN");
  });
}

function collectionLabel(collection, allCollections = collections) {
  return collection.path || collectionPath(collection, allCollections);
}

function collectionPath(collection, allCollections = collections) {
  const byId = new Map((allCollections || []).map((item) => [Number(item._id), item]));
  const parts = [];
  const seen = new Set();
  let current = collection;

  while (current && !seen.has(Number(current._id))) {
    seen.add(Number(current._id));
    parts.unshift(current.title || "Untitled");
    current = current.parentId ? byId.get(Number(current.parentId)) : null;
  }

  return parts.join(" / ");
}

function extractParentId(item) {
  const parent = item.parent || {};
  const id = item.parentId ?? parent.$id ?? parent._id ?? parent.id ?? null;
  const numeric = Number(id);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function collectionShapeSummary(items) {
  const sample = (items || []).slice(0, 5).map((item) => ({
    hasParent: Boolean(item.parent),
    parentKeys: item.parent ? Object.keys(item.parent) : [],
    hasParentId: Boolean(item.parentId),
    hasPath: Boolean(item.path),
    hasChildren: Boolean(item.children?.length)
  }));
  return {
    rawCount: (items || []).length,
    sample
  };
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
