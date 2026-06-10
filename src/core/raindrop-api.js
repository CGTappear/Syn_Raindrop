const API_BASE = "https://api.raindrop.io/rest/v1";

export class RaindropApi {
  constructor(token) {
    this.token = token;
  }

  isConfigured() {
    return Boolean(this.token);
  }

  async getUser() {
    return this.request("/user");
  }

  async listCollections() {
    const [root, child] = await Promise.all([
      this.request("/collections"),
      this.request("/collections/childrens")
    ]);
    return [
      ...flattenCollections(root.items || []),
      ...flattenCollections(child.items || [])
    ];
  }

  async listRaindrops(collectionId, options = {}) {
    const perpage = options.perpage || 50;
    const maxPages = options.maxPages || 200;
    const items = [];

    for (let page = 0; page < maxPages; page += 1) {
      const params = new URLSearchParams({
        page: String(page),
        perpage: String(perpage)
      });
      if (options.search) params.set("search", options.search);
      if (options.sort) params.set("sort", options.sort);

      const payload = await this.request(`/raindrops/${Number(collectionId)}?${params.toString()}`);
      items.push(...(payload.items || []));
      if (!payload.items || payload.items.length < perpage) break;
    }

    return items;
  }

  async createRaindrop(collectionId, bookmark, tags = []) {
    return this.request("/raindrop", {
      method: "POST",
      body: {
        link: bookmark.url,
        title: bookmark.title,
        collection: { $id: Number(collectionId) },
        tags,
        pleaseParse: {}
      }
    });
  }

  async updateRaindrop(raindropId, collectionId, bookmark, tags = []) {
    return this.request(`/raindrop/${raindropId}`, {
      method: "PUT",
      body: {
        link: bookmark.url,
        title: bookmark.title,
        collection: { $id: Number(collectionId) },
        tags
      }
    });
  }

  async archiveRaindrop(raindropId) {
    return this.request(`/raindrop/${raindropId}`, {
      method: "DELETE"
    });
  }

  async request(path, options = {}) {
    if (!this.token) {
      throw new Error("Raindrop token is missing.");
    }

    const response = await fetch(`${API_BASE}${path}`, {
      method: options.method || "GET",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json"
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 429 && (options.retries ?? 3) > 0) {
        const retryAfter = Number(response.headers.get("Retry-After") || 0);
        const delayMs = retryAfter > 0 ? retryAfter * 1000 : 2500;
        await delay(delayMs);
        return this.request(path, {
          ...options,
          retries: (options.retries ?? 3) - 1
        });
      }
      const message = payload.errorMessage || payload.message || `Raindrop API ${response.status}`;
      throw new Error(message);
    }
    if (payload?.result === false) {
      const message = payload.errorMessage || payload.message || payload.error || "Raindrop API request failed.";
      throw new Error(message);
    }
    return payload;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function flattenCollections(items, parentId = null) {
  const output = [];
  for (const item of items || []) {
    const normalized = {
      ...item,
      parentId: item.parentId || item.parent?.$id || parentId
    };
    output.push(normalized);
    if (item.children?.length) {
      output.push(...flattenCollections(item.children, item._id));
    }
  }
  return output;
}
