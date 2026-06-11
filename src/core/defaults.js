export const APP_VERSION = "0.2.0";

export const DEFAULT_SETTINGS = {
  appVersion: APP_VERSION,
  officeMode: true,
  locked: false,
  lockPinHash: "",
  syncPaused: false,
  syncIntervalMinutes: 30,
  redactLogs: true,
  lastSyncAt: "",
  lastSyncSummary: {
    created: 0,
    updated: 0,
    archived: 0,
    pulled: 0,
    skipped: 0,
    failed: 0
  },
  raindropToken: "",
  raindropRefreshToken: "",
  raindropTokenExpiresAt: "",
  oauthClientId: "",
  oauthClientSecret: "",
  oauthRedirectPath: "raindrop",
  raindropUser: null,
  allowedCollections: [],
  sensitiveFilters: {
    keywords: [
      "private",
      "personal",
      "health",
      "bank",
      "resume",
      "job",
      "求职",
      "简历",
      "投资",
      "银行",
      "医疗",
      "私人",
      "个人"
    ],
    domains: [],
    paths: [
      "private",
      "personal",
      "私人",
      "个人"
    ]
  },
  deletePolicy: {
    mode: "archive",
    archiveCollectionId: 0,
    retentionDays: 30
  },
  rules: []
};

export const DEFAULT_RULE = {
  id: "",
  name: "工作书签备份",
  enabled: true,
  direction: "chrome-to-raindrop",
  sourceChromeFolderId: "",
  sourceChromeFolderName: "",
  targetRaindropCollectionId: 0,
  targetRaindropCollectionName: "Work Backup",
  includeSubtree: true,
  excludePaths: [],
  domainAllowlist: [],
  domainBlocklist: [],
  titleAllowlist: [],
  titleBlocklist: [],
  urlAllowlist: [],
  urlBlocklist: [],
  tags: [
    "chrome-backup"
  ],
  deletePolicy: "archive",
  pullDeletePolicy: "keep-chrome",
  conflictPolicy: "chrome-wins",
  scheduleMinutes: 30,
  privacyLevel: "office-visible",
  advancedMode: false,
  createdAt: "",
  updatedAt: ""
};

export const LOG_LIMIT = 300;
