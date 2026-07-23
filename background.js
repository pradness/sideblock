const FILTER_LIST_URL = "https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt";
const EASYLIST_URL = "https://easylist.to/easylist/easylist.txt";
const EASYPRIVACY_URL = "https://easylist.to/easylist/easyprivacy.txt";
const STORAGE_KEY = "cached_rules";
const LAST_FETCH_KEY = "last_fetch";
const ENABLED_KEY = "rules_enabled";
const REFRESH_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
const MAX_SESSION_RULES = 4900;
const HEADER_RULE_ID = 1;
const BLOCK_RULES_START_ID = 10;

chrome.runtime.onInstalled.addListener(() => {
  // This makes clicking the extension icon open the side panel automatically
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  init();
  chrome.alarms.create("refreshRules", { periodInMinutes: 1440 });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  init();
});

// ── Filter list parser ─────────────────────────────────────────────────────────
// Converts ABP/uBlock filter syntax to declarativeNetRequest rules.
// Handles the patterns that cover ~90% of real ad blocking.

function parseFilters(text) {
  const rules = [];
  const lines = text.split("\n");

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Skip comments, empty lines, cosmetic filters, snippet filters
    if (!line) continue;
    if (line.startsWith("!")) continue;
    if (line.startsWith("[")) continue;
    if (line.includes("##")) continue;
    if (line.includes("#@#")) continue;
    if (line.includes("#?#")) continue;
    if (line.includes("#$#")) continue;
    if (line.startsWith("@@")) continue; // skip whitelist rules for now

    // Only process network blocking rules
    // Must not contain unsupported option types
    const optionsSplit = line.split("$");
    let pattern = optionsSplit[0];
    const optionsStr = optionsSplit.slice(1).join("$");

    // Skip if pattern is empty
    if (!pattern) continue;

    // Parse options
    const options = optionsStr ? optionsStr.split(",") : [];
    const resourceTypes = [];
    let thirdPartyOnly = false;

    let skipRule = false;
    for (const opt of options) {
      const o = opt.trim().toLowerCase();
      if (o === "script") resourceTypes.push("script");
      else if (o === "image") resourceTypes.push("image");
      else if (o === "stylesheet") resourceTypes.push("stylesheet");
      else if (o === "object") resourceTypes.push("object");
      else if (o === "xmlhttprequest" || o === "xhr") resourceTypes.push("xmlhttprequest");
      else if (o === "subdocument") resourceTypes.push("sub_frame");
      else if (o === "ping") resourceTypes.push("ping");
      else if (o === "media") resourceTypes.push("media");
      else if (o === "websocket") resourceTypes.push("websocket");
      else if (o === "other") resourceTypes.push("other");
      else if (o === "font") resourceTypes.push("font");
      else if (o === "third-party" || o === "3p") thirdPartyOnly = true;
      else if (o === "important") { /* keep, just means high priority */ }
      else if (
        o.startsWith("~") ||
        o === "first-party" || o === "1p" ||
        o === "generichide" || o === "genericblock" ||
        o === "elemhide" || o === "specifichide" ||
        o === "popunder" || o === "popup" ||
        o === "redirect" || o.startsWith("redirect=") ||
        o.startsWith("redirect-rule") ||
        o === "csp" || o.startsWith("csp=") ||
        o === "rewrite" || o.startsWith("rewrite=") ||
        o === "replace" || o.startsWith("replace=") ||
        o.startsWith("queryprune") ||
        o.startsWith("removeparam")
      ) {
        skipRule = true;
        break;
      }
    }

    if (skipRule) continue;

    // Convert filter pattern to urlFilter
    let urlFilter = patternToUrlFilter(pattern);
    if (!urlFilter) continue;

    const rule = {
      priority: 2,
      action: { type: "block" },
      condition: { urlFilter }
    };

    if (resourceTypes.length > 0) {
      rule.condition.resourceTypes = resourceTypes;
    } else {
      rule.condition.resourceTypes = [
        "script", "image", "stylesheet", "object",
        "xmlhttprequest", "ping", "media", "websocket",
        "sub_frame", "font", "other"
      ];
    }

    if (thirdPartyOnly) {
      rule.condition.domainType = "thirdParty";
    }

    rules.push(rule);
    if (rules.length >= MAX_SESSION_RULES) break;
  }

  return rules;
}

function patternToUrlFilter(pattern) {
  // Already a regex - skip (declarativeNetRequest doesn't support full regex in urlFilter easily)
  if (pattern.startsWith("/") && pattern.endsWith("/")) return null;

  // Very short patterns cause too many false positives
  if (pattern.length < 4) return null;

  let filter = pattern;

  // Handle || (domain anchor) - matches start of domain
  // ||example.com^ -> urlFilter: ||example.com^
  // This is actually native declarativeNetRequest syntax, pass through

  // Handle @ anchors, convert to declarativeNetRequest equivalents
  // |https://example.com -> |https://example.com (left anchor)
  // example.com| -> example.com| (right anchor)

  // Replace * wildcards - already supported
  // Replace ^ separator character - already supported in urlFilter

  // Remove unsupported special constructs
  filter = filter.replace(/\[.*?\]/g, "*"); // remove character classes

  // If pattern has no special chars and is just a plain string, it's a substring match
  // declarativeNetRequest urlFilter treats plain strings as substring matches - good

  // Validate: urlFilter must not be empty after processing
  if (!filter || filter === "*") return null;

  // Skip overly broad patterns
  if (filter === "^" || filter === "|" || filter === "||") return null;

  // declarativeNetRequest urlFilter max length
  if (filter.length > 2000) return null;

  return filter;
}

// ── Rule application ───────────────────────────────────────────────────────────

