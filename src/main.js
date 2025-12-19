import OBR, { isImage } from "@owlbear-rodeo/sdk";
import "./style.css";

const ID = "com.tutorial.wildshape";
const METADATA_LIBRARY = `${ID}/library`;
const METADATA_ORIGINAL = `${ID}/original`;
const METADATA_STATE = `${ID}/state`;
const METADATA_SUMMON = `${ID}/summon`;
const SUMMON_CREATED_BY = "WildShapeExtension";

// Transform sizing preference (UI dropdown)
const SIZE_PREF_KEY = `${ID}:transformSizeMode`;
const SIZE_SELECT_ID = "wildshape-size-select";

// Transform options
const KEEP_FOOTPRINT_KEY = `${ID}:keepFootprint`;
const KEEP_FOOTPRINT_ID = "wildshape-keep-footprint-toggle";

const LABEL_PREFIX_KEY = `${ID}:labelPrefix`;
const LABEL_PREFIX_ID = "wildshape-label-prefix-toggle";

// Collapsible options
const TRANSFORM_OPTIONS_WRAP_ID = "wildshape-transform-options";
const TRANSFORM_OPTIONS_CONTENT_ID = "wildshape-transform-options-content";
const TRANSFORM_OPTIONS_TOGGLE_ID = "wildshape-transform-options-toggle";
const TRANSFORM_OPTIONS_COLLAPSED_KEY = `${ID}:transformOptionsCollapsed`;

// Active list UI ids
const ACTIVE_WRAP_ID = "wildshape-active-wrap";
const ACTIVE_LIST_ID = "wildshape-active-list";
const ACTIVE_EMPTY_ID = "wildshape-active-empty";
const ACTIVE_COUNT_ID = "wildshape-active-count";
const ACTIVE_REVERT_ALL_ID = "wildshape-active-revert-all";

// Batch preview loading spinner ids
const BATCH_LOADING_ID = "wildshape-batch-loading";
const BATCH_LOADING_STYLE_ID = "wildshape-batch-loading-style";

// Tabs
const ACTIVE_TAB_KEY = `${ID}:activeTab`;
const REQUEST_TAB_KEY = `${ID}:requestTab`;
const REQUEST_SUMMON_POSITION_KEY = `${ID}:summonPosition`;

// Back-compat key used by the background page snippet I gave earlier
const OPEN_TAB_KEY = `${ID}:openTab`;

let availableShapes = [];
let currentSelectedImage = null;
let activeSummons = [];
let pendingSummonPosition = null;
let currentSelectionIds = [];

// Cache image dimensions by URL
const imageDimCache = new Map();

// Track active transformed tokens
let activeTransformed = [];

// Batch Add state
const batch = {
  active: false,
  ids: [],
  index: 0,
  saved: 0,
  skipped: 0,
  complete: null,
};

let ignoreNextSelectionChange = false;

// ------------------------------
// ICONS (SVGs)
// ------------------------------
const ICON_TRANSFORM = `
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
</svg>`;

const ICON_TRASH = `
<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
</svg>`;

const ICON_REVERT = `
<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 1 1 0 12h-2"/>
</svg>`;

const ICON_CHEVRON = `
<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="m6 9 6 6 6-6"/>
</svg>`;

// Helper to select elements
function $(sel) {
  return document.querySelector(sel);
}

function isLibraryViewActive() {
  const view = document.getElementById("view-library");
  return view && !view.classList.contains("hidden");
}

function isTransformViewActive() {
  const view = document.getElementById("view-transform");
  return view && !view.classList.contains("hidden");
}

// ------------------------------
// OBR HELPERS
// ------------------------------
async function updateItemsByIds(ids, updater) {
  if (!Array.isArray(ids) || ids.length === 0) return;
  const items = await OBR.scene.items.getItems(ids);
  if (!items || items.length === 0) return;
  await OBR.scene.items.updateItems(items, updater);
}

