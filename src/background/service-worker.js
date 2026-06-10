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
    runSync("alarm").catch((error) => {
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
  if (message?.type === "RUN_SYNC") return runSync("manual");
  if (message?.type === "RESET_RULE_FROM_CHROME") return resetRuleFromChrome(message.ruleId);
  if (message?.type === "GET_RESET_TASK") return getRuleResetTask();
  if (message?.type === "CONTINUE_RESET_TASK") return processResetTask(message.taskId);
  if (message?.type === "DEDUPE_RAINDROP_COLLECTION") return dedupeRaindropCollection(message.collectionId, message.collectionName);
  if (message?.type === "GET_DEDUPE_TASK") return getRaindropDedupeTask();
  if (message?.type === "CONTINUE_DEDUPE_TASK") return processDedupeTask(message.taskId);
  if (message?.type === "CONNECT_RAINDROP") return connectRaindrop();
  if (message?.type === "DISCONNECT_RAINDROP") return disconnectRaindrop();
  if (message?.type === "PAUSE_SYNC") return updateSettings({ syncPaused: true });
  if (message?.type === "RESUME_SYNC") {
    const settings = await updateSettings({ syncPaused: false });
    await ensureAlarm();
    return settings;
  }
  return null;
}

let syncTimer = null;

function queueSync(trigger) {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    runSync(trigger).catch((error) => {
      console.error("Bookmark-triggered sync failed", error);
    });
  }, 2000);
}

async function ensureAlarm() {
  const settings = await getSettings();
  const enabledRules = (settings.rules || []).filter((rule) => rule.enabled);
  const minutes = Math.max(5, Math.min(...enabledRules.map((rule) => rule.scheduleMinutes || 30), 30));
  await chrome.alarms.clear(SYNC_ALARM);
  await chrome.alarms.create(SYNC_ALARM, { periodInMinutes: minutes });
}
