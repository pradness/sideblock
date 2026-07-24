// Cosmetic filter engine
// Parses ## rules from uBlock/EasyList and injects CSS to hide matched elements
// Also handles scriptlet injection for anti-adblock bypass

(function () {
  // Don't run in the extension's own pages
  if (location.protocol === "chrome-extension:") return;

  const hostname = location.hostname;

  // ── Cosmetic CSS rules ─────────────────────────────────────────────────────
  // These cover the most common ad container selectors across the web
  // Sourced from uBlock's cosmetic filters for common patterns

  const GENERIC_COSMETIC_SELECTORS = [
    // Generic ad containers
    "#ad", "#ads", "#ad-container", "#ad-wrapper", "#ad-banner",
    "#ad-header", "#ad-footer", "#ad-sidebar", "#ad-slot",
    "#adbox", "#adframe", "#adunit", "#adzone",
    "#ads-container", "#ads-wrapper", "#ads-banner",
    "#adsense", "#adSense", "#AdSense",
    "#advertisement", "#advertisements", "#advertising",
    "#banner-ad", "#banner_ad", "#bannerAd",
    "#dfp-ad", "#dfp_ad", "#google-ad", "#google_ad",
    "#leaderboard-ad", "#leaderboard_ad",
    "#sidebar-ad", "#sidebar_ad",
    "#skyscraper-ad", "#skyscraper_ad",
    "#sponsored", "#sponsored-content", "#sponsored_content",
    "#top-ad", "#top_ad", "#topAd",
    ".ad", ".ads", ".ad-container", ".ad-wrapper", ".ad-banner",
    ".ad-header", ".ad-footer", ".ad-sidebar", ".ad-slot",
    ".adbox", ".adframe", ".adunit", ".adzone",
    ".ads-container", ".ads-wrapper", ".ads-banner",
    ".adsense", ".adSense",
    ".advertisement", ".advertisements", ".advertising",
    ".banner-ad", ".banner_ad", ".bannerAd",
    ".dfp-ad", ".dfp_ad", ".google-ad", ".google_ad",
    ".leaderboard-ad", ".leaderboard_ad",
    ".sidebar-ad", ".sidebar_ad",
    ".skyscraper-ad", ".skyscraper_ad",
    ".sponsored", ".sponsored-content", ".sponsored-links",
    ".sponsored-post", ".sponsored-results",
    ".top-ad", ".top_ad", ".topAd",
    // Google ads
    "ins.adsbygoogle",
    "[id^='google_ads_']",
    "[id^='div-gpt-ad']",
    "[id^='dfp-ad-']",
    "[class^='dfp-ad-']",
    "[id*='-ad-']",
    "[class*='-ad-']",
    "[id*='_ad_']",
    "[class*='_ad_']",
    // IAB standard ad sizes as data attributes
    "[data-ad-slot]",
    "[data-ad-client]",
    "[data-ad-unit]",
    "[data-ad-type]",
    "[data-adunit]",
    "[data-advertisement]",
    // Common ad network containers
    ".adngin", ".adngin-container",
    ".adthrive", ".adthrive-ad",
    ".mediavine-ad", ".mv-ad",
    ".raptive-ad", ".catf-ad",
    ".ezoic-ad", "[id^='ezoic-pub-ad']",
    ".ad-unit", ".ad_unit",
    ".ad-placement", ".ad_placement",
    ".ad-block", ".ad_block",
    ".ad-area", ".ad_area",
    ".ad-section", ".ad_section",
    ".ad-space", ".ad_space",
    ".ad-spot", ".ad_spot",
    ".ad-tag", ".ad_tag",
    ".ad-wrap", ".ad_wrap",
    ".ad-widget", ".ad_widget",
    ".ad-zone", ".ad_zone",
    // Taboola / Outbrain
    "#taboola-above-article",
    "#taboola-below-article",
    "#taboola-right-rail",
    "[id^='taboola-']",
    "[class^='taboola-']",
    "#outbrain_widget",
    "[id^='outbrain-']",
    "[class^='outbrain-']",
    ".OUTBRAIN",
    // Criteo
    "[id^='criteo-']",
    "[class^='criteo-']",
    ".crto-unified-header",
    // Pub ads
    "[id^='pub_ad_']",
    "[class^='pub_ad_']",
    // Flash / banner specific
    "object[classid]",
    "object[type='application/x-shockwave-flash']",
    "embed[type='application/x-shockwave-flash']",
    // Sticky/overlay ads
    ".sticky-ad", ".sticky_ad", "#sticky-ad", "#sticky_ad",
    ".fixed-ad", ".fixed_ad",
    ".floating-ad", ".floating_ad",
    ".overlay-ad", ".overlay_ad",
    ".popup-ad", ".popup_ad",
    ".interstitial-ad", ".interstitial_ad",
    // Cookie/GDPR consent that are actually ad-related
    "#adskeeper",
    "[class*='AdKeeper']",
  ];

  // ── YouTube specific ───────────────────────────────────────────────────────

  const YOUTUBE_SELECTORS = [
    // Ad containers
    ".ad-showing",
    ".ad-interrupting",
    "#player-ads",
    "#masthead-ad",
    ".ytd-banner-promo-renderer",
    "ytd-banner-promo-renderer",
    "ytd-statement-banner-renderer",
    "ytd-ad-slot-renderer",
    "ytd-in-feed-ad-layout-renderer",
    "ytd-display-ad-renderer",
    "ytd-promoted-sparkles-web-renderer",
    "ytd-promoted-video-renderer",
    "ytd-search-pyv-renderer",
    "ytd-action-companion-ad-renderer",
    "ytd-companions-renderer",
    "ytd-player-legacy-desktop-watch-ads-renderer",
    ".ytd-merch-shelf-renderer",
    "#clarify-box",
    "ytd-engagement-panel-section-list-renderer[target-id='engagement-panel-ads']",
    // Overlay ads on video
    ".ytp-ad-overlay-container",
    ".ytp-ad-text-overlay",
    ".ytp-ad-image-overlay",
    ".ytp-ad-skip-button-container",
    ".ytp-ad-message-container",
    ".ytp-featured-product",
    ".ytp-suggested-action",
    // Shopping ads
    "ytd-shopping-companion-ad-renderer",
    "ytd-compact-promoted-item-renderer",
  ];

  // ── Site-specific rules ────────────────────────────────────────────────────

  const SITE_RULES = {
    "youtube.com": YOUTUBE_SELECTORS,
    "www.youtube.com": YOUTUBE_SELECTORS,
    "reddit.com": [
      ".promotedlink", ".promoted-link",
      "[data-adtype]", "[data-promoted]",
      "shreddit-ad-post", ".promotedcontainer",
    ],
    "twitter.com": [
      "[data-testid='placementTracking']",
      "[data-testid='promoted-tweet-notice']",
    ],
    "x.com": [
      "[data-testid='placementTracking']",
      "[data-testid='promoted-tweet-notice']",
    ],
    "facebook.com": [
      "._5jmm", "._4_yl", "._4-u2._4-u8",
      "[data-pagelet*='ad']",
    ],
    "twitch.tv": [
      ".player-ad-overlay", ".tw-ad",
      "[class*='ad-banner']",
    ],
  };

  // ── Inject CSS ─────────────────────────────────────────────────────────────

  function buildCSS(selectors) {
    return selectors.join(",\n") + " {\n  display: none !important;\n  visibility: hidden !important;\n  opacity: 0 !important;\n  pointer-events: none !important;\n  height: 0 !important;\n  max-height: 0 !important;\n  overflow: hidden !important;\n}";
  }

  function injectCSS(css) {
    const style = document.createElement("style");
    style.id = "webframe-cosmetic";
    style.textContent = css;
    // Inject as early as possible
    if (document.head) {
      document.head.appendChild(style);
    } else if (document.documentElement) {
      document.documentElement.appendChild(style);
    } else {
      document.addEventListener("DOMContentLoaded", () => {
        document.head.appendChild(style);
      });
    }
  }

  // Build selector list for this page
  let selectors = [...GENERIC_COSMETIC_SELECTORS];

  // Add site-specific rules
  for (const [domain, rules] of Object.entries(SITE_RULES)) {
    if (hostname === domain || hostname.endsWith("." + domain)) {
      selectors = selectors.concat(rules);
    }
  }

  // Inject immediately
  injectCSS(buildCSS(selectors));

  // ── MutationObserver for dynamically injected ads ──────────────────────────
  // Many ad networks inject elements after page load

  function hideElement(el) {
    el.style.setProperty("display", "none", "important");
    el.style.setProperty("visibility", "hidden", "important");
    el.style.setProperty("opacity", "0", "important");
    el.style.setProperty("height", "0", "important");
    el.style.setProperty("max-height", "0", "important");
    el.style.setProperty("overflow", "hidden", "important");
    el.style.setProperty("pointer-events", "none", "important");
  }

  function isAdElement(el) {
    if (!el || el.nodeType !== 1) return false;
    const id = (el.id || "").toLowerCase();
    const cls = (el.className && typeof el.className === "string")
      ? el.className.toLowerCase()
      : "";

    // Check common ad patterns
    const adPatterns = [
      /^ad[-_]/, /[-_]ad$/, /[-_]ad[-_]/,
      /^ads[-_]/, /[-_]ads$/, /^advert/, /advertis/,
      /^banner[-_]ad/, /sponsor/, /^dfp/, /^gpt-ad/,
      /adsbygoogle/, /adsense/, /taboola/, /outbrain/,
      /criteo/, /moat/, /ezoic/, /mediavine/, /adthrive/,
    ];

    for (const pattern of adPatterns) {
      if (pattern.test(id) || pattern.test(cls)) return true;
    }

    // Check data attributes
    if (
      el.hasAttribute("data-ad-slot") ||
      el.hasAttribute("data-ad-client") ||
      el.hasAttribute("data-ad-unit") ||
      el.hasAttribute("data-adunit") ||
      el.hasAttribute("data-advertisement") ||
      el.hasAttribute("data-ad-type")
    ) return true;

    // Check for flash/object ads
    if (el.tagName === "OBJECT" || el.tagName === "EMBED") {
      const type = el.getAttribute("type") || "";
      if (type.includes("flash") || type.includes("shockwave")) return true;
    }

    return false;
  }

  // YouTube ad skip automation
  function handleYouTubeAds() {
    if (!hostname.includes("youtube.com")) return;

    // Skip button
    const skipBtn = document.querySelector(
      ".ytp-skip-ad-button, .ytp-ad-skip-button, [class*='skip-button']"
    );
    if (skipBtn) skipBtn.click();

    // Mute ad audio and fast-forward
    const video = document.querySelector("video");
    if (video) {
      const adShowing = document.querySelector(".ad-showing");
      if (adShowing) {
        video.muted = true;
        if (video.duration && isFinite(video.duration)) {
          video.currentTime = video.duration;
        }
      }
    }
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue;

        if (isAdElement(node)) {
          hideElement(node);
          continue;
        }

        // Check children of added nodes
        const adChildren = node.querySelectorAll
          ? node.querySelectorAll(
              selectors.slice(0, 50).join(",") // limit selector complexity
            )
          : [];
        for (const child of adChildren) {
          hideElement(child);
        }
      }
    }

    // YouTube-specific handling on every mutation
    if (hostname.includes("youtube.com")) {
      handleYouTubeAds();
    }
  });

  // Start observing once DOM is available
  function startObserver() {
    observer.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startObserver);
  } else {
    startObserver();
  }

  // Run YouTube handler periodically as a fallback
  if (hostname.includes("youtube.com")) {
    setInterval(handleYouTubeAds, 1000);
  }

})();

// ── URL change bridge ──────────────────────────────────────────────────────────
// Saves current URL directly to chrome.storage on every navigation.
// Uses storage instead of postMessage because cross-origin postMessage
// to the sidepanel parent is blocked by the browser.

(function () {
  // Only run in the top frame, not in sub-iframes within the page
  if (window !== window.top) return;

  function saveCurrentUrl() {
    const url = location.href;
    if (!url || url === "about:blank") return;
    chrome.storage.local.set({ "webframe_live_url": url });
  }

  // Intercept pushState
  const _pushState = history.pushState.bind(history);
  history.pushState = function (...args) {
    _pushState(...args);
    saveCurrentUrl();
  };

  // Intercept replaceState
  const _replaceState = history.replaceState.bind(history);
  history.replaceState = function (...args) {
    _replaceState(...args);
    saveCurrentUrl();
  };

  // popstate fires when user clicks browser back/forward
  window.addEventListener("popstate", saveCurrentUrl);

  // Also save on initial load
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", saveCurrentUrl);
  } else {
    saveCurrentUrl();
  }

})();