// ------------------------------
// IMAGE DIMENSIONS
// ------------------------------
function loadImageDimensions(url) {
  if (!url) return Promise.resolve(null);
  if (imageDimCache.has(url)) return Promise.resolve(imageDimCache.get(url));

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const dims = { width: img.naturalWidth, height: img.naturalHeight };
      imageDimCache.set(url, dims);
      resolve(dims);
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

async function ensureShapeDims(shape) {
  if (shape?.imgWidth && shape?.imgHeight) {
    return { width: Number(shape.imgWidth), height: Number(shape.imgHeight) };
  }
  const dims = await loadImageDimensions(shape?.url);
  return dims;
}

function safeCloneScale(s) {
  if (!s || typeof s.x !== "number" || typeof s.y !== "number") return { x: 1, y: 1 };
  return { x: s.x, y: s.y };
}

// ------------------------------
// ORIGINAL METADATA VALIDATION
// ------------------------------
function isPositiveNumber(n) {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

function validateOriginal(original) {
  if (!original || typeof original !== "object") return false;
  if (typeof original.url !== "string" || !original.url) return false;
  if (!isPositiveNumber(original.imgWidth)) return false;
  if (!isPositiveNumber(original.imgHeight)) return false;
  if (!isPositiveNumber(original.gridDpi)) return false;
  if (!original.scale || typeof original.scale.x !== "number" || typeof original.scale.y !== "number") return false;
  return true;
}

// ------------------------------
// LIBRARY ENTRY VALIDATION (safer metadata)
// ------------------------------
function isValidShapeEntry(s) {
  if (!s || typeof s !== "object") return false;
  if (typeof s.id !== "string" || !s.id) return false;
  if (typeof s.name !== "string" || !s.name.trim()) return false;
  if (typeof s.url !== "string" || !s.url) return false;
  return true;
}

function normalizeLibrary(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const cleaned = [];

  for (const s of list) {
    if (!isValidShapeEntry(s)) continue;
    if (seen.has(s.id)) continue;
    seen.add(s.id);

    cleaned.push({
      v: 1,
      id: s.id,
      name: String(s.name || "").trim(),
      size: Number(s.size || 1) || 1,
      url: s.url,
      imgWidth: isPositiveNumber(Number(s.imgWidth)) ? Number(s.imgWidth) : undefined,
      imgHeight: isPositiveNumber(Number(s.imgHeight)) ? Number(s.imgHeight) : undefined,
    });
  }

  return cleaned;
}

// ------------------------------
// BATCH LOADING SPINNER (Preview)
// ------------------------------
function ensureLoadingSpinnerStyles() {
  if (document.getElementById(BATCH_LOADING_STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = BATCH_LOADING_STYLE_ID;
  style.textContent = `
    @keyframes wildshapeSpin { to { transform: rotate(360deg); } }
    #${BATCH_LOADING_ID} {
      position: absolute;
      inset: 0;
      display: none;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.25);
      border-radius: 8px;
      z-index: 5;
    }
    #${BATCH_LOADING_ID} .spinner {
      width: 28px;
      height: 28px;
      border: 3px solid rgba(255,255,255,0.25);
      border-top-color: rgba(255,255,255,0.9);
      border-radius: 999px;
      animation: wildshapeSpin 0.8s linear infinite;
    }
  `;
  document.head.appendChild(style);
}

function ensurePreviewLoadingUI() {
  ensureLoadingSpinnerStyles();

  const previewArea = document.getElementById("preview-area");
  if (!previewArea) return;

  if (getComputedStyle(previewArea).position === "static") {
    previewArea.style.position = "relative";
  }

  if (document.getElementById(BATCH_LOADING_ID)) return;

  const overlay = document.createElement("div");
  overlay.id = BATCH_LOADING_ID;
  overlay.innerHTML = `<div class="spinner"></div>`;
  previewArea.appendChild(overlay);
}

function setPreviewLoading(isLoading) {
  ensurePreviewLoadingUI();
  const overlay = document.getElementById(BATCH_LOADING_ID);
  if (overlay) overlay.style.display = isLoading ? "flex" : "none";
}

// ------------------------------
// TRANSFORM OPTIONS
// ------------------------------
const ALLOWED_SIZE_MODES = new Set(["tiny", "small", "medium", "large", "huge", "gargantuan"]);

function getSizeMode() {
  const sel = document.getElementById(SIZE_SELECT_ID);
  const fromUI = sel?.value;
  const fromStorage = localStorage.getItem(SIZE_PREF_KEY);
  const v = fromUI || fromStorage || "medium";
  return ALLOWED_SIZE_MODES.has(v) ? v : "medium";
}

function setSizeMode(v) {
  const safe = ALLOWED_SIZE_MODES.has(v) ? v : "medium";
  localStorage.setItem(SIZE_PREF_KEY, safe);
  const sel = document.getElementById(SIZE_SELECT_ID);
  if (sel) sel.value = safe;
}

function sizeModeToCells(mode) {
  switch (mode) {
    case "tiny":
      return 0.5;
    case "small":
      return 0.75;
    case "medium":
      return 1;
    case "large":
      return 2;
    case "huge":
      return 3;
    case "gargantuan":
      return 4;
    default:
      return 1;
  }
}

function getKeepFootprint() {
  return localStorage.getItem(KEEP_FOOTPRINT_KEY) === "true";
}
function setKeepFootprint(v) {
  localStorage.setItem(KEEP_FOOTPRINT_KEY, String(!!v));
  const cb = document.getElementById(KEEP_FOOTPRINT_ID);
  if (cb) cb.checked = !!v;
  syncSizingDisabledByKeepFootprint();
}

function getLabelPrefix() {
  return localStorage.getItem(LABEL_PREFIX_KEY) === "true";
}
function setLabelPrefix(v) {
  localStorage.setItem(LABEL_PREFIX_KEY, String(!!v));
  const cb = document.getElementById(LABEL_PREFIX_ID);
  if (cb) cb.checked = !!v;
}

function getTransformOptionsCollapsed() {
  return localStorage.getItem(TRANSFORM_OPTIONS_COLLAPSED_KEY) === "true";
}

function setTransformOptionsCollapsed(v) {
  localStorage.setItem(TRANSFORM_OPTIONS_COLLAPSED_KEY, String(!!v));
  const content = document.getElementById(TRANSFORM_OPTIONS_CONTENT_ID);
  const toggle = document.getElementById(TRANSFORM_OPTIONS_TOGGLE_ID);
  if (content) content.style.display = v ? "none" : "block";
  if (toggle) {
    toggle.setAttribute("aria-expanded", v ? "false" : "true");
    toggle.dataset.collapsed = v ? "true" : "false";
    const chev = toggle.querySelector(".ws-chevron");
    if (chev) chev.style.transform = v ? "rotate(0deg)" : "rotate(180deg)";
  }
}

// When Keep footprint is enabled, size dropdown is disabled AND ignored.
function syncSizingDisabledByKeepFootprint() {
  const keep = getKeepFootprint();
  const sel = document.getElementById(SIZE_SELECT_ID);
  const label = sel?.parentElement?.querySelector("label");

  if (sel) {
    sel.disabled = keep;
    sel.style.opacity = keep ? "0.55" : "1";
    sel.style.cursor = keep ? "not-allowed" : "pointer";
  }
  if (label) {
    label.style.opacity = keep ? "0.65" : "1";
  }
}

function ensureTransformSizingUI() {
  const transformView = document.getElementById("view-transform");
  if (!transformView) return;

  let wrap = document.getElementById(TRANSFORM_OPTIONS_WRAP_ID);
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = TRANSFORM_OPTIONS_WRAP_ID;
    wrap.className = "card";
    wrap.style.marginBottom = "10px";
    wrap.style.padding = "10px";

    const headerBtn = document.createElement("button");
    headerBtn.id = TRANSFORM_OPTIONS_TOGGLE_ID;
    headerBtn.type = "button";
    headerBtn.className = "ws-collapse-btn";
    headerBtn.style.width = "100%";
    headerBtn.style.display = "flex";
    headerBtn.style.alignItems = "center";
    headerBtn.style.justifyContent = "space-between";
    headerBtn.style.gap = "12px";
    headerBtn.style.background = "transparent";
    headerBtn.style.border = "none";
    headerBtn.style.padding = "0";
    headerBtn.style.cursor = "pointer";
    headerBtn.style.color = "var(--text-main)";

    const left = document.createElement("div");
    left.style.display = "flex";
    left.style.flexDirection = "column";
    left.style.alignItems = "flex-start";
    left.style.gap = "2px";

    const title = document.createElement("div");
    title.innerText = "Transform Options";
    title.style.fontWeight = "600";
    title.style.fontSize = "13px";

    const sub = document.createElement("div");
    sub.innerText = "Size, keep footprint, indicator";
    sub.style.fontSize = "11px";
    sub.style.opacity = "0.75";

    left.appendChild(title);
    left.appendChild(sub);

    const chevron = document.createElement("div");
    chevron.className = "ws-chevron";
    chevron.style.display = "flex";
    chevron.style.alignItems = "center";
    chevron.style.justifyContent = "center";
    chevron.style.opacity = "0.85";
    chevron.style.transition = "transform 120ms ease";
    chevron.innerHTML = ICON_CHEVRON;

    headerBtn.appendChild(left);
    headerBtn.appendChild(chevron);

    headerBtn.addEventListener("click", () => {
      const collapsed = getTransformOptionsCollapsed();
      setTransformOptionsCollapsed(!collapsed);
    });

    const content = document.createElement("div");
    content.id = TRANSFORM_OPTIONS_CONTENT_ID;
    content.style.marginTop = "10px";

    const row1 = document.createElement("div");
    row1.style.display = "flex";
    row1.style.alignItems = "center";
    row1.style.gap = "12px";
    row1.style.marginBottom = "10px";

    const label = document.createElement("label");
    label.innerText = "Target Size:";
    label.style.fontWeight = "600";
    label.style.fontSize = "13px";
    label.style.whiteSpace = "nowrap";
    label.style.marginBottom = "0";
    label.style.color = "var(--text-main)";

    const select = document.createElement("select");
    select.id = SIZE_SELECT_ID;
    select.style.width = "100%";
    select.style.padding = "6px";
    select.style.background = "var(--input-bg)";
    select.style.border = "1px solid var(--border-color)";
    select.style.borderRadius = "4px";
    select.style.color = "var(--text-main)";
    select.style.fontSize = "13px";
    select.style.outline = "none";

    // Keep footprint removed from dropdown.
    select.innerHTML = `
      <option value="tiny">Tiny</option>
      <option value="small">Small</option>
      <option value="medium">Medium (1x1)</option>
      <option value="large">Large (2x2)</option>
      <option value="huge">Huge (3x3)</option>
      <option value="gargantuan">Gargantuan (4x4)</option>
    `;

    select.value = getSizeMode();
    select.addEventListener("change", () => setSizeMode(select.value));

    row1.appendChild(label);
    row1.appendChild(select);

    const row2 = document.createElement("div");
    row2.style.display = "flex";
    row2.style.flexWrap = "wrap";
    row2.style.gap = "12px";
    row2.style.alignItems = "center";

    const mkToggle = (id, text) => {
      const l = document.createElement("label");
      l.style.display = "flex";
      l.style.alignItems = "center";
      l.style.gap = "8px";
      l.style.fontSize = "12px";
      l.style.color = "var(--text-main)";
      l.style.userSelect = "none";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.id = id;

      const span = document.createElement("span");
      span.innerText = text;

      l.appendChild(cb);
      l.appendChild(span);
      return { label: l, cb };
    };

    // This toggle does what "Keep footprint" used to do: preserve current footprint (swap art).
    const keepFootprint = mkToggle(KEEP_FOOTPRINT_ID, "Keep footprint (swap art)");
    keepFootprint.cb.checked = getKeepFootprint();
    keepFootprint.cb.addEventListener("change", () => {
      setKeepFootprint(keepFootprint.cb.checked);
      syncSizingDisabledByKeepFootprint();
    });

    const labelPrefix = mkToggle(LABEL_PREFIX_ID, "Wildshape indicator (🐾)");
    labelPrefix.cb.checked = getLabelPrefix();
    labelPrefix.cb.addEventListener("change", () => setLabelPrefix(labelPrefix.cb.checked));

    row2.appendChild(keepFootprint.label);
    row2.appendChild(labelPrefix.label);

    content.appendChild(row1);
    content.appendChild(row2);

    wrap.appendChild(headerBtn);
    wrap.appendChild(content);

    // Place within transform section
    const activeWrap = document.getElementById(ACTIVE_WRAP_ID);
    if (activeWrap && activeWrap.parentElement === transformView) {
      activeWrap.insertAdjacentElement("afterend", wrap);
    } else {
      transformView.insertBefore(wrap, transformView.firstChild);
    }

    const collapsed = getTransformOptionsCollapsed();
    headerBtn.setAttribute("aria-expanded", collapsed ? "false" : "true");
    headerBtn.dataset.collapsed = collapsed ? "true" : "false";
    content.style.display = collapsed ? "none" : "block";
    chevron.style.transform = collapsed ? "rotate(0deg)" : "rotate(180deg)";

    syncSizingDisabledByKeepFootprint();
  } else {
    const sel = document.getElementById(SIZE_SELECT_ID);
    if (sel) sel.value = getSizeMode();

    const keepCb = document.getElementById(KEEP_FOOTPRINT_ID);
    if (keepCb) keepCb.checked = getKeepFootprint();

    const prefCb = document.getElementById(LABEL_PREFIX_ID);
    if (prefCb) prefCb.checked = getLabelPrefix();

    setTransformOptionsCollapsed(getTransformOptionsCollapsed());
    syncSizingDisabledByKeepFootprint();
  }
}

// ------------------------------
// ACTIVE WILDSHAPES UI
// ------------------------------
function ensureActiveTransformedUI() {
  const transformView = document.getElementById("view-transform");
  if (!transformView) return;
  if (document.getElementById(ACTIVE_WRAP_ID)) return;

  const wrap = document.createElement("div");
  wrap.id = ACTIVE_WRAP_ID;
  wrap.className = "card";
  wrap.style.marginBottom = "10px";
  wrap.style.padding = "10px";

  const header = document.createElement("div");
  header.style.display = "flex";
  header.style.justifyContent = "space-between";
  header.style.alignItems = "center";
  header.style.marginBottom = "8px";

  const title = document.createElement("span");
  title.style.fontWeight = "600";
  title.style.fontSize = "13px";
  title.innerText = "Active Wild Shapes";

  const right = document.createElement("div");
  right.style.display = "flex";
  right.style.alignItems = "center";
  right.style.gap = "8px";

  const count = document.createElement("span");
  count.id = ACTIVE_COUNT_ID;
  count.style.fontSize = "11px";
  count.style.background = "var(--input-bg)";
  count.style.padding = "2px 6px";
  count.style.borderRadius = "4px";
  count.style.color = "var(--text-muted)";
  count.innerText = "0";

  const revertAll = document.createElement("button");
  revertAll.id = ACTIVE_REVERT_ALL_ID;
  revertAll.className = "danger";
  revertAll.style.padding = "6px 10px";
  revertAll.style.fontSize = "12px";
  revertAll.style.cursor = "pointer";
  revertAll.innerText = "Revert all";

  revertAll.addEventListener("click", async () => {
    if (!activeTransformed || activeTransformed.length === 0) return;
    const ok = window.confirm(`Revert ${activeTransformed.length} wildshaped token(s)?`);
    if (!ok) return;
    await restoreItems(activeTransformed.map((t) => t.id));
  });

  right.appendChild(count);
  right.appendChild(revertAll);

  header.appendChild(title);
  header.appendChild(right);
  wrap.appendChild(header);

  const empty = document.createElement("div");
  empty.id = ACTIVE_EMPTY_ID;
  empty.className = "small";
  empty.style.fontStyle = "italic";
  empty.innerText = "No tokens are currently wildshaped.";
  wrap.appendChild(empty);

  const list = document.createElement("div");
  list.id = ACTIVE_LIST_ID;
  list.className = "shape-container";
  list.style.display = "none";
  wrap.appendChild(list);

  transformView.insertBefore(wrap, transformView.firstChild);
}

function setActiveCount(n) {
  const el = document.getElementById(ACTIVE_COUNT_ID);
  if (el) el.innerText = `${n}`;

  const btn = document.getElementById(ACTIVE_REVERT_ALL_ID);
  if (btn) btn.disabled = !n;
}

function renderActiveTransformedList() {
  ensureActiveTransformedUI();

  const list = document.getElementById(ACTIVE_LIST_ID);
  const empty = document.getElementById(ACTIVE_EMPTY_ID);
  if (!list || !empty) return;

  if (!activeTransformed || activeTransformed.length === 0) {
    setActiveCount(0);
    empty.style.display = "block";
    list.style.display = "none";
    list.innerHTML = "";
    return;
  }

  setActiveCount(activeTransformed.length);
  empty.style.display = "none";
  list.style.display = "flex";
  list.innerHTML = "";

  for (const t of activeTransformed) {
    const row = document.createElement("div");
    row.className = "shape-card interactive";

    const safeName = t.baseName || "Wildshape";
    const form = t.formName ? `(${t.formName})` : "";

    row.innerHTML = `
      <img src="${t.thumbUrl}" class="shape-img">
      <div class="shape-info">
        <span class="shape-name">${safeName} <span style="opacity:.75; font-weight:500;">${form}</span></span>
        <span class="shape-size" style="opacity:.75;">Tap to select</span>
      </div>
      <button class="icon-btn danger-icon" title="Revert">
        ${ICON_REVERT}
      </button>
    `;

    row.addEventListener("click", async () => {
      try {
        ignoreNextSelectionChange = true;
        await OBR.player.select([t.id], true);
      } catch (_) {}
    });

    const btn = row.querySelector("button");
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await restoreItems([t.id]);
    });

    list.appendChild(row);
  }
}

function buildActiveFromSceneItems(items) {
  const actives = (items || [])
    .filter((it) => it?.layer === "CHARACTER" && isImage(it) && it.metadata?.[METADATA_ORIGINAL])
    .map((it) => {
      const original = it.metadata?.[METADATA_ORIGINAL] || {};
      const state = it.metadata?.[METADATA_STATE] || {};
      return {
        id: it.id,
        thumbUrl: original.url || it.image?.url || "",
        baseName: typeof original.name === "string" && original.name.trim() ? original.name.trim() : "",
        formName: typeof state.shapeName === "string" && state.shapeName.trim() ? state.shapeName.trim() : "",
      };
    });

  actives.sort((a, b) => (a.baseName || "").localeCompare(b.baseName || ""));
  activeTransformed = actives;
}

async function refreshActiveNow() {
  const items = await OBR.scene.items.getItems((item) => item.layer === "CHARACTER" && isImage(item));
  buildActiveFromSceneItems(items);
  if (isTransformViewActive()) renderActiveTransformedList();
}

// ------------------------------
// LIBRARY LAYOUT NORMALIZATION
// ------------------------------
function normalizeLibraryHelperText() {
  const libraryView = document.getElementById("view-library");
  if (!libraryView) return;
  if (document.getElementById("lib-helper-text")) return;

  const card = libraryView.querySelector(".card");
  const existingSmall = card?.querySelector("p.small");

  const helper = document.createElement("p");
  helper.id = "lib-helper-text";
  helper.className = "small";
  helper.style.marginTop = "0";
  helper.style.marginBottom = "10px";
  helper.style.opacity = "0.85";
  helper.innerText = existingSmall?.innerText || "Select a token on the map to use its image.";

  if (card) libraryView.insertBefore(helper, card);
  else libraryView.prepend(helper);

  if (existingSmall) existingSmall.style.display = "none";
}

function updateLibraryHelperText(text, color = "") {
  const libMsg = $("#lib-helper-text");
  if (!libMsg) return;
  libMsg.innerText = text;
  libMsg.style.color = color || "";
}

// ------------------------------
// UI (Batch + Buttons)
// ------------------------------
function ensureBatchUI() {
  const addBtn = $("#btn-add-shape");
  const skipBtn = $("#btn-skip");
  const cancelBtn = $("#btn-cancel-batch");
  const doneBtn = $("#btn-batch-done");
  const closeBtn = $("#btn-batch-close");
  const nameInput = $("#input-name");

  if (addBtn && !addBtn.dataset.bound) {
    addBtn.dataset.bound = "true";
    addBtn.addEventListener("click", onAddButtonClick);
  }
  if (skipBtn && !skipBtn.dataset.bound) {
    skipBtn.dataset.bound = "true";
    skipBtn.addEventListener("click", onSkipClick);
  }
  if (cancelBtn && !cancelBtn.dataset.bound) {
    cancelBtn.dataset.bound = "true";
    cancelBtn.addEventListener("click", cancelBatch);
  }
  if (doneBtn && !doneBtn.dataset.bound) {
    doneBtn.dataset.bound = "true";
    doneBtn.addEventListener("click", dismissBatchComplete);
  }
  if (closeBtn && !closeBtn.dataset.bound) {
    closeBtn.dataset.bound = "true";
    closeBtn.addEventListener("click", () => OBR.action.close());
  }

  if (nameInput && !nameInput.dataset.enterbound) {
    nameInput.dataset.enterbound = "true";
    nameInput.addEventListener("keydown", async (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        await onAddButtonClick();
      }
    });
    nameInput.addEventListener("input", () => {
      if (batch.active) syncBatchButtons();
      else syncSingleSaveButton();
    });
  }

  ensurePreviewLoadingUI();
}

