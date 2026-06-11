import { createChromeBookmark, listBookmarksForRule, updateChromeBookmark } from "./chrome-bookmarks.js";
import { redactBookmark } from "./privacy.js";
import { allowsChromePush, allowsRaindropPull, evaluateBookmarkAgainstRule, findRuleForBookmark, normalizeRule } from "./rules.js";
import {
  appendLog,
  getDedupeTask,
  getResetTask,
  getSettings,
  getSyncState,
  saveDedupeTask,
  saveResetTask,
  saveSettings,
  saveSyncState
} from "./storage.js";
import { RaindropApi } from "./raindrop-api.js";
import { ensureAccessToken } from "./raindrop-auth.js";

export async function runSync(trigger = "manual") {
  const settings = await getSettings();
  const state = await getSyncState();
  const summary = {
    created: 0,
    updated: 0,
    archived: 0,
    pulled: 0,
    skipped: 0,
    failed: 0
  };

  if (state.running && !isStaleRunningState(state.runningStartedAt)) {
    summary.skipped += 1;
    summary.alreadyRunning = true;
    await appendLog({
      level: "warn",
      event: "sync-already-running",
      message: "已有同步任务正在运行，本次请求已跳过。",
      trigger,
      summary: {
        runningStartedAt: state.runningStartedAt || ""
      }
    });
    return summary;
  }

  if (settings.syncPaused && !isManualSyncTrigger(trigger)) {
    await appendLog({ level: "info", event: "sync-paused", message: "Sync is paused.", trigger });
    return summary;
  }

  if (!settings.raindropToken) {
    await appendLog({ level: "warn", event: "missing-token", message: "Raindrop token is not configured.", trigger });
    summary.failed += 1;
    return summary;
  }

  const enabledRules = (settings.rules || []).map(normalizeRule).filter((rule) => rule.enabled);
  if (enabledRules.length === 0) {
    await appendLog({ level: "warn", event: "no-rules", message: "No enabled sync rules.", trigger });
    return summary;
  }

  const accessToken = await ensureAccessToken(settings);
  const api = new RaindropApi(accessToken);
  const runId = crypto.randomUUID();
  state.running = true;
  state.lastRunId = runId;
  state.runningStartedAt = new Date().toISOString();
  await saveSyncState(state);

  const visibleBookmarkIds = new Set();
  const claimedChromeBookmarkIds = new Set();
  const context = {
    raindropItemsByCollection: new Map(),
    chromeBookmarksByRule: new Map(),
    chromeBookmarksByIdByRule: new Map()
  };
  state.raindropToBookmark = state.raindropToBookmark || {};
  state.bookmarkToRaindrop = state.bookmarkToRaindrop || {};
  state.knownBookmarks = state.knownBookmarks || {};

  try {
    const orderedRules = orderRulesBySpecificity(enabledRules);
    for (const rule of orderedRules) {
      if (allowsChromePush(rule)) {
        await pushChromeToRaindrop(api, settings, state, rule, visibleBookmarkIds, claimedChromeBookmarkIds, summary, context);
      }

      if (allowsRaindropPull(rule)) {
        await pullRaindropToChrome(api, settings, state, rule, summary, context, visibleBookmarkIds);
      }
    }

    await archiveMissingBookmarks(api, settings, state, visibleBookmarkIds, summary, orderedRules);
  } finally {
    state.running = false;
    state.runningStartedAt = "";
    await saveSyncState(state);
  }

  const nextSettings = {
    ...settings,
    lastSyncAt: new Date().toISOString(),
    lastSyncSummary: summary
  };
  await saveSettings(nextSettings);
  await appendLog({ level: "info", event: "sync-completed", trigger, summary });
  return summary;
}

