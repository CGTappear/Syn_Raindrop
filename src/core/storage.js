import { DEFAULT_SETTINGS, LOG_LIMIT } from "./defaults.js";

const SETTINGS_KEY = "settings";
const STATE_KEY = "syncState";
const LOGS_KEY = "syncLogs";
const RESET_TASK_KEY = "resetTask";
const DEDUPE_TASK_KEY = "dedupeTask";

export async function getSettings() {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  return mergeDefaults(result[SETTINGS_KEY] || {});
}

export async function saveSettings(settings) {
  const next = mergeDefaults(settings);
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export async function updateSettings(patch) {
  const current = await getSettings();
  return saveSettings(deepMerge(current, patch));
}

export async function getSyncState() {
  const result = await chrome.storage.local.get(STATE_KEY);
  return result[STATE_KEY] || {
    running: false,
    knownBookmarks: {},
    bookmarkToRaindrop: {},
    lastRunId: ""
  };
}

export async function saveSyncState(state) {
  await chrome.storage.local.set({ [STATE_KEY]: state });
  return state;
}

export async function getLogs() {
  const result = await chrome.storage.local.get(LOGS_KEY);
  return result[LOGS_KEY] || [];
}

export async function appendLog(entry) {
  const logs = await getLogs();
  const next = [
    {
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      level: "info",
      ...entry
    },
    ...logs
  ].slice(0, LOG_LIMIT);
  await chrome.storage.local.set({ [LOGS_KEY]: next });
  return next;
}

export async function clearLogs() {
  await chrome.storage.local.set({ [LOGS_KEY]: [] });
}

export async function getResetTask() {
  const result = await chrome.storage.local.get(RESET_TASK_KEY);
  return result[RESET_TASK_KEY] || null;
}

export async function saveResetTask(task) {
  await chrome.storage.local.set({ [RESET_TASK_KEY]: task });
  return task;
}

export async function clearResetTask() {
  await chrome.storage.local.remove(RESET_TASK_KEY);
}

export async function getDedupeTask() {
  const result = await chrome.storage.local.get(DEDUPE_TASK_KEY);
  return result[DEDUPE_TASK_KEY] || null;
}

export async function saveDedupeTask(task) {
  await chrome.storage.local.set({ [DEDUPE_TASK_KEY]: task });
  return task;
}

export async function clearDedupeTask() {
  await chrome.storage.local.remove(DEDUPE_TASK_KEY);
}

function mergeDefaults(settings) {
  return deepMerge(DEFAULT_SETTINGS, settings);
}

function deepMerge(base, patch) {
  if (!isObject(base) || !isObject(patch)) {
    return patch === undefined ? base : patch;
  }

  const output = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (Array.isArray(value)) {
      output[key] = value;
    } else if (isObject(value)) {
      output[key] = deepMerge(base[key] || {}, value);
    } else if (value !== undefined) {
      output[key] = value;
    }
  }
  return output;
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}