function syncSingleSaveButton() {
  const addBtn = $("#btn-add-shape");
  const nameInput = $("#input-name");
  if (!addBtn) return;
  const canSave = !!currentSelectedImage && !!nameInput?.value?.trim();
  addBtn.disabled = !canSave;
}

function showBatchUI(show) {
  const status = $("#batch-status");
  const controls = $("#batch-controls");
  if (status) status.style.display = show ? "block" : "none";
  if (controls) controls.classList.toggle("hidden", !show);
  if (show) updateLibraryHelperText("Batch Mode: name each token, then Save & Next or Skip.");
}

function showBatchCompleteUI(show) {
  const done = $("#batch-complete");
  if (done) done.style.display = show ? "block" : "none";
}

function setLibraryFormEnabled(enabled) {
  const addBtn = $("#btn-add-shape");
  const nameInput = $("#input-name");
  const sizeInput = $("#input-size");
  const previewArea = $("#preview-area");
  if (addBtn) addBtn.disabled = !enabled;
  if (nameInput) nameInput.disabled = !enabled;
  if (sizeInput) sizeInput.disabled = !enabled;
  if (previewArea && !enabled) previewArea.style.display = "none";
}

// ------------------------------
// TABS HELPERS
// ------------------------------
function activateTab(targetId) {
  const tabs = document.querySelectorAll(".tab");
  const views = document.querySelectorAll(".view");

  views.forEach((v) => v.classList.add("hidden"));
  tabs.forEach((t) => t.classList.remove("active"));

  const tab = document.querySelector(`.tab[data-target="${targetId}"]`);
  const view = document.getElementById(targetId);

  if (tab) tab.classList.add("active");
  if (view) view.classList.remove("hidden");

  localStorage.setItem(ACTIVE_TAB_KEY, targetId);

  if (targetId === "view-transform") {
    ensureActiveTransformedUI();
    ensureTransformSizingUI();
    renderActiveTransformedList();
    void refreshActiveNow();
  }

  if (targetId === "view-library") {
    ensureBatchUI();
    normalizeLibraryHelperText();
    void OBR.player.getSelection().then(updateSelectionUI);
  }

  if (targetId === "view-summons") {
    ensureSummonsUI();
    renderActiveSummonsList();
    syncSummonUI(currentSelectionIds);
  }
}