export async function resetRuleFromChrome(ruleId) {
  const settings = await getSettings();
  const rule = normalizeRule((settings.rules || []).find((item) => item.id === ruleId));
  if (!rule?.id) throw new Error("Rule not found.");
  if (!settings.raindropToken) throw new Error("Raindrop token is not configured.");
  if (!isValidCollectionId(rule.targetRaindropCollectionId)) {
    throw new Error("Rule target Raindrop collection is not configured.");
  }
  if (rule.direction !== "chrome-to-raindrop") {
    throw new Error("Only Chrome -> Raindrop rules can be reset from Chrome.");
  }
  const existingTask = await getResetTask();
  if (existingTask?.status === "running") {
    throw new Error(`Rule reset is already running: ${existingTask.ruleName || existingTask.ruleId}.`);
  }

  const task = {
    id: crypto.randomUUID(),
    ruleId: rule.id,
    ruleName: rule.name,
    collectionId: rule.targetRaindropCollectionId,
    status: "running",
    phase: "listing",
    total: 0,
    archived: 0,
    failed: 0,
    cursor: 0,
    itemIds: [],
    archivedItemIds: [],
    message: "正在读取 Raindrop 项目",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await saveResetTask(task);
  processResetTask(task.id).catch((error) => {
    saveResetTask({
      ...task,
      status: "failed",
      phase: "failed",
      message: error.message,
      updatedAt: new Date().toISOString()
    });
  });
  return task;
}

export async function getRuleResetTask() {
  return getResetTask();
}

export async function dedupeRaindropCollection(collectionId, collectionName = "") {
  const settings = await getSettings();
  if (!settings.raindropToken) throw new Error("Raindrop token is not configured.");
  const existingTask = await getDedupeTask();
  if (existingTask?.status === "running") {
    throw new Error(`Raindrop collection dedupe is already running: ${existingTask.collectionName || existingTask.collectionId}.`);
  }

  const numericCollectionId = Number(collectionId);
  if (!Number.isFinite(numericCollectionId) || numericCollectionId <= 0) {
    throw new Error("Raindrop collection is required.");
  }

  const task = {
    id: crypto.randomUUID(),
    collectionId: numericCollectionId,
    collectionName,
    status: "running",
    phase: "listing",
    total: 0,
    duplicateGroups: 0,
    archived: 0,
    kept: 0,
    failed: 0,
    cursor: 0,
    itemIds: [],
    archivedItemIds: [],
    message: "正在读取 Raindrop Collection",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await saveDedupeTask(task);
  processDedupeTask(task.id).catch((error) => {
    saveDedupeTask({
      ...task,
      status: "failed",
      phase: "failed",
      message: error.message,
      updatedAt: new Date().toISOString()
    });
  });
  return task;
}

export async function getRaindropDedupeTask() {
  return getDedupeTask();
}

let dedupeTaskProcessing = false;

export async function processDedupeTask(taskId = null) {
  if (dedupeTaskProcessing) return getDedupeTask();
  dedupeTaskProcessing = true;
  try {
    return await processDedupeTaskInner(taskId);
  } catch (error) {
    const task = await getDedupeTask();
    if (task && (!taskId || task.id === taskId)) {
      await saveDedupeTask({
        ...task,
        status: "failed",
        phase: "failed",
        message: error.message,
        updatedAt: new Date().toISOString()
      });
    }
    throw error;
  } finally {
    dedupeTaskProcessing = false;
  }
}

let resetTaskProcessing = false;

export async function processResetTask(taskId = null) {
  if (resetTaskProcessing) return getResetTask();
  resetTaskProcessing = true;
  try {
    return await processResetTaskInner(taskId);
  } catch (error) {
    const task = await getResetTask();
    if (task && (!taskId || task.id === taskId)) {
      await saveResetTask({
        ...task,
        status: "failed",
        phase: "failed",
        message: error.message,
        updatedAt: new Date().toISOString()
      });
    }
    throw error;
  } finally {
    resetTaskProcessing = false;
  }
}

async function processResetTaskInner(taskId = null) {
  const settings = await getSettings();
  let task = await getResetTask();
  if (!task || (taskId && task.id !== taskId)) return null;

  const rule = normalizeRule((settings.rules || []).find((item) => item.id === task.ruleId));
  if (!rule?.id) throw new Error("Rule not found.");
  if (!settings.raindropToken) throw new Error("Raindrop token is not configured.");
  if (!isValidCollectionId(rule.targetRaindropCollectionId)) {
    throw new Error("Rule target Raindrop collection is not configured.");
  }

  const state = await getSyncState();
  state.raindropToBookmark = state.raindropToBookmark || {};
  state.bookmarkToRaindrop = state.bookmarkToRaindrop || {};
  state.knownBookmarks = state.knownBookmarks || {};
  task.archivedItemIds = task.archivedItemIds || [];

  const accessToken = await ensureAccessToken(settings);
  const api = new RaindropApi(accessToken);

  if (task.phase === "listing") {
    const items = await api.listRaindrops(rule.targetRaindropCollectionId, {
      sort: "-lastUpdate",
      perpage: 50,
      maxPages: 200
    });
    task = await saveResetTask({
      ...task,
      phase: "archiving",
      total: items.length,
      itemIds: items.map((item) => item._id),
      message: `已读取 ${items.length} 条，开始归档`,
      updatedAt: new Date().toISOString()
    });
  }

  const batchSize = 20;
  const end = Math.min(task.cursor + batchSize, task.itemIds.length);
  for (let index = task.cursor; index < end; index += 1) {
    const itemId = task.itemIds[index];
    try {
      await api.archiveRaindrop(itemId);
      removeRaindropMapping(state, itemId);
      task.archived += 1;
      if (!task.archivedItemIds.includes(itemId)) task.archivedItemIds.push(itemId);
      await delay(350);
    } catch (error) {
      task.failed += 1;
      await appendLog({
        level: "error",
        event: "rule-reset-archive-failed",
        ruleId: rule.id,
        ruleName: rule.name,
        message: error.message
      });
      if (String(error.message || "").includes("429")) {
        await delay(5000);
      }
    }
  }

  await saveSyncState(state);
  task = await saveResetTask({
    ...task,
    cursor: end,
    message: `已归档 ${task.archived}/${task.total} 条`,
    updatedAt: new Date().toISOString()
  });

  if (task.cursor < task.itemIds.length) {
    setTimeout(() => {
      processResetTask(task.id).catch(() => {});
    }, 1000);
    return task;
  }

  task = await saveResetTask({
    ...task,
    phase: "syncing",
    message: "归档完成，正在按 Chrome 重建",
    updatedAt: new Date().toISOString()
  });
  const syncSummary = await runSync("rule-reset-from-chrome");
  task = await saveResetTask({
    ...task,
    status: task.failed > 0 ? "completed-with-errors" : "completed",
    phase: "completed",
    syncSummary,
    message: `完成：归档 ${task.archived} 条，失败 ${task.failed} 条`,
    finishedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  await appendLog({
    level: task.failed > 0 ? "warn" : "info",
    event: "rule-reset-from-chrome",
    ruleId: rule.id,
    ruleName: rule.name,
    summary: {
      archived: task.archived,
      failed: task.failed,
      total: task.total,
      syncSummary
    }
  });
  return task;
}

async function processDedupeTaskInner(taskId = null) {
  const settings = await getSettings();
  let task = await getDedupeTask();
  if (!task || (taskId && task.id !== taskId)) return null;
  if (!settings.raindropToken) throw new Error("Raindrop token is not configured.");

  const state = await getSyncState();
  state.raindropToBookmark = state.raindropToBookmark || {};
  state.bookmarkToRaindrop = state.bookmarkToRaindrop || {};
  state.knownBookmarks = state.knownBookmarks || {};
  task.archivedItemIds = task.archivedItemIds || [];

  const accessToken = await ensureAccessToken(settings);
  const api = new RaindropApi(accessToken);

  if (task.phase === "listing") {
    const items = await api.listRaindrops(task.collectionId, {
      sort: "-lastUpdate",
      perpage: 50,
      maxPages: 200
    });
    const plan = buildDedupePlan(items);
    const message = plan.archiveIds.length === 0
      ? `已读取 ${items.length} 条，未发现重复 URL`
      : `已读取 ${items.length} 条，发现 ${plan.duplicateGroups} 组重复，准备归档 ${plan.archiveIds.length} 条`;
    task = await saveDedupeTask({
      ...task,
      phase: "archiving",
      total: items.length,
      duplicateGroups: plan.duplicateGroups,
      kept: plan.kept,
      itemIds: plan.archiveIds,
      message,
      updatedAt: new Date().toISOString()
    });
  }

  const batchSize = 20;
  const end = Math.min(task.cursor + batchSize, task.itemIds.length);
  for (let index = task.cursor; index < end; index += 1) {
    const itemId = task.itemIds[index];
    try {
      await api.archiveRaindrop(itemId);
      removeRaindropMapping(state, itemId);
      task.archived += 1;
      if (!task.archivedItemIds.includes(itemId)) task.archivedItemIds.push(itemId);
      await delay(350);
    } catch (error) {
      task.failed += 1;
      await appendLog({
        level: "error",
        event: "raindrop-dedupe-archive-failed",
        collectionId: task.collectionId,
        collectionName: task.collectionName,
        message: error.message
      });
      if (String(error.message || "").includes("429")) {
        await delay(5000);
      }
    }
  }

  await saveSyncState(state);
  task = await saveDedupeTask({
    ...task,
    cursor: end,
    message: `已归档 ${task.archived}/${task.itemIds.length} 条重复书签`,
    updatedAt: new Date().toISOString()
  });

  if (task.cursor < task.itemIds.length) {
    setTimeout(() => {
      processDedupeTask(task.id).catch(() => {});
    }, 1000);
    return task;
  }

  if (task.itemIds.length > 0) {
    task = await verifyDedupeArchives(api, task);
  }

  const completedMessage = task.verifyFailed
    ? `${task.message}；请刷新 Raindrop 后重试或检查 token 权限`
    : dedupeCompletedMessage(task);
  task = await saveDedupeTask({
    ...task,
    status: task.failed > 0 ? "completed-with-errors" : "completed",
    phase: "completed",
    message: completedMessage,
    finishedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  await appendLog({
    level: task.failed > 0 ? "warn" : "info",
    event: "raindrop-collection-deduped",
    collectionId: task.collectionId,
    collectionName: task.collectionName,
    summary: {
      total: task.total,
      duplicateGroups: task.duplicateGroups,
      archived: task.archived,
      failed: task.failed,
      kept: task.kept
    }
  });
  return task;
}

async function verifyDedupeArchives(api, task) {
  const attemptedIds = task.archivedItemIds?.length ? task.archivedItemIds : task.itemIds;
  if (attemptedIds.length === 0) return task;

  await delay(1500);
  const remaining = await api.listRaindrops(task.collectionId, {
    sort: "-lastUpdate",
    perpage: 50,
    maxPages: 200
  });
  const remainingIds = new Set(remaining.map((item) => Number(item._id)));
  const stillVisibleIds = attemptedIds.filter((id) => remainingIds.has(Number(id)));
  if (stillVisibleIds.length === 0) return task;

  const archived = Math.max(0, task.archived - stillVisibleIds.length);
  await appendLog({
    level: "warn",
    event: "raindrop-dedupe-verify-failed",
    collectionId: task.collectionId,
    collectionName: task.collectionName,
    message: `${stillVisibleIds.length} duplicate items are still visible in the target collection after archive calls.`,
    summary: {
      stillVisible: stillVisibleIds.length,
      attempted: attemptedIds.length
    }
  });
  return {
    ...task,
    archived,
    failed: task.failed + stillVisibleIds.length,
    verifyFailed: true,
    message: `已请求归档，但仍有 ${stillVisibleIds.length} 条重复书签留在目标 Collection`
  };
}

async function pushChromeToRaindrop(api, settings, state, rule, visibleBookmarkIds, claimedChromeBookmarkIds, summary, context) {
  const bookmarks = await listBookmarksForRule(rule);
  const raindropsByUrl = await getRaindropsByUrl(api, rule.targetRaindropCollectionId, context);
  const currentRuleUrls = new Set();
  for (const bookmark of bookmarks) {
    visibleBookmarkIds.add(bookmark.id);

    if (claimedChromeBookmarkIds.has(bookmark.id)) {
      summary.skipped += 1;
      await appendLog({
        level: "info",
        event: "bookmark-skipped",
        ruleId: rule.id,
        ruleName: rule.name,
        reason: "already-handled-by-more-specific-rule",
        bookmark: redactBookmark(bookmark, settings.redactLogs)
      });
      continue;
    }

    const decision = findRuleForBookmark(bookmark, { ...settings, rules: [rule] });
    if (decision.action !== "sync") {
      summary.skipped += 1;
      await appendLog({
        level: "info",
        event: "bookmark-skipped",
        ruleId: rule.id,
        ruleName: rule.name,
        reason: decision.reason,
        bookmark: redactBookmark(bookmark, settings.redactLogs)
      });
      continue;
    }

    currentRuleUrls.add(normalizeUrl(bookmark.url));
    const mapping = state.bookmarkToRaindrop[bookmark.id];
    try {
      const urlKey = normalizeUrl(bookmark.url);
      const mappedRaindrop = mapping?.raindropId
        ? getCachedRaindropById(context, rule.targetRaindropCollectionId, mapping.raindropId)
        : null;
      const existingRaindrop = mappedRaindrop || raindropsByUrl.get(urlKey);

      if (existingRaindrop?._id) {
        if (shouldSkipChromePushConflict(rule)) {
          summary.skipped += 1;
          claimedChromeBookmarkIds.add(bookmark.id);
          await appendLog({
            level: "info",
            event: "bookmark-push-conflict-skipped",
            ruleId: rule.id,
            ruleName: rule.name,
            reason: rule.conflictPolicy,
            bookmark: redactBookmark(bookmark, settings.redactLogs)
          });
          continue;
        }
        const updated = await api.updateRaindrop(existingRaindrop._id, rule.targetRaindropCollectionId, bookmark, rule.tags);
        const updatedItem = updated.item || {
          ...existingRaindrop,
          _id: existingRaindrop._id,
          link: bookmark.url,
          title: bookmark.title
        };
        upsertMapping(state, bookmark, existingRaindrop._id, rule);
        raindropsByUrl.set(urlKey, updatedItem);
        upsertRaindropCache(context, rule.targetRaindropCollectionId, updatedItem);
        summary.updated += 1;
        await appendLog({
          level: "info",
          event: "bookmark-pushed-updated",
          ruleId: rule.id,
          ruleName: rule.name,
          bookmark: redactBookmark(bookmark, settings.redactLogs)
        });
      } else {
        const created = await api.createRaindrop(rule.targetRaindropCollectionId, bookmark, rule.tags);
        const raindropId = created.item?._id;
        upsertMapping(state, bookmark, raindropId, rule);
        if (created.item) {
          raindropsByUrl.set(urlKey, created.item);
          upsertRaindropCache(context, rule.targetRaindropCollectionId, created.item);
        }
        summary.created += 1;
        await appendLog({
          level: "info",
          event: "bookmark-pushed-created",
          ruleId: rule.id,
          ruleName: rule.name,
          bookmark: redactBookmark(bookmark, settings.redactLogs)
        });
      }
      claimedChromeBookmarkIds.add(bookmark.id);
      state.knownBookmarks[bookmark.id] = {
        ruleId: rule.id,
        url: bookmark.url,
        title: bookmark.title,
        path: bookmark.path,
        lastSeenAt: new Date().toISOString()
      };
    } catch (error) {
      summary.failed += 1;
      await appendLog({
        level: "error",
        event: "bookmark-sync-failed",
        ruleId: rule.id,
        ruleName: rule.name,
        message: error.message,
        bookmark: redactBookmark(bookmark, settings.redactLogs)
      });
    }
  }

  await reconcileRaindropExtras(api, settings, state, rule, raindropsByUrl, currentRuleUrls, summary, context);
}

async function pullRaindropToChrome(api, settings, state, rule, summary, context, visibleBookmarkIds = null) {
  let raindrops = [];
  if (!rule.sourceChromeFolderId) {
    summary.failed += 1;
    await appendLog({
      level: "error",
      event: "raindrop-pull-failed",
      ruleId: rule.id,
      ruleName: rule.name,
      message: "Chrome target folder is not configured."
    });
    return;
  }

  try {
    raindrops = await getRaindropsForCollection(api, rule.targetRaindropCollectionId, context);
  } catch (error) {
    summary.failed += 1;
    await appendLog({
      level: "error",
      event: "raindrop-list-failed",
      ruleId: rule.id,
      ruleName: rule.name,
      message: error.message
    });
    return;
  }

  for (const item of raindrops) {
    const bookmark = raindropToBookmark(item, rule);
    const decision = evaluateBookmarkAgainstRule(bookmark, rule, settings);
    if (decision.action !== "sync") {
      summary.skipped += 1;
      await appendLog({
        level: "info",
        event: "raindrop-skipped",
        ruleId: rule.id,
        ruleName: rule.name,
        reason: decision.reason,
        bookmark: redactBookmark(bookmark, settings.redactLogs)
      });
      continue;
    }

    const raindropId = item._id;
    const mapping = state.raindropToBookmark[raindropId];
    const chromeBookmarksByUrl = await getChromeBookmarksByUrl(rule, context);
    const chromeBookmarksById = await getChromeBookmarksById(rule, context);
    const mappedBookmark = mapping?.bookmarkId && mapping.ruleId === rule.id
      ? chromeBookmarksById.get(String(mapping.bookmarkId))
      : null;
    const existingBookmark = mappedBookmark || chromeBookmarksByUrl.get(normalizeUrl(bookmark.url));

    try {
      if (existingBookmark) {
        if (rule.conflictPolicy === "skip-conflicts") {
          summary.skipped += 1;
          await appendLog({
            level: "info",
            event: "raindrop-pull-conflict-skipped",
            ruleId: rule.id,
            ruleName: rule.name,
            reason: "skip-conflicts",
            bookmark: redactBookmark(bookmark, settings.redactLogs)
          });
          continue;
        }
        if (rule.conflictPolicy === "chrome-wins") {
          summary.skipped += 1;
          await appendLog({
            level: "info",
            event: "raindrop-pull-conflict-skipped",
            ruleId: rule.id,
            ruleName: rule.name,
            reason: "chrome-wins",
            bookmark: redactBookmark(bookmark, settings.redactLogs)
          });
          continue;
        }
        await updateChromeBookmark(existingBookmark.id, bookmark);
        upsertMapping(state, { ...bookmark, id: existingBookmark.id }, raindropId, rule);
        upsertChromeBookmarkCache(context, rule, { ...existingBookmark, ...bookmark, id: existingBookmark.id });
        if (visibleBookmarkIds) visibleBookmarkIds.add(existingBookmark.id);
        summary.updated += 1;
        await appendLog({
          level: "info",
          event: "raindrop-pulled-updated",
          ruleId: rule.id,
          ruleName: rule.name,
          bookmark: redactBookmark({ ...bookmark, id: existingBookmark.id }, settings.redactLogs)
        });
      } else {
        const created = await createChromeBookmark(rule.sourceChromeFolderId, bookmark);
        upsertMapping(state, { ...bookmark, id: created.id }, raindropId, rule);
        upsertChromeBookmarkCache(context, rule, created);
        if (visibleBookmarkIds) visibleBookmarkIds.add(created.id);
        state.knownBookmarks[created.id] = {
          ruleId: rule.id,
          url: bookmark.url,
          title: bookmark.title,
          path: bookmark.path,
          lastSeenAt: new Date().toISOString()
        };
        summary.pulled += 1;
        await appendLog({
          level: "info",
          event: "raindrop-pulled-created",
          ruleId: rule.id,
          ruleName: rule.name,
          bookmark: redactBookmark({ ...bookmark, id: created.id }, settings.redactLogs)
        });
      }
    } catch (error) {
      summary.failed += 1;
      await appendLog({
        level: "error",
        event: "raindrop-pull-failed",
        ruleId: rule.id,
        ruleName: rule.name,
        message: error.message,
        bookmark: redactBookmark(bookmark, settings.redactLogs)
      });
    }
  }
}

function raindropToBookmark(item, rule) {
  return {
    id: String(item._id || ""),
    title: item.title || item.link,
    url: item.link,
    path: rule.targetRaindropCollectionName || "",
    dateAdded: item.created ? Date.parse(item.created) : undefined
  };
}

async function getRaindropsForCollection(api, collectionId, context) {
  const key = String(collectionId);
  if (!context.raindropItemsByCollection.has(key)) {
    const items = await api.listRaindrops(collectionId, {
      sort: "-lastUpdate",
      perpage: 50,
      maxPages: 200
    });
    context.raindropItemsByCollection.set(key, items);
  }
  return context.raindropItemsByCollection.get(key);
}

function upsertRaindropCache(context, collectionId, item) {
  const key = String(collectionId);
  if (!item?._id || !context.raindropItemsByCollection.has(key)) return;

  const items = context.raindropItemsByCollection.get(key);
  const index = items.findIndex((existing) => Number(existing._id) === Number(item._id));
  if (index >= 0) {
    items[index] = { ...items[index], ...item };
  } else {
    items.unshift(item);
  }
}

function getCachedRaindropById(context, collectionId, raindropId) {
  const key = String(collectionId);
  const items = context.raindropItemsByCollection?.get(key) || [];
  return items.find((item) => Number(item._id) === Number(raindropId)) || null;
}

function removeRaindropCache(context, collectionId, raindropId) {
  const key = String(collectionId);
  if (!context.raindropItemsByCollection.has(key)) return;

  const items = context.raindropItemsByCollection.get(key);
  context.raindropItemsByCollection.set(
    key,
    items.filter((item) => Number(item._id) !== Number(raindropId))
  );
}

async function reconcileRaindropExtras(api, settings, state, rule, raindropsByUrl, currentRuleUrls, summary, context) {
  if (rule.direction !== "chrome-to-raindrop") return;
  if ((rule.deletePolicy || "archive") !== "archive") return;

  for (const item of raindropsByUrl.values()) {
    const itemUrl = normalizeUrl(item.link);
    if (!itemUrl || currentRuleUrls.has(itemUrl)) continue;
    if (!isManagedRaindropItem(item, rule, state)) continue;

    try {
      await api.archiveRaindrop(item._id);
      summary.archived += 1;
      removeRaindropMapping(state, item._id);
      removeRaindropCache(context, rule.targetRaindropCollectionId, item._id);
      await appendLog({
        level: "info",
        event: "raindrop-extra-archived",
        ruleId: rule.id,
        ruleName: rule.name,
        message: "Archived managed Raindrop item missing from Chrome rule scope.",
        bookmark: settings.redactLogs
          ? { id: String(item._id), title: "[title redacted]", url: "[url redacted]" }
          : { id: String(item._id), title: item.title, url: item.link }
      });
    } catch (error) {
      summary.failed += 1;
      await appendLog({
        level: "error",
        event: "raindrop-extra-archive-failed",
        ruleId: rule.id,
        ruleName: rule.name,
        message: error.message
      });
    }
  }
}

function isManagedRaindropItem(item, rule, state) {
  const mapping = state.raindropToBookmark?.[item._id];
  if (mapping?.ruleId === rule.id) return true;
  const itemTags = new Set((item.tags || []).map((tag) => String(tag).toLowerCase()));
  return (rule.tags || []).some((tag) => itemTags.has(String(tag).toLowerCase()));
}

function removeRaindropMapping(state, raindropId) {
  const mapping = state.raindropToBookmark?.[raindropId];
  if (mapping?.bookmarkId) {
    delete state.bookmarkToRaindrop[mapping.bookmarkId];
    delete state.knownBookmarks[mapping.bookmarkId];
  }
  if (state.raindropToBookmark) delete state.raindropToBookmark[raindropId];
}

async function getRaindropsByUrl(api, collectionId, context) {
  const items = await getRaindropsForCollection(api, collectionId, context);
  const byUrl = new Map();
  for (const item of items) {
    const key = normalizeUrl(item.link);
    if (key && !byUrl.has(key)) byUrl.set(key, item);
  }
  return byUrl;
}

async function getChromeBookmarksByUrl(rule, context) {
  context.chromeBookmarksByRule = context.chromeBookmarksByRule || new Map();
  const key = rule.id;
  if (!context.chromeBookmarksByRule.has(key)) {
    const bookmarks = await listBookmarksForRule(rule);
    const byUrl = new Map();
    for (const bookmark of bookmarks) {
      const urlKey = normalizeUrl(bookmark.url);
      if (urlKey && !byUrl.has(urlKey)) byUrl.set(urlKey, bookmark);
    }
    context.chromeBookmarksByRule.set(key, byUrl);
  }
  return context.chromeBookmarksByRule.get(key);
}

async function getChromeBookmarksById(rule, context) {
  context.chromeBookmarksByIdByRule = context.chromeBookmarksByIdByRule || new Map();
  const key = rule.id;
  if (!context.chromeBookmarksByIdByRule.has(key)) {
    const bookmarks = await listBookmarksForRule(rule);
    const byId = new Map();
    for (const bookmark of bookmarks) {
      if (bookmark.id) byId.set(String(bookmark.id), bookmark);
    }
    context.chromeBookmarksByIdByRule.set(key, byId);
  }
  return context.chromeBookmarksByIdByRule.get(key);
}

function upsertChromeBookmarkCache(context, rule, bookmark) {
  if (!bookmark?.id) return;
  context.chromeBookmarksByRule = context.chromeBookmarksByRule || new Map();
  context.chromeBookmarksByIdByRule = context.chromeBookmarksByIdByRule || new Map();

  const idKey = rule.id;
  if (context.chromeBookmarksByIdByRule.has(idKey)) {
    context.chromeBookmarksByIdByRule.get(idKey).set(String(bookmark.id), bookmark);
  }

  const urlKey = normalizeUrl(bookmark.url);
  if (urlKey && context.chromeBookmarksByRule.has(idKey)) {
    context.chromeBookmarksByRule.get(idKey).set(urlKey, bookmark);
  }
}

function upsertMapping(state, bookmark, raindropId, rule) {
  if (!bookmark?.id || !raindropId) return;
  const now = new Date().toISOString();
  const bookmarkId = String(bookmark.id);
  const itemId = String(raindropId);
  const previousForBookmark = state.bookmarkToRaindrop[bookmarkId]?.raindropId;
  if (previousForBookmark && String(previousForBookmark) !== itemId) {
    delete state.raindropToBookmark[previousForBookmark];
  }

  const previousForRaindrop = state.raindropToBookmark[itemId]?.bookmarkId;
  if (previousForRaindrop && String(previousForRaindrop) !== bookmarkId) {
    delete state.bookmarkToRaindrop[previousForRaindrop];
    if (state.knownBookmarks) delete state.knownBookmarks[previousForRaindrop];
  }

  state.bookmarkToRaindrop[bookmark.id] = {
    raindropId,
    ruleId: rule.id,
    url: bookmark.url,
    title: bookmark.title,
    lastSyncedAt: now
  };
  state.raindropToBookmark[raindropId] = {
    bookmarkId: bookmark.id,
    ruleId: rule.id,
    lastSyncedAt: now
  };
}

function orderRulesBySpecificity(rules) {
  return [...rules].sort((a, b) => {
    return pathDepth(b.sourceChromeFolderName) - pathDepth(a.sourceChromeFolderName);
  });
}

function pathDepth(path) {
  return String(path || "").split(" / ").filter(Boolean).length;
}

function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    if ((parsed.protocol === "https:" && parsed.port === "443") || (parsed.protocol === "http:" && parsed.port === "80")) {
      parsed.port = "";
    }
    return parsed.toString();
  } catch {
    return String(url || "").trim();
  }
}

function buildDedupePlan(items) {
  const byUrl = new Map();
  for (const item of items || []) {
    const key = normalizeUrl(item.link);
    if (!key) continue;
    if (!byUrl.has(key)) byUrl.set(key, []);
    byUrl.get(key).push(item);
  }

  const archiveIds = [];
  let duplicateGroups = 0;
  let kept = 0;
  for (const group of byUrl.values()) {
    if (group.length < 2) continue;
    duplicateGroups += 1;
    const ordered = [...group].sort(compareRaindropsByFreshness);
    kept += 1;
    archiveIds.push(...ordered.slice(1).map((item) => item._id).filter(Boolean));
  }

  return {
    archiveIds,
    duplicateGroups,
    kept
  };
}

function shouldSkipChromePushConflict(rule) {
  return rule.conflictPolicy === "raindrop-wins" || rule.conflictPolicy === "skip-conflicts";
}

function compareRaindropsByFreshness(a, b) {
  const bTime = raindropFreshness(b);
  const aTime = raindropFreshness(a);
  if (bTime !== aTime) return bTime - aTime;
  return Number(b._id || 0) - Number(a._id || 0);
}

function raindropFreshness(item) {
  return Date.parse(item.lastUpdate || item.updated || item.created || "") || 0;
}

function dedupeCompletedMessage(task) {
  if ((task.itemIds || []).length === 0) {
    return `去重完成：扫描 ${task.total} 条，未发现重复 URL`;
  }
  return `去重完成：归档 ${task.archived} 条，失败 ${task.failed} 条，重复组保留 ${task.kept} 条`;
}

function isValidCollectionId(collectionId) {
  const id = Number(collectionId);
  return Number.isFinite(id) && id > 0;
}

function isStaleRunningState(startedAt) {
  const started = Date.parse(startedAt || "");
  return !started || Date.now() - started > 30 * 60 * 1000;
}

function isManualSyncTrigger(trigger) {
  return trigger === "manual" || trigger === "rule-reset-from-chrome";
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function archiveMissingBookmarks(api, settings, state, visibleBookmarkIds, summary, enabledRules) {
  const pushRuleIds = new Set(enabledRules.filter(allowsChromePush).map((rule) => rule.id));
  const knownEntries = Object.entries(state.knownBookmarks || {});
  for (const [bookmarkId, known] of knownEntries) {
    if (visibleBookmarkIds.has(bookmarkId)) continue;
    if (!pushRuleIds.has(known.ruleId)) continue;

    const mapping = state.bookmarkToRaindrop[bookmarkId];
    if (!mapping?.raindropId) continue;

    const rule = (settings.rules || []).find((item) => item.id === known.ruleId);
    const deletePolicy = rule?.deletePolicy || settings.deletePolicy?.mode || "archive";
    if (deletePolicy !== "archive") {
      summary.skipped += 1;
      continue;
    }

    try {
      await api.archiveRaindrop(mapping.raindropId);
      summary.archived += 1;
      delete state.knownBookmarks[bookmarkId];
      await appendLog({
        level: "info",
        event: "bookmark-archived",
        ruleId: known.ruleId,
        bookmark: settings.redactLogs
          ? { id: bookmarkId, title: "[title redacted]", url: "[url redacted]", path: "[path redacted]" }
          : { id: bookmarkId, title: known.title, url: known.url, path: known.path }
      });
      delete state.bookmarkToRaindrop[bookmarkId];
      if (mapping.raindropId) delete state.raindropToBookmark[mapping.raindropId];
    } catch (error) {
      summary.failed += 1;
      await appendLog({
        level: "error",
        event: "bookmark-archive-failed",
        ruleId: known.ruleId,
        message: error.message
      });
    }
  }
}
