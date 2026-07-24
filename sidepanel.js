const urlInput       = document.getElementById("urlInput");
const scheme         = document.getElementById("scheme");
const goBtn          = document.getElementById("goBtn");
const reloadBtn      = document.getElementById("reloadBtn");
const backBtn        = document.getElementById("backBtn");
const forwardBtn     = document.getElementById("forwardBtn");
const desktopBtn     = document.getElementById("desktopBtn");
const mobileBtn      = document.getElementById("mobileBtn");
const webFrame       = document.getElementById("webFrame");
const emptyState     = document.getElementById("emptyState");
const frameContainer = document.getElementById("frameContainer");
const filterToggleBtn  = document.getElementById("filterToggleBtn");
const filterToggleIcon = document.getElementById("filterToggleIcon");

let currentUrl   = "";
let isMobile     = false;
let rulesEnabled = true;
let loadTimer    = null;
let isInternalNav = false;
let lastTrackedUrl = "";

// ── Session history ────────────────────────────────────────────────────────────

let session = {
  history: [],
  index: -1,
};

function sessionPush(url) {
  if (session.history[session.index] === url) return;
  session.history = session.history.slice(0, session.index + 1);
  session.history.push(url);
  session.index = session.history.length - 1;
  updateNavBtns();
  persistState();
}

function sessionBack() {
  if (session.index > 0) {
    session.index--;
    updateNavBtns();
    return session.history[session.index];
  }
  return null;
}

function sessionForward() {
  if (session.index < session.history.length - 1) {
    session.index++;
    updateNavBtns();
    return session.history[session.index];
  }
  return null;
}

function updateNavBtns() {
  backBtn.disabled    = session.index <= 0;
  forwardBtn.disabled = session.index >= session.history.length - 1;
}

// ── Persist state ──────────────────────────────────────────────────────────────

async function persistState() {
  const url = session.history[session.index] || currentUrl;
  await send({
    action: "saveState",
    state: {
      url,
      isMobile,
      session: {
        history: session.history,
        index: session.index,
      }
    }
  });
}

// ── Messaging ──────────────────────────────────────────────────────────────────

function send(msg) {
  return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
}

// ── URL helpers ────────────────────────────────────────────────────────────────

function normalize(raw) {
  raw = raw.trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return "https://" + raw;
}

function stripScheme(url) {
  return url.replace(/^https?:\/\//i, "");
}

function updateSchemeLabel(url) {
  scheme.textContent = url.startsWith("http://") ? "http://" : "https://";
}

function setUrlBar(url) {
  currentUrl = url;
  urlInput.value = stripScheme(url);
  updateSchemeLabel(url);
}

// ── Filter toggle ──────────────────────────────────────────────────────────────

function setFilterToggleState(enabled) {
  rulesEnabled = enabled;
  filterToggleBtn.classList.toggle("inactive", !enabled);
  filterToggleIcon.src = enabled ? "icons/ubo_16.png" : "icons/ubo_16-off.png";
  filterToggleBtn.title = enabled ? "Disable filter list" : "Enable filter list";
  filterToggleBtn.setAttribute("aria-label", filterToggleBtn.title);
}

// ── Show/hide ──────────────────────────────────────────────────────────────────

function showEmpty() {
  emptyState.classList.remove("hidden");
  webFrame.classList.add("hidden");
}

function showFrame() {
  emptyState.classList.add("hidden");
  webFrame.classList.remove("hidden");
}

// ── Loading bar ────────────────────────────────────────────────────────────────

function startLoadingBar() {
  clearTimeout(loadTimer);
  let bar = document.querySelector(".loading-bar");
  if (!bar) {
    bar = document.createElement("div");
    bar.className = "loading-bar";
    frameContainer.appendChild(bar);
  }
  bar.style.transition = "none";
  bar.style.width = "0%";
  requestAnimationFrame(() => {
    bar.style.transition = "width 1.5s ease";
    bar.style.width = "80%";
  });
  loadTimer = setTimeout(() => { bar.style.width = "92%"; }, 2000);
}

function finishLoadingBar() {
  clearTimeout(loadTimer);
  const bar = document.querySelector(".loading-bar");
  if (bar) {
    bar.style.transition = "width 0.2s ease";
    bar.style.width = "100%";
    setTimeout(() => bar.remove(), 250);
  }
}

// ── Mobile layout ──────────────────────────────────────────────────────────────

function applyMobileLayout(enable) {
  if (enable) {
    if (!document.querySelector(".mobile-scale-wrap")) {
      const wrap = document.createElement("div");
      wrap.className = "mobile-scale-wrap";
      frameContainer.insertBefore(wrap, webFrame);
      wrap.appendChild(webFrame);
    }
    scaleMobileFrame();
  } else {
    const wrap = document.querySelector(".mobile-scale-wrap");
    if (wrap) {
      frameContainer.insertBefore(webFrame, wrap);
      wrap.remove();
    }
    webFrame.style.transform = "";
    webFrame.style.width = "100%";
    webFrame.style.height = "100%";
  }
}

function scaleMobileFrame() {
  const wrap = document.querySelector(".mobile-scale-wrap");
  if (!wrap) return;
  const scale = wrap.clientWidth / 390;
  webFrame.style.transform = `scale(${scale})`;
  webFrame.style.transformOrigin = "top left";
  webFrame.style.width = "390px";
  webFrame.style.height = (wrap.clientHeight / scale) + "px";
}

window.addEventListener("resize", () => {
  if (isMobile) scaleMobileFrame();
});

// ── iframe load event ──────────────────────────────────────────────────────────

webFrame.addEventListener("load", () => {
  finishLoadingBar();
  if (isMobile) scaleMobileFrame();

  let frameUrl = "";
  try {
    frameUrl = webFrame.contentWindow?.location?.href || "";
  } catch (e) {
    frameUrl = webFrame.src || "";
  }

  if (!frameUrl || frameUrl === "about:blank") return;
  if (frameUrl.startsWith("blob:") || frameUrl.startsWith("data:")) return;

  setUrlBar(frameUrl);

  if (!isInternalNav && frameUrl !== lastTrackedUrl) {
    sessionPush(frameUrl);
  }

  isInternalNav = false;
  lastTrackedUrl = frameUrl;
});

// ── Storage change listener ────────────────────────────────────────────────────
// content.js writes webframe_live_url on every pushState/popstate.
// We read it here to update the URL bar and session in real time.

chrome.storage.onChanged.addListener((changes) => {
  if (changes["rules_enabled"]) {
    setFilterToggleState(changes["rules_enabled"].newValue !== false);
  }

  if (changes["webframe_live_url"]) {
    const url = changes["webframe_live_url"].newValue;
    if (!url || url === lastTrackedUrl) return;

    setUrlBar(url);
    lastTrackedUrl = url;

    if (!isInternalNav) {
      sessionPush(url);
    }
    isInternalNav = false;
  }
});

// ── Navigate ───────────────────────────────────────────────────────────────────

async function navigate(url, isHistoryNav = false) {
  if (!url) return;

  setUrlBar(url);
  isInternalNav = isHistoryNav;

  showFrame();
  startLoadingBar();
  webFrame.src = url;

  if (!isHistoryNav) {
    sessionPush(url);
  }

  // Clear the live url so it gets re-written by content.js fresh
  chrome.storage.local.remove("webframe_live_url");

  await persistState();
}

// ── Event listeners ────────────────────────────────────────────────────────────

function submitUrl() {
  const url = normalize(urlInput.value);
  if (url) navigate(url);
}

if (goBtn) {
  goBtn.addEventListener("click", submitUrl);
}

urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    submitUrl();
  }
});