function requestOpenTab(targetId) {
  localStorage.setItem(REQUEST_TAB_KEY, targetId);
  const view = document.getElementById(targetId);
  if (view) activateTab(targetId);
}

function sanitizeShapeName(name) {
  const raw = (name || "").trim();
  if (!raw) return "";
  return raw.replace(/^🐾\s+/g, "").trim();
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function buildUniqueSummonName(baseName) {
  const safeBase = sanitizeShapeName(baseName) || "Summon";
  const items = await OBR.scene.items.getItems((item) => item.layer === "CHARACTER" && item.text?.plainText);
  const matcher = new RegExp(`^${escapeRegex(safeBase)}(?:\\s(\\d+))?$`, "i");

  let maxSuffix = 0;
  for (const item of items) {
    const text = item.text?.plainText || "";
    const match = matcher.exec(text);
    if (match) {
      const suffix = Number(match[1] || 1);
      if (Number.isFinite(suffix)) {
        maxSuffix = Math.max(maxSuffix, suffix);
      }
    }
  }

  const next = maxSuffix + 1;
  return next === 1 ? safeBase : `${safeBase} ${next}`;
}

function getItemBounds(item) {
  const w = Number(item?.image?.width || 0) * Number(item?.scale?.x || 1);
  const h = Number(item?.image?.height || 0) * Number(item?.scale?.y || 1);
  return { w, h };
}

function isAreaFree(candidatePos, candidateSize, existingItems) {
  const halfW = (candidateSize?.w || 0) / 2;
  const halfH = (candidateSize?.h || 0) / 2;
  if (!Number.isFinite(halfW) || !Number.isFinite(halfH)) return true;

  for (const item of existingItems) {
    if (!item?.position || !item.image) continue;
    const { w, h } = getItemBounds(item);
    if (!w || !h) continue;

    const dx = Math.abs(item.position.x - candidatePos.x);
    const dy = Math.abs(item.position.y - candidatePos.y);
    if (dx < halfW + w / 2 && dy < halfH + h / 2) return false;
  }

  return true;
}

function cellSizeFromItem(item) {
  const dpi = Number(item?.grid?.dpi || 0);
  return dpi > 0 ? dpi : 100;
}

// ------------------------------
// OBR READY
// ------------------------------
OBR.onReady(async () => {
  console.log("[WildShape] Extension Ready");

  try {
    const iconUrl = await OBR.assets.getUrl("/icon.svg");
    await OBR.action.setIcon(iconUrl);
  } catch (e) {
    console.error("Failed to set action icon", e);
  }

  const app = $("#app");
  if (!app) return;

  setupTabs();
  ensureBatchUI();
  ensureActiveTransformedUI();
  ensureTransformSizingUI();
  ensureSummonsUI();
  normalizeLibraryHelperText();

  try {
    const role = await OBR.player.getRole();
    const libTab = $('.tab[data-target="view-library"]');
    if (libTab) {
      libTab.innerText = "Manage Library";
      if (role && role.toUpperCase() !== "GM") {
        libTab.style.display = "none";
        requestOpenTab("view-transform");
      }
    }
  } catch (e) {
    console.error(e);
  }

  try {
    const metadata = await OBR.room.getMetadata();
    const data = metadata?.[METADATA_LIBRARY];
    const cleaned = normalizeLibrary(data);

    availableShapes = cleaned;

    // If we cleaned anything, write it back once (safer metadata + removes junk).
    if (Array.isArray(data) && cleaned.length !== data.length) {
      await OBR.room.setMetadata({ [METADATA_LIBRARY]: cleaned });
    }

    renderShapeList();
    renderLibraryList();
    renderSummonSelectOptions();
  } catch (e) {
    console.error(e);
  }

  OBR.room.onMetadataChange((metadata) => {
    const data = metadata?.[METADATA_LIBRARY];
    availableShapes = normalizeLibrary(data);
    renderShapeList();
    renderLibraryList();
    renderSummonSelectOptions();
    syncSummonUI(currentSelectionIds);
  });

  OBR.scene.items.onChange((items) => {
    buildActiveFromSceneItems(items);
    if (isTransformViewActive()) renderActiveTransformedList();
    buildActiveSummonsFromScene(items);
    renderActiveSummonsList();
  });

  OBR.player.onChange((player) => {
    if (ignoreNextSelectionChange) {
      ignoreNextSelectionChange = false;
      return;
    }
    updateSelectionUI(player.selection);
  });

  // Apply any requested tab open (from background/context), else restore last tab
  const requested = localStorage.getItem(REQUEST_TAB_KEY) || localStorage.getItem(OPEN_TAB_KEY);
  if (requested) {
    localStorage.removeItem(REQUEST_TAB_KEY);
    localStorage.removeItem(OPEN_TAB_KEY);
    activateTab(requested);
  } else {
    const last = localStorage.getItem(ACTIVE_TAB_KEY);
    if (last) activateTab(last);
  }

  try {
    const storedPos = localStorage.getItem(REQUEST_SUMMON_POSITION_KEY);
    if (storedPos) {
      localStorage.removeItem(REQUEST_SUMMON_POSITION_KEY);
      const parsed = JSON.parse(storedPos);
      setPendingSummonPosition(parsed);
      activateTab("view-summons");
    }
  } catch (e) {
    console.error(e);
  }

  const selection = await OBR.player.getSelection();
  updateSelectionUI(selection);
  await refreshActiveNow();
  await refreshSummonsNow();
});

// ------------------------------
// CORE FUNCTIONS
// ------------------------------
async function applyShape(shape) {
  try {
    const ids = await OBR.player.getSelection();
    if (!ids || ids.length === 0) {
      OBR.notification.show("Select a token to transform first.", "WARNING");
      return;
    }

    const targetDims = await ensureShapeDims(shape);
    if (!targetDims || !targetDims.width || !targetDims.height) {
      OBR.notification.show("Could not read target image dimensions.", "ERROR");
      return;
    }

    const keepFootprint = getKeepFootprint();
    const addPrefix = getLabelPrefix();

    // Keep footprint ignores dropdown and preserves current footprint.
    const forcedCells = keepFootprint ? null : sizeModeToCells(getSizeMode());

    let playerName = "";
    try {
      playerName = await OBR.player.getName();
    } catch (_) {}

    await updateItemsByIds(ids, (items) => {
      for (const item of items) {
        if (!isImage(item) || !item.image || !item.grid) continue;
        item.metadata = item.metadata ?? {};

        if (!item.metadata[METADATA_ORIGINAL]) {
          item.metadata[METADATA_ORIGINAL] = {
            v: 1,
            capturedAt: Date.now(),
            url: item.image.url,
            imgWidth: item.image.width,
            imgHeight: item.image.height,
            gridDpi: item.grid.dpi,
            gridOffset: item.grid.offset,
            scale: safeCloneScale(item.scale),
            rotation: item.rotation,
            name: item.text?.plainText || "",
          };
        }

        item.metadata[METADATA_STATE] = {
          shapeId: shape.id,
          shapeName: shape.name,
          transformedAt: Date.now(),
          mode: forcedCells == null ? "keepFootprint" : "forcedSize",
        };

        const original = item.metadata[METADATA_ORIGINAL];

        const preImgW = Number(item.image.width || 1);
        const preGridDpi = Number(item.grid.dpi || 1);
        const preScale = safeCloneScale(item.scale);

        const currentCellsX = (preImgW / preGridDpi) * (preScale.x || 1);
        const desiredCells = forcedCells ?? currentCellsX;

        // Always update intrinsic size (prevents cropping issues)
        item.image.url = shape.url;
        item.image.width = targetDims.width;
        item.image.height = targetDims.height;

        if (forcedCells != null) {
          item.scale = { x: 1, y: 1 };
          item.grid.dpi = targetDims.width / desiredCells;
        } else {
          item.scale = { ...preScale };
          item.grid.dpi = targetDims.width / (desiredCells / (preScale.x || 1));
        }

        item.grid.offset = { x: targetDims.width / 2, y: targetDims.height / 2 };
        if (item.image.offset) delete item.image.offset;

        if (typeof original?.rotation === "number") item.rotation = original.rotation;

        // Indicator only: optional 🐾 prefix (no "(ShapeName)" suffix)
        const baseName =
          typeof original?.name === "string" && original.name.trim()
            ? original.name.trim()
            : (playerName || item.text?.plainText || "").trim();

        if (item.text) {
          let nextName = sanitizeShapeName(baseName);
          if (!nextName) nextName = baseName || "";
          if (addPrefix) {
            if (!nextName.startsWith("🐾 ")) nextName = `🐾 ${nextName}`;
          }
          item.text.plainText = nextName;
        }
      }
    });

    OBR.notification.show("Transformed");
  } catch (error) {
    console.error(error);
    OBR.notification.show("Error applying shape.", "ERROR");
  }
}

async function restoreItems(ids) {
  try {
    if (!Array.isArray(ids) || ids.length === 0) return;

    const items = await OBR.scene.items.getItems(ids);
    if (!items || items.length === 0) return;

    const restorableIds = [];
    let invalidCount = 0;

    for (const it of items) {
      if (!isImage(it) || !it.metadata?.[METADATA_ORIGINAL]) continue;
      const original = it.metadata[METADATA_ORIGINAL];
      if (validateOriginal(original)) restorableIds.push(it.id);
      else invalidCount++;
    }

    if (restorableIds.length === 0) {
      if (invalidCount > 0) {
        OBR.notification.show("Cannot safely revert: original data is missing or invalid.", "WARNING");
      }
      return;
    }

    await updateItemsByIds(restorableIds, (updateItems) => {
      for (const item of updateItems) {
        if (!isImage(item) || !item.image || !item.grid || !item.metadata) continue;

        const original = item.metadata[METADATA_ORIGINAL];
        if (!validateOriginal(original)) continue;

        if (original.url) item.image.url = original.url;
        if (typeof original.imgWidth === "number") item.image.width = original.imgWidth;
        if (typeof original.imgHeight === "number") item.image.height = original.imgHeight;
        if (typeof original.gridDpi === "number") item.grid.dpi = original.gridDpi;
        if (original.scale) item.scale = { ...original.scale };
        if (typeof original.rotation === "number") item.rotation = original.rotation;

        if (item.text && typeof original.name === "string") {
          item.text.plainText = original.name; // removes 🐾 too
        }

        const w = Number(original.imgWidth || item.image.width || 0);
        const h = Number(original.imgHeight || item.image.height || 0);
        if (original.gridOffset && !Array.isArray(original.gridOffset)) {
          item.grid.offset = original.gridOffset;
        } else if (w && h) {
          item.grid.offset = { x: w / 2, y: h / 2 };
        }

        delete item.metadata[METADATA_ORIGINAL];
        delete item.metadata[METADATA_STATE];
      }
    });

    const reverted = restorableIds.length;
    if (invalidCount > 0) {
      OBR.notification.show(`Reverted ${reverted}. Skipped ${invalidCount} (invalid original data).`, "WARNING");
    } else {
      OBR.notification.show("Reverted to original form");
    }
  } catch (error) {
    console.error(error);
    OBR.notification.show("Error reverting form.", "ERROR");
  }
}

// ------------------------------
// LIBRARY SAVE
// ------------------------------
async function onAddButtonClick() {
  // Explicit batch start only when user clicks (no auto-start on multiselect)
  if (!batch.active && isLibraryViewActive()) {
    const selection = await OBR.player.getSelection();
    if (selection && selection.length > 1) {
      startBatch(selection);
      return;
    }
  }

  if (batch.active) await saveBatchCurrentAndNext();
  else await saveShapeToLibrarySingle();
}

async function saveShapeToLibrarySingle() {
  const name = $("#input-name")?.value?.trim();
  const size = $("#input-size")?.value;
  if (!name) {
    OBR.notification.show("Name required.", "ERROR");
    return;
  }
  if (!currentSelectedImage) {
    OBR.notification.show("No selection.", "ERROR");
    return;
  }

  const selection = await OBR.player.getSelection();
  const items = await OBR.scene.items.getItems(selection);
  const item = items?.[0];

  const newShape = {
    v: 1,
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name,
    size: size || 1,
    url: currentSelectedImage,
    imgWidth: item?.image?.width,
    imgHeight: item?.image?.height,
  };

  const newLibrary = normalizeLibrary([...availableShapes, newShape]);
  await OBR.room.setMetadata({ [METADATA_LIBRARY]: newLibrary });

  if ($("#input-name")) $("#input-name").value = "";
  OBR.notification.show(`Added ${name} to library`);
}

async function deleteShape(shapeId) {
  const newLibrary = availableShapes.filter((s) => s.id !== shapeId);
  await OBR.room.setMetadata({ [METADATA_LIBRARY]: newLibrary });
}

// ------------------------------
// BATCH
// ------------------------------
function startBatch(selectionIds) {
  batch.active = true;
  batch.ids = [...selectionIds];
  batch.index = 0;
  batch.saved = 0;
  batch.skipped = 0;
  batch.complete = null;

  showBatchCompleteUI(false);
  showBatchUI(true);
  void loadBatchCurrentItem();
}

async function loadBatchCurrentItem() {
  const addBtn = $("#btn-add-shape");
  const nameInput = $("#input-name");
  const previewArea = $("#preview-area");
  const previewImg = $("#preview-img");
  const status = $("#batch-status");

  currentSelectedImage = null;

  if (previewArea) previewArea.style.display = "block";
  if (previewImg) previewImg.src = "";
  setPreviewLoading(true);

  if (status) status.innerText = `Batch Add: ${batch.index + 1} of ${batch.ids.length}`;

  const currentId = batch.ids[batch.index];
  if (!currentId) {
    setPreviewLoading(false);
    await finishBatch();
    return;
  }

  // IMPORTANT: do NOT force selection here (prevents breaking multiselect / moving tokens)
  const items = await OBR.scene.items.getItems([currentId]);
  const item = items?.[0];

  if (!item || !isImage(item) || !item.image?.url) {
    batch.skipped++;
    batch.index++;
    return await loadBatchCurrentItem();
  }

  currentSelectedImage = item.image.url;

  if (previewImg) {
    previewImg.onload = () => setPreviewLoading(false);
    previewImg.onerror = () => setPreviewLoading(false);
    previewImg.src = currentSelectedImage;
  } else {
    setPreviewLoading(false);
  }

  if (addBtn) addBtn.innerText = "Save & Next";

  if (nameInput) {
    nameInput.value = item.text?.plainText?.trim() || "";
    nameInput.focus();
    nameInput.select();
  }

  syncBatchButtons();
}

function syncBatchButtons() {
  const addBtn = $("#btn-add-shape");
  const nameInput = $("#input-name");
  const canSave = !!currentSelectedImage && !!nameInput?.value?.trim();
  if (addBtn) addBtn.disabled = !canSave;
  if ($("#btn-skip")) $("#btn-skip").disabled = false;
}

async function saveBatchCurrentAndNext() {
  const name = $("#input-name")?.value?.trim();
  const size = $("#input-size")?.value;
  if (!name) return;

  setPreviewLoading(true);

  const currentId = batch.ids[batch.index];
  const items = await OBR.scene.items.getItems([currentId]);
  const item = items?.[0];

  const newShape = {
    v: 1,
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name,
    size: size || 1,
    url: item.image.url,
    imgWidth: item.image.width,
    imgHeight: item.image.height,
  };

  const newLibrary = normalizeLibrary([...availableShapes, newShape]);
  await OBR.room.setMetadata({ [METADATA_LIBRARY]: newLibrary });

  batch.saved++;
  batch.index++;

  if ($("#input-name")) $("#input-name").value = "";

  if (batch.index >= batch.ids.length) {
    await finishBatch();
    return;
  }

  await loadBatchCurrentItem();
}

async function onSkipClick() {
  if (!batch.active) return;

  setPreviewLoading(true);

  batch.skipped++;
  batch.index++;

  if (batch.index >= batch.ids.length) {
    await finishBatch();
    return;
  }

  await loadBatchCurrentItem();
}

function cancelBatch() {
  batch.active = false;
  batch.ids = [];
  batch.index = 0;

  setPreviewLoading(false);

  showBatchUI(false);
  updateLibraryHelperText("Select a token on the map to use its image.");
  setLibraryFormEnabled(true);

  void OBR.player.getSelection().then(updateSelectionUI);
}

async function finishBatch() {
  setPreviewLoading(false);

  batch.active = false;
  batch.complete = { total: batch.ids.length, saved: batch.saved, skipped: batch.skipped };
  batch.ids = [];

  showBatchUI(false);
  setLibraryFormEnabled(true);

  if ($("#preview-area")) $("#preview-area").style.display = "none";

  if ($("#btn-add-shape")) {
    $("#btn-add-shape").disabled = true;
    $("#btn-add-shape").innerText = "Save to Library";
  }

  if ($("#input-name")) $("#input-name").value = "";

  updateLibraryHelperText("Batch complete. Your shapes are saved.", "#aaa");
  if ($("#batch-complete-msg")) $("#batch-complete-msg").innerText = `Processed ${batch.complete.total} token(s).`;
  showBatchCompleteUI(true);

  OBR.notification.show("Batch complete.");
}

function dismissBatchComplete() {
  showBatchCompleteUI(false);
  setLibraryFormEnabled(true);
  updateLibraryHelperText("Select a token on the map to use its image.");
  void OBR.player.getSelection().then(updateSelectionUI);
}

// ------------------------------
// SELECTION UI
// ------------------------------
async function updateSelectionUI(selection) {
  const libraryActive = isLibraryViewActive();
  normalizeLibraryHelperText();

  currentSelectionIds = Array.isArray(selection) ? [...selection] : [];

  if (batch.complete && libraryActive) {
    if (!selection || selection.length === 0) {
      showBatchCompleteUI(true);
      showBatchUI(false);
      setLibraryFormEnabled(false);
      return;
    } else {
      batch.complete = null;
      showBatchCompleteUI(false);
      setLibraryFormEnabled(true);
    }
  }

  const addBtn = $("#btn-add-shape");
  const nameInput = $("#input-name");
  const previewArea = $("#preview-area");
  const previewImg = $("#preview-img");

  if (!addBtn) return;
  currentSelectedImage = null;

  if (batch.active) {
    if (libraryActive) {
      showBatchUI(true);
      setLibraryFormEnabled(true);
      updateLibraryHelperText("Batch add mode: name each token...");
      await loadBatchCurrentItem();
    }
    return;
  }

  // MULTISELECT IN LIBRARY: DO NOT START BATCH AUTOMATICALLY
  if (libraryActive && selection && selection.length > 1) {
    showBatchUI(false);
    showBatchCompleteUI(false);
    setPreviewLoading(false);

    updateLibraryHelperText(
      `Multiple tokens selected (${selection.length}). You can move them together. Click "Start Batch Add" to save them to the library.`,
      "#aaa"
    );

    if (previewArea) previewArea.style.display = "none";
    if (nameInput) nameInput.value = "";

    addBtn.disabled = false;
    addBtn.innerText = "Start Batch Add";
    return;
  }

  showBatchUI(false);
  showBatchCompleteUI(false);
  setLibraryFormEnabled(true);

  setPreviewLoading(false);

  if (selection && selection.length > 0) {
    const items = await OBR.scene.items.getItems(selection);
    const item = items?.[0];

    if (item && isImage(item) && item.image) {
      if (item.metadata?.[METADATA_ORIGINAL]) {
        updateLibraryHelperText(
          "Cannot add: Token is already Transformed. Revert from the Active list or context menu.",
          "#ff6666"
        );
        addBtn.disabled = true;
        addBtn.innerText = "Revert First";
        if (previewArea) previewArea.style.display = "none";
        return;
      }

      updateLibraryHelperText("Select a token on the map to use its image.");
      addBtn.innerText = "Save to Library";

      currentSelectedImage = item.image.url;

      if (previewArea && previewImg) {
        previewArea.style.display = "block";
        previewImg.onload = () => setPreviewLoading(false);
        previewImg.onerror = () => setPreviewLoading(false);
        setPreviewLoading(true);
        previewImg.src = currentSelectedImage;
      }

      if (nameInput) {
        nameInput.value = item.text?.plainText?.trim() || "";
        if (libraryActive) {
          nameInput.focus();
          nameInput.select();
        }
      }

      syncSingleSaveButton();
    } else {
      updateLibraryHelperText("Select an Image Token");
      addBtn.disabled = true;
      if (previewArea) previewArea.style.display = "none";
    }
  } else {
    updateLibraryHelperText("Select a token on the map to use its image.");
    addBtn.disabled = true;
    addBtn.innerText = "Select a Token First";
    if (previewArea) previewArea.style.display = "none";
  }

  syncSummonUI(selection);
}

// ------------------------------
// SUMMONS
// ------------------------------
function setPendingSummonPosition(pos) {
  pendingSummonPosition = pos && typeof pos.x === "number" && typeof pos.y === "number" ? pos : null;
  const helper = $("#summon-helper");
  if (helper && pendingSummonPosition) {
    helper.innerText = "Summon will appear at the chosen map position.";
  }
  syncSummonUI(currentSelectionIds);
}

function renderSummonSelectOptions() {
  const select = $("#summon-select");
  if (!select) return;

  const prev = select.value;
  select.innerHTML = "";

  if (!availableShapes.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.innerText = "No creatures in library yet.";
    select.appendChild(opt);
    select.disabled = true;
    return;
  }

  select.disabled = false;

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.innerText = "Choose a familiar";
  select.appendChild(placeholder);

  availableShapes.forEach((shape) => {
    const opt = document.createElement("option");
    opt.value = shape.id;
    opt.innerText = shape.name || "Unnamed";
    select.appendChild(opt);
  });

  if (prev && availableShapes.some((s) => s.id === prev)) {
    select.value = prev;
  }
}

function syncSummonUI(selection) {
  const helper = $("#summon-helper");
  const summonBtn = $("#summon-btn");
  const select = $("#summon-select");

  const selectionIds = Array.isArray(selection) ? selection : currentSelectionIds;

  const hasSelection = selectionIds && selectionIds.length > 0;
  const hasPendingPoint = !!pendingSummonPosition;

  if (helper) {
    if (hasPendingPoint) {
      helper.innerText = "Summon will appear at the clicked position.";
    } else if (!hasSelection) {
      helper.innerText = "Select a token to summon adjacent.";
    } else if (selectionIds.length > 1) {
      helper.innerText = "Multiple tokens selected; using the first as summoner.";
    } else {
      helper.innerText = "Summon will appear adjacent to the selected token.";
    }
  }

  const hasChoice = !!select && !!select.value && !select.disabled;
  if (summonBtn) summonBtn.disabled = !hasChoice || (!hasSelection && !hasPendingPoint);
}

function buildActiveSummonsFromScene(items) {
  activeSummons = (items || [])
    .filter((it) => it.metadata?.[METADATA_SUMMON]?.createdBy === SUMMON_CREATED_BY)
    .map((it) => {
      const meta = it.metadata?.[METADATA_SUMMON] || {};
      return {
        id: it.id,
        name: it.text?.plainText || "Summon",
        thumbUrl: it.image?.url || "",
        summonerName: meta.summonerName || "",
      };
    });

  activeSummons.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

function renderActiveSummonsList() {
  const list = $("#summon-list");
  const empty = $("#summon-empty");
  const count = $("#summon-count");
  const unsummonAll = $("#summon-unsummon-all");

  if (!list || !empty || !count) return;

  list.innerHTML = "";

  if (!activeSummons.length) {
    empty.style.display = "block";
    count.innerText = "0";
    if (unsummonAll) unsummonAll.disabled = true;
    list.style.display = "none";
    return;
  }

  empty.style.display = "none";
  count.innerText = `${activeSummons.length}`;
  if (unsummonAll) unsummonAll.disabled = false;
  list.style.display = "flex";

  for (const s of activeSummons) {
    const row = document.createElement("div");
    row.className = "shape-card static";
    row.style.gridTemplateColumns = "40px 1fr 110px";

    const name = s.name || "Summon";
    const summonedBy = s.summonerName
      ? `<span class="shape-size" style="opacity:.8;">Summoned by ${s.summonerName}</span>`
      : "";

    row.innerHTML = `
      <img src="${s.thumbUrl}" class="shape-img">
      <div class="shape-info">
        <span class="shape-name">${name}</span>
        ${summonedBy}
      </div>
      <div style="display:flex; gap:6px;">
        <button class="primary" style="padding:6px 10px; width:auto;" data-action="select">Select</button>
        <button class="danger" style="padding:6px 10px; width:auto;" data-action="unsummon">Unsummon</button>
      </div>
    `;

    row.querySelector('[data-action="select"]').addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        await OBR.player.select([s.id], true);
      } catch (_) {}
    });

    row.querySelector('[data-action="unsummon"]').addEventListener("click", async (e) => {
      e.stopPropagation();
      await unsummonSummon(s.id);
    });

    list.appendChild(row);
  }
}

