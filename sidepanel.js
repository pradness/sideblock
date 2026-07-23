const urlInput    = document.getElementById("urlInput");
const scheme      = document.getElementById("scheme");
const goBtn       = document.getElementById("goBtn");
const reloadBtn   = document.getElementById("reloadBtn");
const backBtn     = document.getElementById("backBtn");
const forwardBtn  = document.getElementById("forwardBtn");
const desktopBtn  = document.getElementById("desktopBtn");
const mobileBtn   = document.getElementById("mobileBtn");
const webFrame    = document.getElementById("webFrame");
const emptyState  = document.getElementById("emptyState");
const frameContainer   = document.getElementById("frameContainer");
const filterToggleBtn  = document.getElementById("filterToggleBtn");
const filterToggleIcon = document.getElementById("filterToggleIcon");

let currentUrl   = "";
let isMobile     = false;
let rulesEnabled  = true;
let navHistory   = [];
let historyIndex = -1;
let loadTimer    = null;

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

// ── Frame events ───────────────────────────────────────────────────────────────

webFrame.addEventListener("load", () => {
  finishLoadingBar();
  if (isMobile) scaleMobileFrame();

  // Try to read the current URL from the frame (works if same-origin,
  // but after our CSP strip many sites allow this)
  try {
    const frameUrl = webFrame.contentWindow?.location?.href;
    if (frameUrl && frameUrl !== "about:blank" && frameUrl !== currentUrl) {
      currentUrl = frameUrl;
      urlInput.value = stripScheme(frameUrl);
      updateSchemeLabel(frameUrl);
    }
  } catch (e) {
    // cross-origin - fine, url stays as what we set
  }
});

// ── Navigation ─────────────────────────────────────────────────────────────────

async function navigate(url, pushHistory = true) {
  if (!url) return;
  currentUrl = url;
  urlInput.value = stripScheme(url);
  updateSchemeLabel(url);

  if (pushHistory) {
    navHistory = navHistory.slice(0, historyIndex + 1);
    navHistory.push(url);
    historyIndex = navHistory.length - 1;
  }

  updateNavBtns();
  showFrame();
  startLoadingBar();
  webFrame.src = url;

  await send({ action: "saveState", state: { url, isMobile } });
}

function updateNavBtns() {
  backBtn.disabled  = historyIndex <= 0;
  forwardBtn.disabled = historyIndex >= navHistory.length - 1;
}

// ── Event listeners ────────────────────────────────────────────────────────────

goBtn.addEventListener("click", () => {
  const url = normalize(urlInput.value);
  if (url) navigate(url);
});

urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const url = normalize(urlInput.value);
    if (url) navigate(url);
  }
});

urlInput.addEventListener("input", () => {
  updateSchemeLabel(normalize(urlInput.value));
});

reloadBtn.addEventListener("click", () => {
  if (currentUrl) {
    startLoadingBar();
    webFrame.src = currentUrl;
  }
});

backBtn.addEventListener("click", () => {
  if (historyIndex > 0) {
    historyIndex--;
    navigate(navHistory[historyIndex], false);
  }
});

forwardBtn.addEventListener("click", () => {
  if (historyIndex < navHistory.length - 1) {
    historyIndex++;
    navigate(navHistory[historyIndex], false);
  }
});

desktopBtn.addEventListener("click", async () => {
  if (!isMobile) return;
  isMobile = false;
  desktopBtn.classList.add("active");
  mobileBtn.classList.remove("active");
  applyMobileLayout(false);
  if (currentUrl) { startLoadingBar(); webFrame.src = currentUrl; }
  await send({ action: "saveState", state: { url: currentUrl, isMobile: false } });
});

mobileBtn.addEventListener("click", async () => {
  if (isMobile) return;
  isMobile = true;
  mobileBtn.classList.add("active");
  desktopBtn.classList.remove("active");
  applyMobileLayout(true);
  if (currentUrl) { startLoadingBar(); webFrame.src = currentUrl; }
  await send({ action: "saveState", state: { url: currentUrl, isMobile: true } });
});

filterToggleBtn.addEventListener("click", async () => {
  filterToggleBtn.disabled = true;
  const response = await send({ action: "toggleFilters" });
  filterToggleBtn.disabled = false;

  if (response && typeof response.enabled === "boolean") {
    setFilterToggleState(response.enabled);
  }
});

// ── Storage change listener ────────────────────────────────────────────────────
chrome.storage.onChanged.addListener((changes) => {
  if (changes["rules_enabled"]) {
    setFilterToggleState(changes["rules_enabled"].newValue !== false);
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

  if (state.url) {
    navigate(state.url, true);
  } else {
    showEmpty();
  }

  updateNavBtns();
}

init();