urlInput.addEventListener("input", () => {
  updateSchemeLabel(normalize(urlInput.value));
});

reloadBtn.addEventListener("click", () => {
  if (currentUrl) {
    startLoadingBar();
    isInternalNav = true;
    webFrame.src = currentUrl;
  }
});

backBtn.addEventListener("click", () => {
  const url = sessionBack();
  if (!url) return;
  setUrlBar(url);
  isInternalNav = true;
  showFrame();
  startLoadingBar();
  webFrame.src = url;
  persistState();
});

forwardBtn.addEventListener("click", () => {
  const url = sessionForward();
  if (!url) return;
  setUrlBar(url);
  isInternalNav = true;
  showFrame();
  startLoadingBar();
  webFrame.src = url;
  persistState();
});

desktopBtn.addEventListener("click", async () => {
  if (!isMobile) return;
  isMobile = false;
  desktopBtn.classList.add("active");
  mobileBtn.classList.remove("active");
  applyMobileLayout(false);
  if (currentUrl) { isInternalNav = true; startLoadingBar(); webFrame.src = currentUrl; }
  await persistState();
});

mobileBtn.addEventListener("click", async () => {
  if (isMobile) return;
  isMobile = true;
  mobileBtn.classList.add("active");
  desktopBtn.classList.remove("active");
  applyMobileLayout(true);
  if (currentUrl) { isInternalNav = true; startLoadingBar(); webFrame.src = currentUrl; }
  await persistState();
});

filterToggleBtn.addEventListener("click", async () => {
  filterToggleBtn.disabled = true;
  const response = await send({ action: "toggleFilters" });
  filterToggleBtn.disabled = false;
  if (response && typeof response.enabled === "boolean") {
    setFilterToggleState(response.enabled);
  }
});

// ── Init ───────────────────────────────────────────────────────────────────────

async function init() {
  const state = await send({ action: "getState" });

  isMobile = state.isMobile || false;
  setFilterToggleState(state.rulesEnabled !== false);

  if (isMobile) {
    mobileBtn.classList.add("active");
    desktopBtn.classList.remove("active");
    applyMobileLayout(true);
  }

  // Prefer the live URL saved by content.js over the session-saved URL.
  // This is the most accurate URL - written on every pushState by the page.
  const liveData = await new Promise((resolve) => {
    chrome.storage.local.get("webframe_live_url", resolve);
  });

  const liveUrl = liveData["webframe_live_url"];

  // Restore session history
  if (state.session && state.session.history && state.session.history.length > 0) {
    session.history = state.session.history;
    session.index   = state.session.index ?? state.session.history.length - 1;

    // If content.js saved a more recent URL, update the session tip
    if (liveUrl && liveUrl !== session.history[session.index]) {
      // Push it so back button still works
      session.history = session.history.slice(0, session.index + 1);
      session.history.push(liveUrl);
      session.index = session.history.length - 1;
    }

    updateNavBtns();

    const url = session.history[session.index];
    if (url) {
      setUrlBar(url);
      lastTrackedUrl = url;
      isInternalNav = true;
      showFrame();
      startLoadingBar();
      webFrame.src = url;
      return;
    }
  }

  // Fallback to just the live URL or saved URL
  const url = liveUrl || state.url;
  if (url) {
    setUrlBar(url);
    lastTrackedUrl = url;
    isInternalNav = true;
    showFrame();
    startLoadingBar();
    webFrame.src = url;
    sessionPush(url);
  } else {
    showEmpty();
  }
}

init();