function applyHeaderRule() {
  return new Promise((resolve) => {
    chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [HEADER_RULE_ID],
      addRules: [{
        id: HEADER_RULE_ID,
        priority: 1,
        action: {
          type: "modifyHeaders",
          responseHeaders: [
            { header: "x-frame-options", operation: "remove" },
            { header: "content-security-policy", operation: "remove" },
            { header: "content-security-policy-report-only", operation: "remove" }
          ]
        },
        condition: {
          urlFilter: "*",
          resourceTypes: ["main_frame", "sub_frame", "xmlhttprequest", "websocket"]
        }
      }]
    }, resolve);
  });
}

async function applyBlockRules(rules) {
  // Get current session rules to find existing block rule IDs to remove
  const existing = await new Promise((resolve) => {
    chrome.declarativeNetRequest.getSessionRules(resolve);
  });

  const existingBlockIds = existing
    .filter(r => r.id >= BLOCK_RULES_START_ID)
    .map(r => r.id);

  // Assign IDs
  const namedRules = rules.map((r, i) => ({ ...r, id: BLOCK_RULES_START_ID + i }));

  return new Promise((resolve) => {
    chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: existingBlockIds,
      addRules: namedRules
    }, () => {
      if (chrome.runtime.lastError) {
        console.error("Block rules error:", chrome.runtime.lastError.message);
      }
      resolve();
    });
  });
}

function getStored(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, resolve);
  });
}

async function getRulesEnabled() {
  const stored = await getStored([ENABLED_KEY]);
  return stored[ENABLED_KEY] !== false;
}

async function setRulesEnabled(enabled) {
  await new Promise((resolve) => {
    chrome.storage.local.set({ [ENABLED_KEY]: enabled }, resolve);
  });

  if (!enabled) {
    await applyBlockRules([]);
    return { enabled: false };
  }

  const stored = await getStored([STORAGE_KEY]);
  const rules = stored[STORAGE_KEY] || [];
  await applyBlockRules(rules);
  return { enabled: true };
}

// ── Fetch and update ───────────────────────────────────────────────────────────

async function fetchFilterList(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } catch (e) {
    console.error(`Failed to fetch ${url}:`, e);
    return null;
  }
}

async function updateRules(force = false) {
  // Check if we need to refresh
  const stored = await getStored([STORAGE_KEY, LAST_FETCH_KEY, ENABLED_KEY]);

  const lastFetch = stored[LAST_FETCH_KEY] || 0;
  const now = Date.now();
  const enabled = stored[ENABLED_KEY] !== false;

  if (!force && stored[STORAGE_KEY] && (now - lastFetch) < REFRESH_INTERVAL) {
    // Use cached rules
    console.log("Using cached rules:", stored[STORAGE_KEY].length);
    await applyBlockRules(enabled ? stored[STORAGE_KEY] : []);
    return;
  }

  console.log("Fetching fresh filter lists...");

  // Fetch all three lists in parallel
  const [ublock, easylist, easyprivacy] = await Promise.all([
    fetchFilterList(FILTER_LIST_URL),
    fetchFilterList(EASYLIST_URL),
    fetchFilterList(EASYPRIVACY_URL),
  ]);

  let allRules = [];

  if (ublock) {
    const rules = parseFilters(ublock);
    console.log(`uBlock filters: ${rules.length} rules`);
    allRules = allRules.concat(rules);
  }

  if (easylist && allRules.length < MAX_SESSION_RULES) {
    const rules = parseFilters(easylist);
    console.log(`EasyList: ${rules.length} rules`);
    allRules = allRules.concat(rules);
  }

  if (easyprivacy && allRules.length < MAX_SESSION_RULES) {
    const rules = parseFilters(easyprivacy);
    console.log(`EasyPrivacy: ${rules.length} rules`);
    allRules = allRules.concat(rules);
  }

  // Deduplicate by urlFilter
  const seen = new Set();
  allRules = allRules.filter(r => {
    if (seen.has(r.condition.urlFilter)) return false;
    seen.add(r.condition.urlFilter);
    return true;
  });

  // Cap at session rule limit
  allRules = allRules.slice(0, MAX_SESSION_RULES);
  console.log(`Total rules after dedup: ${allRules.length}`);

  // Cache to storage (without IDs, those get assigned on apply)
  await new Promise((resolve) => {
    chrome.storage.local.set({
      [STORAGE_KEY]: allRules,
      [LAST_FETCH_KEY]: now
    }, resolve);
  });

  await applyBlockRules(enabled ? allRules : []);
}

// ── Init ───────────────────────────────────────────────────────────────────────

async function init() {
  await applyHeaderRule();
  await updateRules();
}

chrome.runtime.onInstalled.addListener(() => {
  init();
  // Schedule periodic refresh using alarms
  chrome.alarms.create("refreshRules", { periodInMinutes: 1440 }); // 24 hours
});

chrome.runtime.onStartup.addListener(() => {
  init();
});

// Re-apply on alarm (service workers can die and restart)
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "refreshRules") {
    updateRules(true);
  }
});

// Also re-apply header rule whenever service worker wakes
applyHeaderRule();

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg.action) {
      case "getState":
        const stored = await getStored(["webframe_state", ENABLED_KEY]);
        sendResponse({ url: "", isMobile: false, rulesEnabled: stored[ENABLED_KEY] !== false, ...(stored["webframe_state"] || {}) });
        break;
      case "saveState":
        await new Promise((resolve) => {
          chrome.storage.local.set({ "webframe_state": msg.state }, resolve);
        });
        sendResponse({ ok: true });
        break;
      case "toggleFilters":
        sendResponse(await setRulesEnabled(!(await getRulesEnabled())));
        break;
      default:
        sendResponse({ error: "unknown action" });
    }
  })();
  return true;
});