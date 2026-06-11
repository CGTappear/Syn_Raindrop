import {
  dedupeRaindropCollection,
  getRaindropDedupeTask,
  getRuleResetTask,
  processDedupeTask,
  processResetTask,
  resetRuleFromChrome,
  runSync
} from "../core/sync-engine.js";
import { getSettings, updateSettings } from "../core/storage.js";
import { connectRaindrop, disconnectRaindrop } from "../core/raindrop-auth.js";

const SYNC_ALARM = "privacy-sync";

chrome.runtime.onInstalled.addListener(async () => {
  await ensureAlarm();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureAlarm();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM) {
    runBackgroundSync("alarm").catch((error) => {
      console.error("Scheduled sync failed", error);
    });
  }
});

chrome.bookmarks.onCreated.addListener(() => queueSync("bookmark-created"));
chrome.bookmarks.onChanged.addListener(() => queueSync("bookmark-changed"));
chrome.bookmarks.onMoved.addListener(() => queueSync("bookmark-moved"));
chrome.bookmarks.onRemoved.addListener(() => queueSync("bookmark-removed"));

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function handleMessage(message) {
  if (message?.type === "RUN_SYNC") return runManualSync();
  if (message?.type === "RESET_RULE_FROM_CHROME") return resetRuleFromChrome(message.ruleId);
  if (message?.type === "GET_RESET_TASK") return getRuleResetTask();
  if (message?.type === "CONTINUE_RESET_TASK") return processResetTask(message.taskId);
  if (message?.type === "DEDUPE_RAINDROP_COLLECTION") return dedupeRaindropCollection(message.collectionId, message.collectionName);
  if (message?.type === "GET_DEDUPE_TASK") return getRaindropDedupeTask();
  if (message?.type === "CONTINUE_DEDUPE_TASK") return processDedupeTask(message.taskId);
  if (message?.type === "CONNECT_RAINDROP") return connectRaindrop();
  if (message?.type === "DISCONNECT_RAINDROP") return disconnectRaindrop();
  if (message?.type === "SET_SYNC_INTERVAL") {
    const minutes = normalizeSyncInterval(message.minutes);
    const settings = await updateSettings({ syncIntervalMinutes: minutes });
    await ensureAlarm();
    return settings;
  }
  if (message?.type === "PAUSE_SYNC") {
    const settings = await updateSettings({ syncPaused: true });
    await ensureAlarm();
    return settings;
  }
  if (message?.type === "RESUME_SYNC") {
    const settings = await updateSettings({ syncPaused: false });
    await ensureAlarm();
    return settings;
  }
  return null;
}

let syncTimer = null;
let activeSyncPromise = null;
let manualSyncPromise = null;

function queueSync(trigger) {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    runBackgroundSync(trigger).catch((error) => {
      console.error("Bookmark-triggered sync failed", error);
    });
  }, 2000);
}

async function runManualSync() {
  if (manualSyncPromise) return manualSyncPromise;
  manualSyncPromise = runManualSyncNow();
  try {
    return await manualSyncPromise;
  } finally {
    manualSyncPromise = null;
  }
}

async function runManualSyncNow() {
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }
  if (activeSyncPromise) {
    await activeSyncPromise.catch(() => null);
  }
  return runTrackedSync("manual", { forceUnlock: true });
}

async function runBackgroundSync(trigger) {
  if (activeSyncPromise) {
    return {
      created: 0,
      updated: 0,
      archived: 0,
      pulled: 0,
      skipped: 1,
      failed: 0,
      alreadyRunning: true
    };
  }
  return runTrackedSync(trigger);
}

async function runTrackedSync(trigger, options = {}) {
  const promise = runSync(trigger, options);
  activeSyncPromise = promise;
  try {
    return await promise;
  } finally {
    if (activeSyncPromise === promise) {
      activeSyncPromise = null;
    }
  }
}

async function ensureAlarm() {
  const settings = await getSettings();
  await chrome.alarms.clear(SYNC_ALARM);
  if (settings.syncPaused) return;
  const enabledRules = (settings.rules || []).filter((rule) => rule.enabled);
  if (enabledRules.length === 0) return;
  const minutes = normalizeSyncInterval(settings.syncIntervalMinutes);
  await chrome.alarms.create(SYNC_ALARM, { periodInMinutes: minutes });
}

function normalizeSyncInterval(minutes) {
  const numeric = Number(minutes || 30);
  if (!Number.isFinite(numeric)) return 30;
  return Math.max(1, Math.min(Math.round(numeric), 1440));
}
