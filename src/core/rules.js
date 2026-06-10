import { DEFAULT_RULE } from "./defaults.js";
import { domainMatches, getHostname, matchesSensitiveFilters } from "./privacy.js";

export const SYNC_DIRECTIONS = new Set([
  "chrome-to-raindrop",
  "raindrop-to-chrome",
  "bidirectional"
]);

const CONFLICT_POLICIES = new Set([
  "chrome-wins",
  "raindrop-wins",
  "skip-conflicts"
]);

export function createRule(patch = {}) {
  const now = new Date().toISOString();
  return {
    ...DEFAULT_RULE,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    ...patch
  };
}

export function normalizeRule(rule) {
  const direction = SYNC_DIRECTIONS.has(rule?.direction) ? rule.direction : DEFAULT_RULE.direction;
  const conflictPolicy = normalizeConflictPolicy(rule?.conflictPolicy || DEFAULT_RULE.conflictPolicy);
  return {
    ...DEFAULT_RULE,
    ...rule,
    direction,
    conflictPolicy
  };
}

export function allowsChromePush(rule) {
  return rule.direction === "chrome-to-raindrop" || rule.direction === "bidirectional";
}

export function allowsRaindropPull(rule) {
  return rule.direction === "raindrop-to-chrome" || rule.direction === "bidirectional";
}

export function evaluateBookmarkAgainstRule(bookmark, rule, settings) {
  const normalized = normalizeRule(rule);
  if (!normalized.enabled) return skip("rule-disabled");

  const sensitive = matchesSensitiveFilters(bookmark, settings);
  if (sensitive.matched) return skip(sensitive.reason, sensitive.value);

  const path = String(bookmark.path || "");
  const excludedPath = (normalized.excludePaths || []).find((item) => pathIncludes(path, item));
  if (excludedPath) return skip("excluded-path", excludedPath);

  const hostname = getHostname(bookmark.url);
  const blockedDomain = (normalized.domainBlocklist || []).find((item) => domainMatches(hostname, item));
  if (blockedDomain) return skip("blocked-domain", blockedDomain);

  if ((normalized.domainAllowlist || []).length > 0) {
    const allowed = normalized.domainAllowlist.some((item) => domainMatches(hostname, item));
    if (!allowed) return skip("not-in-domain-allowlist");
  }

  const title = String(bookmark.title || "").toLowerCase();
  const blockedTitle = (normalized.titleBlocklist || []).find((item) => includesText(title, item));
  if (blockedTitle) return skip("blocked-title", blockedTitle);

  if ((normalized.titleAllowlist || []).length > 0) {
    const allowed = normalized.titleAllowlist.some((item) => includesText(title, item));
    if (!allowed) return skip("not-in-title-allowlist");
  }

  const url = String(bookmark.url || "").toLowerCase();
  const blockedUrl = (normalized.urlBlocklist || []).find((item) => includesText(url, item));
  if (blockedUrl) return skip("blocked-url", blockedUrl);

  if ((normalized.urlAllowlist || []).length > 0) {
    const allowed = normalized.urlAllowlist.some((item) => includesText(url, item));
    if (!allowed) return skip("not-in-url-allowlist");
  }

  return {
    action: "sync",
    rule: normalized
  };
}

export function findRuleForBookmark(bookmark, settings) {
  for (const rule of settings.rules || []) {
    const result = evaluateBookmarkAgainstRule(bookmark, rule, settings);
    if (result.action === "sync") return result;
  }
  return skip("no-matching-rule");
}

export function buildTemplateRule(template, patch = {}) {
  const base = createRule(patch);
  if (template === "work-backup") {
    return {
      ...base,
      name: "工作备份模板",
      direction: "chrome-to-raindrop",
      includeSubtree: true,
      deletePolicy: "archive",
      tags: ["work", "chrome-backup"]
    };
  }
  if (template === "privacy-protection") {
    return {
      ...base,
      name: "隐私保护模板",
      enabled: false,
      excludePaths: ["私人", "个人", "Personal", "Private", "求职"],
      domainBlocklist: ["bank", "health"],
      titleBlocklist: ["简历", "求职", "银行", "医疗", "private"]
    };
  }
  return base;
}

function skip(reason, value = "") {
  return {
    action: "skip",
    reason,
    value
  };
}

function normalizeConflictPolicy(policy) {
  return CONFLICT_POLICIES.has(policy) ? policy : "skip-conflicts";
}

function pathIncludes(path, needle) {
  const normalized = String(needle || "").toLowerCase().trim();
  return normalized && path.toLowerCase().includes(normalized);
}

function includesText(haystack, needle) {
  const normalized = String(needle || "").toLowerCase().trim();
  return normalized && haystack.includes(normalized);
}
