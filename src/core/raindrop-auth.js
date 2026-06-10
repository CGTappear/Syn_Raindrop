import { getSettings, saveSettings } from "./storage.js";

const AUTHORIZE_URL = "https://raindrop.io/oauth/authorize";
const TOKEN_URL = "https://raindrop.io/oauth/access_token";
const EXPIRY_SKEW_MS = 60 * 1000;

export function getRedirectUri(settings) {
  const path = settings.oauthRedirectPath === "" ? undefined : settings.oauthRedirectPath || "raindrop";
  return chrome.identity.getRedirectURL(path);
}

export async function connectRaindrop() {
  const settings = await getSettings();
  assertOAuthConfigured(settings);

  const redirectUri = getRedirectUri(settings);
  const state = crypto.randomUUID();
  const authUrl = new URL(AUTHORIZE_URL);
  authUrl.searchParams.set("client_id", settings.oauthClientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("state", state);

  const responseUrl = await chrome.identity.launchWebAuthFlow({
    url: authUrl.toString(),
    interactive: true
  });

  if (!responseUrl) {
    throw new Error("Raindrop authorization was cancelled.");
  }

  const callbackUrl = new URL(responseUrl);
  const returnedState = callbackUrl.searchParams.get("state");
  if (returnedState !== state) {
    throw new Error("OAuth state mismatch.");
  }

  const error = callbackUrl.searchParams.get("error");
  if (error) {
    throw new Error(callbackUrl.searchParams.get("error_description") || error);
  }

  const code = callbackUrl.searchParams.get("code");
  if (!code) {
    throw new Error("OAuth authorization code is missing.");
  }

  const token = await exchangeToken({
    grant_type: "authorization_code",
    code,
    client_id: settings.oauthClientId,
    client_secret: settings.oauthClientSecret,
    redirect_uri: redirectUri
  });

  const next = await saveToken(settings, token);
  return {
    connected: true,
    redirectUri,
    expiresAt: next.raindropTokenExpiresAt
  };
}

export async function disconnectRaindrop() {
  const settings = await getSettings();
  await saveSettings({
    ...settings,
    raindropToken: "",
    raindropRefreshToken: "",
    raindropTokenExpiresAt: "",
    raindropUser: null
  });
  return { connected: false };
}

export async function ensureAccessToken(settings = null) {
  const current = settings || await getSettings();
  if (!current.raindropToken) return "";
  if (!current.raindropRefreshToken) return current.raindropToken;

  const expiresAt = current.raindropTokenExpiresAt ? Date.parse(current.raindropTokenExpiresAt) : 0;
  if (expiresAt && expiresAt - Date.now() > EXPIRY_SKEW_MS) {
    return current.raindropToken;
  }

  assertOAuthConfigured(current);
  const token = await exchangeToken({
    grant_type: "refresh_token",
    refresh_token: current.raindropRefreshToken,
    client_id: current.oauthClientId,
    client_secret: current.oauthClientSecret
  });

  const next = await saveToken(current, token);
  return next.raindropToken;
}

async function exchangeToken(params) {
  const body = {};
  for (const [key, value] of Object.entries(params)) {
    if (value) body[key] = value;
  }

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error_description || payload.error || `OAuth token request failed: ${response.status}`);
  }

  if (!payload.access_token) {
    throw new Error("OAuth response did not include an access token.");
  }

  return payload;
}

async function saveToken(settings, token) {
  const expiresIn = Number(token.expires_in || 0);
  const expiresAt = expiresIn
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : settings.raindropTokenExpiresAt || "";

  return saveSettings({
    ...settings,
    raindropToken: token.access_token,
    raindropRefreshToken: token.refresh_token || settings.raindropRefreshToken || "",
    raindropTokenExpiresAt: expiresAt
  });
}

function assertOAuthConfigured(settings) {
  if (!settings.oauthClientId || !settings.oauthClientSecret) {
    throw new Error("Raindrop OAuth client id and client secret are required.");
  }
}