async function refreshSummonsNow() {
  const items = await OBR.scene.items.getItems();
  buildActiveSummonsFromScene(items);
  renderActiveSummonsList();
}

async function unsummonSummon(id) {
  if (!id) return;
  try {
    await OBR.scene.items.deleteItems([id]);
    await refreshSummonsNow();
  } catch (e) {
    console.error(e);
  }
}

async function unsummonAll() {
  try {
    const ids = activeSummons.map((s) => s.id);
    if (ids.length === 0) return;
    await OBR.scene.items.deleteItems(ids);
    await refreshSummonsNow();
  } catch (e) {
    console.error(e);
  }
}

async function handleSummonClick() {
  const select = $("#summon-select");
  if (!select || !select.value) return;

  const shape = availableShapes.find((s) => s.id === select.value);
  if (!shape || !shape.url) {
    OBR.notification.show("Choose a familiar with an image first.", "WARNING");
    return;
  }

  const dims = await ensureShapeDims(shape);
  if (!dims?.width || !dims?.height) {
    OBR.notification.show("Could not load familiar image.", "ERROR");
    return;
  }

  const summonName = await buildUniqueSummonName(shape.name || "Summon");

  let targetPos = pendingSummonPosition;
  let summonerItem = null;

  if (!targetPos) {
    if (!currentSelectionIds.length) {
      OBR.notification.show("Select a token to summon adjacent.", "WARNING");
      return;
    }

    const items = await OBR.scene.items.getItems([currentSelectionIds[0]]);
    summonerItem = items?.[0];
    if (!summonerItem?.position) {
      OBR.notification.show("Could not read summoner position.", "ERROR");
      return;
    }

    const cell = cellSizeFromItem(summonerItem);
    const offsets = [
      { x: cell, y: 0 },
      { x: -cell, y: 0 },
      { x: 0, y: cell },
      { x: 0, y: -cell },
    ];

    const existing = await OBR.scene.items.getItems((it) => it.layer === "CHARACTER");
    const candidateSize = { w: dims.width, h: dims.height };

    for (const off of offsets) {
      const candidate = { x: summonerItem.position.x + off.x, y: summonerItem.position.y + off.y };
      if (isAreaFree(candidate, candidateSize, existing)) {
        targetPos = candidate;
        break;
      }
    }

    if (!targetPos) {
      if (isAreaFree(summonerItem.position, { w: dims.width, h: dims.height }, existing)) {
        targetPos = { ...summonerItem.position };
      } else {
        OBR.notification.show("No space adjacent.", "WARNING");
        return;
      }
    }
  }

  const sizeCells = Number(shape.size || 1) || 1;
  const image = await OBR.scene.items.createImage({
    image: { url: shape.url, width: dims.width, height: dims.height },
    position: targetPos,
    scale: { x: 1, y: 1 },
    rotation: 0,
    text: { plainText: summonName },
    layer: "CHARACTER",
    metadata: {
      [METADATA_SUMMON]: {
        v: 1,
        createdBy: SUMMON_CREATED_BY,
        summonId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        libraryId: shape.id,
        summonerTokenId: summonerItem?.id,
        summonerName: summonerItem?.text?.plainText || "",
        createdAt: Date.now(),
      },
    },
    grid: {
      dpi: dims.width / sizeCells,
      offset: { x: dims.width / 2, y: dims.height / 2 },
    },
  });

  await OBR.scene.items.addItems([image]);
  await refreshSummonsNow();
  try {
    await OBR.player.select([image.id], true);
  } catch (_) {}

  pendingSummonPosition = null;
  renderActiveSummonsList();
  syncSummonUI(currentSelectionIds);
}

