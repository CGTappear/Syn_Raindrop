export function redactValue(value, enabled = true) {
  if (!enabled || !value) return value || "";
  if (typeof value !== "string") return "[redacted]";
  if (value.length <= 8) return "[redacted]";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function redactBookmark(bookmark, enabled = true) {
  if (!enabled) return bookmark;
  return {
    id: bookmark.id,
    title: bookmark.title ? "[title redacted]" : "",
    url: bookmark.url ? redactUrl(bookmark.url) : "",
    path: bookmark.path ? "[path redacted]" : ""
  };
}

export function redactUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.hostname}/...`;
  } catch {
    return "[url redacted]";
  }
}

export function matchesSensitiveFilters(bookmark, settings) {
  const filters = settings.sensitiveFilters || {};
  const haystacks = [
    bookmark.title || "",
    bookmark.url || "",
    bookmark.path || ""
  ].map((item) => item.toLowerCase());

  const keyword = findMatch(filters.keywords, haystacks);
  if (keyword) return { matched: true, reason: "sensitive-keyword", value: keyword };

  const path = findMatch(filters.paths, [String(bookmark.path || "").toLowerCase()]);
  if (path) return { matched: true, reason: "sensitive-path", value: path };

  const hostname = getHostname(bookmark.url);
  const domain = (filters.domains || []).find((item) => domainMatches(hostname, item));
  if (domain) return { matched: true, reason: "sensitive-domain", value: domain };

  return { matched: false };
}

export function getHostname(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function domainMatches(hostname, rule) {
  const normalized = String(rule || "").toLowerCase().trim();
  if (!normalized || !hostname) return false;
  return hostname === normalized || hostname.endsWith(`.${normalized}`);
}

function findMatch(needles = [], haystacks = []) {
  return needles.find((needle) => {
    const normalized = String(needle || "").toLowerCase().trim();
    return normalized && haystacks.some((haystack) => haystack.includes(normalized));
  });
}
