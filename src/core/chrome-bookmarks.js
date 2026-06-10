export async function getBookmarkTree() {
  return chrome.bookmarks.getTree();
}

export async function getSubtree(folderId) {
  if (!folderId) return [];
  try {
    return await chrome.bookmarks.getSubTree(folderId);
  } catch {
    return [];
  }
}

export async function listBookmarkFolders() {
  const tree = await getBookmarkTree();
  const folders = [];
  walk(tree, [], (node, path) => {
    if (!node.url) {
      folders.push({
        id: node.id,
        title: node.title || "Chrome",
        path: path.join(" / ") || "Chrome"
      });
    }
  });
  return folders;
}

export async function listBookmarksForRule(rule) {
  const subtree = await getSubtree(rule.sourceChromeFolderId);
  const bookmarks = [];
  walk(subtree, [], (node, path) => {
    if (node.url) {
      bookmarks.push({
        id: node.id,
        title: node.title || node.url,
        url: node.url,
        parentId: node.parentId,
        dateAdded: node.dateAdded,
        path: path.join(" / ")
      });
    }
  });
  return bookmarks;
}

export async function createChromeBookmark(parentId, bookmark) {
  return chrome.bookmarks.create({
    parentId,
    title: bookmark.title || bookmark.url,
    url: bookmark.url
  });
}

export async function updateChromeBookmark(bookmarkId, bookmark) {
  return chrome.bookmarks.update(bookmarkId, {
    title: bookmark.title || bookmark.url,
    url: bookmark.url
  });
}

export async function getChromeBookmark(bookmarkId) {
  try {
    const results = await chrome.bookmarks.get(bookmarkId);
    return results[0] || null;
  } catch {
    return null;
  }
}

export function flattenBookmarkTree(tree) {
  const bookmarks = [];
  walk(tree, [], (node, path) => {
    if (node.url) {
      bookmarks.push({
        id: node.id,
        title: node.title || node.url,
        url: node.url,
        parentId: node.parentId,
        dateAdded: node.dateAdded,
        path: path.join(" / ")
      });
    }
  });
  return bookmarks;
}

function walk(nodes, path, visit) {
  for (const node of nodes || []) {
    const nextPath = node.title ? [...path, node.title] : path;
    visit(node, nextPath);
    if (node.children) walk(node.children, nextPath, visit);
  }
}