function ensureSummonsUI() {
  const summonBtn = $("#summon-btn");
  const select = $("#summon-select");
  const unsummonAllBtn = $("#summon-unsummon-all");

  if (summonBtn && !summonBtn.dataset.bound) {
    summonBtn.dataset.bound = "true";
    summonBtn.addEventListener("click", () => void handleSummonClick());
  }

  if (select && !select.dataset.bound) {
    select.dataset.bound = "true";
    select.addEventListener("change", () => syncSummonUI(currentSelectionIds));
  }

  if (unsummonAllBtn && !unsummonAllBtn.dataset.bound) {
    unsummonAllBtn.dataset.bound = "true";
    unsummonAllBtn.addEventListener("click", () => void unsummonAll());
  }

  renderSummonSelectOptions();
  renderActiveSummonsList();
  syncSummonUI(currentSelectionIds);
}

// ------------------------------
// RENDER
// ------------------------------
function renderShapeList() {
  const container = $("#shape-container");
  if (!container) return;

  container.innerHTML = "";

  if (!availableShapes.length) {
    container.innerHTML = "<p style='color:#777; font-style:italic; padding:10px;'>No shapes saved yet.</p>";
    return;
  }

  availableShapes.forEach((shape) => {
    const div = document.createElement("div");
    div.className = "shape-card interactive";
    div.innerHTML = `
      <img src="${shape.url}" class="shape-img">
      <div class="shape-info">
        <span class="shape-name">${shape.name}</span>
        <span class="shape-size">Size: ${shape.size || 1}x</span>
      </div>
      <div class="action-indicator" title="Transform">${ICON_TRANSFORM}</div>
    `;
    div.addEventListener("click", () => applyShape(shape));
    container.appendChild(div);
  });
}

function renderLibraryList() {
  const container = $("#library-list");
  if (!container) return;

  container.innerHTML = "";

  if (!availableShapes.length) {
    container.innerHTML = "<p style='color:#777; font-style:italic; padding:10px;'>No shapes saved yet.</p>";
    return;
  }

  availableShapes.forEach((shape) => {
    const div = document.createElement("div");
    div.className = "shape-card static";
    div.innerHTML = `
      <img src="${shape.url}" class="shape-img">
      <div class="shape-info"><span class="shape-name">${shape.name}</span></div>
      <button class="icon-btn danger-icon" title="Remove">${ICON_TRASH}</button>
    `;
    div.querySelector(".icon-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      deleteShape(shape.id);
    });
    container.appendChild(div);
  });
}

// ------------------------------
// TABS
// ------------------------------
function setupTabs() {
  const tabs = document.querySelectorAll(".tab");

  tabs.forEach((tab) => {
    tab.addEventListener("click", async () => {
      const targetId = tab.dataset.target;
      if (!targetId) return;
      activateTab(targetId);
    });
  });
}
