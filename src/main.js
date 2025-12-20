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
const ART_ONLY_KEY = `${ID}:artOnly`;
const ART_ONLY_ID = "wildshape-art-only-toggle";

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

// Active list UI ids (Summons Tab)
const SUMMONS_WRAP_ID = "wildshape-summons-wrap";
const SUMMONS_LIST_ID = "wildshape-summons-list";
const SUMMONS_EMPTY_ID = "wildshape-summons-empty";
const SUMMONS_COUNT_ID = "wildshape-summons-count";
const SUMMONS_UNSUMMON_ALL_ID = "wildshape-summons-unsummon-all";

// Batch preview loading spinner ids
const BATCH_LOADING_ID = "wildshape-batch-loading";
const BATCH_LOADING_STYLE_ID = "wildshape-batch-loading-style";

// Tabs
const ACTIVE_TAB_KEY = `${ID}:activeTab`;
const REQUEST_TAB_KEY = `${ID}:requestTab`;
const REQUEST_SUMMON_POSITION_KEY = `${ID}:summonPosition`;
const OPEN_TAB_KEY = `${ID}:openTab`;

let availableShapes = [];
let currentSelectedImage = null;
let activeSummons = [];
let activeTransformed = [];
let currentSelectionIds = [];
let pendingSummonPosition = null;
let tabsInitialized = false;
let appReady = false;

// Cache image dimensions by URL
const imageDimCache = new Map();

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
const ICON_TRANSFORM = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>`;
const ICON_TRASH = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>`;
const ICON_REVERT = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 1 1 0 12h-2"/></svg>`;
const ICON_CHEVRON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;
const ICON_SUMMON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/></svg>`;

// Helper to select elements
function $(sel) { return document.querySelector(sel); }
function uuid() { return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15); }
function isLibraryViewActive() { const v = document.getElementById("view-library"); return v && !v.classList.contains("hidden"); }
function isTransformViewActive() { const v = document.getElementById("view-transform"); return v && !v.classList.contains("hidden"); }
function isSummonsViewActive() { const v = document.getElementById("view-summons"); return v && !v.classList.contains("hidden"); }

// ------------------------------
// DATA HELPERS
// ------------------------------
async function updateItemsByIds(ids, updater) {
  if (!Array.isArray(ids) || ids.length === 0) return;
  const items = await OBR.scene.items.getItems(ids);
  if (!items || items.length === 0) return;
  await OBR.scene.items.updateItems(items, updater);
}

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
  if (shape?.imgWidth && shape?.imgHeight) return { width: Number(shape.imgWidth), height: Number(shape.imgHeight) };
  return await loadImageDimensions(shape?.url);
}

function safeCloneScale(s) {
  if (!s || typeof s.x !== "number" || typeof s.y !== "number") return { x: 1, y: 1 };
  return { x: s.x, y: s.y };
}

function isPositiveNumber(n) { return typeof n === "number" && Number.isFinite(n) && n > 0; }
function validateOriginal(o) {
  if (!o || typeof o !== "object") return false;
  if (!o.url || !isPositiveNumber(o.imgWidth) || !isPositiveNumber(o.imgHeight) || !isPositiveNumber(o.gridDpi)) return false;
  return true;
}

function normalizeLibrary(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const cleaned = [];
  for (const s of list) {
    if (!s.id || !s.url) continue;
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
// PREVIEW LOADER
// ------------------------------
function ensureLoadingSpinnerStyles() {
  if (document.getElementById(BATCH_LOADING_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = BATCH_LOADING_STYLE_ID;
  style.textContent = `
    @keyframes spin { to { transform: rotate(360deg); } }
    #${BATCH_LOADING_ID} {
      position: absolute; inset: 0; display: none;
      align-items: center; justify-content: center;
      background: rgba(0,0,0,0.4); border-radius: var(--radius-md); z-index: 5;
    }
    #${BATCH_LOADING_ID} .spinner {
      width: 24px; height: 24px; border: 3px solid rgba(255,255,255,0.25);
      border-top-color: #fff; border-radius: 999px; animation: spin 0.8s linear infinite;
    }
  `;
  document.head.appendChild(style);
}

function ensurePreviewLoadingUI() {
  ensureLoadingSpinnerStyles();
  const area = document.getElementById("preview-area");
  if (!area || document.getElementById(BATCH_LOADING_ID)) return;
  if (getComputedStyle(area).position === "static") area.style.position = "relative";
  const overlay = document.createElement("div");
  overlay.id = BATCH_LOADING_ID;
  overlay.innerHTML = `<div class="spinner"></div>`;
  area.appendChild(overlay);
}

function setPreviewLoading(isLoading) {
  ensurePreviewLoadingUI();
  const ov = document.getElementById(BATCH_LOADING_ID);
  if (ov) ov.style.display = isLoading ? "flex" : "none";
}

// ------------------------------
// TRANSFORM OPTIONS (UI)
// ------------------------------
function getSizeMode() {
  const v = document.getElementById(SIZE_SELECT_ID)?.value || localStorage.getItem(SIZE_PREF_KEY) || "medium";
  return v === "keep" ? "medium" : v;
}
function setSizeMode(v) {
  const safe = v === "keep" ? "medium" : v;
  localStorage.setItem(SIZE_PREF_KEY, safe);
  const el = document.getElementById(SIZE_SELECT_ID);
  if (el) el.value = safe;
}
function getArtOnly() { return localStorage.getItem(ART_ONLY_KEY) === "true"; }
function setArtOnly(v) {
  localStorage.setItem(ART_ONLY_KEY, String(!!v));
  const el = document.getElementById(ART_ONLY_ID);
  if (el) el.checked = !!v;
  syncSizingDisabledByArtOnly();
}
function getLabelPrefix() { return localStorage.getItem(LABEL_PREFIX_KEY) === "true"; }
function setLabelPrefix(v) {
  localStorage.setItem(LABEL_PREFIX_KEY, String(!!v));
  const el = document.getElementById(LABEL_PREFIX_ID);
  if (el) el.checked = !!v;
}
function getTransformOptionsCollapsed() { return localStorage.getItem(TRANSFORM_OPTIONS_COLLAPSED_KEY) === "true"; }
function setTransformOptionsCollapsed(v) {
  localStorage.setItem(TRANSFORM_OPTIONS_COLLAPSED_KEY, String(!!v));
  const content = document.getElementById(TRANSFORM_OPTIONS_CONTENT_ID);
  const toggle = document.getElementById(TRANSFORM_OPTIONS_TOGGLE_ID);
  if (content) content.style.display = v ? "none" : "block";
  if (toggle) {
    toggle.setAttribute("aria-expanded", v ? "false" : "true");
    const chev = toggle.querySelector(".ws-chevron");
    if (chev) chev.style.transform = v ? "rotate(0deg)" : "rotate(180deg)";
  }
}
function syncSizingDisabledByArtOnly() {
  const artOnly = getArtOnly();
  const sel = document.getElementById(SIZE_SELECT_ID);
  if (sel) {
    sel.disabled = artOnly;
    sel.parentElement.style.opacity = artOnly ? "0.5" : "1";
  }
}
function sizeModeToCells(mode) {
  switch (mode) {
    case "tiny": return 0.5;
    case "small": return 0.75;
    case "medium": return 1;
    case "large": return 2;
    case "huge": return 3;
    case "gargantuan": return 4;
    default: return 1;
  }
}

function ensureTransformSizingUI() {
  const view = document.getElementById("view-transform");
  if (!view || document.getElementById(TRANSFORM_OPTIONS_WRAP_ID)) return;

  const wrap = document.createElement("div");
  wrap.id = TRANSFORM_OPTIONS_WRAP_ID;
  wrap.className = "card"; 

  const header = document.createElement("button");
  header.id = TRANSFORM_OPTIONS_TOGGLE_ID;
  header.className = "ws-collapse-btn"; 
  header.style.display = "flex"; header.style.justifyContent = "space-between"; header.style.alignItems = "center"; header.style.width = "100%";
  
  const titleGroup = document.createElement("div");
  titleGroup.innerHTML = `<div class="panel-title">Transform Options</div><div class="small" style="margin:0; opacity:0.7;">Size & behavior settings</div>`;
  const chevron = document.createElement("div");
  chevron.className = "ws-chevron";
  chevron.innerHTML = ICON_CHEVRON;

  header.appendChild(titleGroup);
  header.appendChild(chevron);
  header.addEventListener("click", () => setTransformOptionsCollapsed(!getTransformOptionsCollapsed()));

  const content = document.createElement("div");
  content.id = TRANSFORM_OPTIONS_CONTENT_ID;
  content.style.marginTop = "12px";

  const row1 = document.createElement("div");
  row1.className = "input-group";
  const label = document.createElement("label");
  label.className = "input-label";
  label.innerText = "Target Size";
  const select = document.createElement("select");
  select.id = SIZE_SELECT_ID;
  
  const optStyle = "background-color: var(--bg-input); color: var(--text-main);";
  select.innerHTML = `
    <option value="tiny" style="${optStyle}">Tiny (0.5)</option>
    <option value="small" style="${optStyle}">Small (0.75)</option>
    <option value="medium" style="${optStyle}">Medium (1x1)</option>
    <option value="large" style="${optStyle}">Large (2x2)</option>
    <option value="huge" style="${optStyle}">Huge (3x3)</option>
    <option value="gargantuan" style="${optStyle}">Gargantuan (4x4)</option>
  `;
  select.value = getSizeMode();
  select.addEventListener("change", () => setSizeMode(select.value));
  row1.appendChild(label);
  row1.appendChild(select);

  const mkCheck = (id, txt, getter, setter) => {
    const l = document.createElement("label");
    l.style.display = "flex"; l.style.alignItems = "center"; l.style.gap = "8px"; l.style.cursor = "pointer"; l.style.marginBottom = "6px";
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.id = id; cb.checked = getter();
    cb.addEventListener("change", () => setter(cb.checked));
    const sp = document.createElement("span"); sp.innerText = txt; sp.style.fontSize="12px";
    l.appendChild(cb); l.appendChild(sp);
    return l;
  }

  const artRow = mkCheck(ART_ONLY_ID, "Keep footprint (Art swap only)", getArtOnly, (v) => { setArtOnly(v); syncSizingDisabledByArtOnly(); });
  const lblRow = mkCheck(LABEL_PREFIX_ID, "Add indicator (🐾) to name", getLabelPrefix, setLabelPrefix);

  content.appendChild(row1);
  content.appendChild(artRow);
  content.appendChild(lblRow);
  wrap.appendChild(header);
  wrap.appendChild(content);

  const activeWrap = document.getElementById(ACTIVE_WRAP_ID);
  if (activeWrap && activeWrap.parentElement === view) activeWrap.insertAdjacentElement("afterend", wrap);
  else view.insertBefore(wrap, view.firstChild);

  setTransformOptionsCollapsed(getTransformOptionsCollapsed());
  syncSizingDisabledByArtOnly();
}

function ensureActiveTransformedUI() {
  const view = document.getElementById("view-transform");
  if (!view || document.getElementById(ACTIVE_WRAP_ID)) return;

  const wrap = document.createElement("div");
  wrap.id = ACTIVE_WRAP_ID;
  wrap.className = "card";

  const header = document.createElement("div");
  header.className = "panel-header";
  
  const left = document.createElement("div");
  left.style.display = "flex"; left.style.alignItems = "center"; left.style.gap = "8px";
  left.innerHTML = `<span class="panel-title">Active Wild Shapes</span><span id="${ACTIVE_COUNT_ID}" class="badge">0</span>`;

  const revertBtn = document.createElement("button");
  revertBtn.id = ACTIVE_REVERT_ALL_ID;
  revertBtn.className = "danger";
  revertBtn.style.width = "auto"; revertBtn.style.padding = "2px 8px"; revertBtn.style.fontSize = "11px";
  revertBtn.innerText = "Revert All";
  revertBtn.addEventListener("click", async () => {
    if (activeTransformed.length && confirm(`Revert ${activeTransformed.length} tokens?`)) {
      await restoreItems(activeTransformed.map(t => t.id));
    }
  });

  header.appendChild(left);
  header.appendChild(revertBtn);

  const empty = document.createElement("div");
  empty.id = ACTIVE_EMPTY_ID;
  empty.className = "small"; 
  empty.style.fontStyle = "italic"; empty.style.opacity = "0.7";
  empty.innerText = "No active wildshapes.";

  const list = document.createElement("div");
  list.id = ACTIVE_LIST_ID;
  list.className = "shape-container";
  list.style.display = "none";

  wrap.appendChild(header);
  wrap.appendChild(empty);
  wrap.appendChild(list);

  view.insertBefore(wrap, view.firstChild);
}

// ------------------------------
// UI: SUMMONS TAB
// ------------------------------
function ensureSummonsUI() {
  const view = document.getElementById("view-summons");
  if (!view || document.getElementById(SUMMONS_WRAP_ID)) return;

  const wrap = document.createElement("div");
  wrap.id = SUMMONS_WRAP_ID;
  wrap.className = "card";

  const header = document.createElement("div");
  header.className = "panel-header";
  
  const left = document.createElement("div");
  left.style.display = "flex"; left.style.alignItems = "center"; left.style.gap = "8px";
  left.innerHTML = `<span class="panel-title">Active Summons</span><span id="${SUMMONS_COUNT_ID}" class="badge">0</span>`;

  const unsummonBtn = document.createElement("button");
  unsummonBtn.id = SUMMONS_UNSUMMON_ALL_ID;
  unsummonBtn.className = "danger";
  unsummonBtn.style.width = "auto"; unsummonBtn.style.padding = "2px 8px"; unsummonBtn.style.fontSize = "11px";
  unsummonBtn.innerText = "Unsummon All";
  unsummonBtn.addEventListener("click", async () => {
    if (activeSummons.length && confirm(`Unsummon ${activeSummons.length} tokens?`)) {
      await unsummonAll();
    }
  });

  header.appendChild(left);
  header.appendChild(unsummonBtn);

  const empty = document.createElement("div");
  empty.id = SUMMONS_EMPTY_ID;
  empty.className = "small"; 
  empty.style.fontStyle = "italic"; empty.style.opacity = "0.7";
  empty.innerText = "No active summons.";

  const list = document.createElement("div");
  list.id = SUMMONS_LIST_ID;
  list.className = "shape-container";
  list.style.display = "none";

  wrap.appendChild(header);
  wrap.appendChild(empty);
  wrap.appendChild(list);

  view.prepend(wrap);
}

// ------------------------------
// RENDERERS
// ------------------------------
function renderShapeList() {
  const container = $("#shape-container");
  if (!container) return;
  container.innerHTML = "";
  if (!availableShapes.length) {
    container.innerHTML = `<p class="helper-text" style="text-align:center; font-style:italic;">No shapes saved yet.</p>`;
    return;
  }
  availableShapes.forEach(s => {
    const div = document.createElement("div");
    div.className = "shape-card interactive";
    div.innerHTML = `
      <img src="${s.url}" class="shape-img">
      <div class="shape-info">
        <span class="shape-name">${s.name}</span>
        <span class="shape-size">Size: ${s.size || 1}x</span>
      </div>
      <div class="action-indicator" title="Transform">${ICON_TRANSFORM}</div>
    `;
    div.addEventListener("click", () => applyShape(s));
    container.appendChild(div);
  });
}

function renderAvailableSummonsList() {
  const container = $("#summons-available-list");
  if (!container) return;
  container.innerHTML = "";
  if (!availableShapes.length) {
    container.innerHTML = `<p class="helper-text" style="text-align:center; font-style:italic;">No creatures in library.</p>`;
    return;
  }
  availableShapes.forEach(s => {
    const div = document.createElement("div");
    div.className = "shape-card interactive";
    div.innerHTML = `
      <img src="${s.url}" class="shape-img">
      <div class="shape-info">
        <span class="shape-name">${s.name}</span>
        <span class="shape-size">Size: ${s.size || 1}x</span>
      </div>
      <div class="action-indicator" title="Summon">${ICON_SUMMON}</div>
    `;
    div.addEventListener("click", () => handleSummonClick(s));
    container.appendChild(div);
  });
}

function renderLibraryList() {
  const c = $("#library-list");
  if (!c) return;
  c.innerHTML = "";
  if (!availableShapes.length) {
    c.innerHTML = `<p class="helper-text" style="text-align:center; font-style:italic;">No shapes saved yet.</p>`;
    return;
  }
  availableShapes.forEach(s => {
    const div = document.createElement("div");
    div.className = "shape-card static";
    div.innerHTML = `
      <img src="${s.url}" class="shape-img">
      <div class="shape-info"><span class="shape-name">${s.name}</span></div>
      <button class="icon-btn danger-icon" title="Delete">${ICON_TRASH}</button>
    `;
    div.querySelector("button").addEventListener("click", (e) => {
      e.stopPropagation();
      deleteShape(s.id);
    });
    c.appendChild(div);
  });
}

// ------------------------------
// DATA SYNC & LISTS
// ------------------------------
function buildActiveFromSceneItems(items) {
  activeTransformed = (items || [])
    .filter(i => i.layer === "CHARACTER" && isImage(i) && i.metadata?.[METADATA_ORIGINAL])
    .map(i => {
      const orig = i.metadata[METADATA_ORIGINAL] || {};
      const st = i.metadata[METADATA_STATE] || {};
      return {
        id: i.id,
        thumbUrl: orig.url || i.image?.url || "",
        baseName: orig.name || "Unknown",
        formName: st.shapeName || ""
      };
    })
    .sort((a,b) => a.baseName.localeCompare(b.baseName));

  activeSummons = (items || [])
    .filter(i => i.metadata?.[METADATA_SUMMON]?.createdBy === SUMMON_CREATED_BY)
    .map(i => ({
      id: i.id,
      name: i.text?.plainText || "Summon",
      url: i.image?.url || "",
      summonerName: i.metadata[METADATA_SUMMON].summonerName || ""
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function renderActiveTransformedList() {
  ensureActiveTransformedUI();
  const list = document.getElementById(ACTIVE_LIST_ID);
  const empty = document.getElementById(ACTIVE_EMPTY_ID);
  const countEl = document.getElementById(ACTIVE_COUNT_ID);
  const revBtn = document.getElementById(ACTIVE_REVERT_ALL_ID);

  if (!list) return;
  if (countEl) countEl.innerText = activeTransformed.length;
  if (revBtn) revBtn.disabled = activeTransformed.length === 0;

  if (!activeTransformed.length) {
    empty.style.display = "block"; list.style.display = "none"; return;
  }
  empty.style.display = "none"; list.style.display = "flex"; list.innerHTML = "";

  activeTransformed.forEach(t => {
    const row = document.createElement("div");
    row.className = "shape-card interactive";
    const formTxt = t.formName ? ` <span style="opacity:0.6">(${t.formName})</span>` : "";
    
    row.innerHTML = `
      <img src="${t.thumbUrl}" class="shape-img">
      <div class="shape-info">
        <span class="shape-name">${t.baseName}${formTxt}</span>
        <span class="shape-size">Tap to select</span>
      </div>
      <button class="icon-btn danger-icon" title="Revert">${ICON_REVERT}</button>
    `;
    row.addEventListener("click", async () => {
      try { ignoreNextSelectionChange = true; await OBR.player.select([t.id], true); } catch {}
    });
    row.querySelector("button").addEventListener("click", async (e) => {
      e.stopPropagation(); await restoreItems([t.id]);
    });
    list.appendChild(row);
  });
}

function renderActiveSummonsList() {
  const list = document.getElementById(SUMMONS_LIST_ID);
  const empty = document.getElementById(SUMMONS_EMPTY_ID);
  const count = document.getElementById(SUMMONS_COUNT_ID);
  const unsummonAll = document.getElementById(SUMMONS_UNSUMMON_ALL_ID);

  if (!list) return;
  if (count) count.innerText = activeSummons.length;
  if (unsummonAll) unsummonAll.disabled = activeSummons.length === 0;

  if (!activeSummons.length) {
    empty.style.display = "block"; list.style.display = "none"; return;
  }
  empty.style.display = "none"; list.style.display = "flex"; list.innerHTML = "";

  activeSummons.forEach(s => {
    const row = document.createElement("div");
    row.className = "shape-card interactive";
    const summonedBy = s.summonerName ? ` <span style="opacity:0.6">(${s.summonerName})</span>` : "";

    row.innerHTML = `
      <img src="${s.url}" class="shape-img">
      <div class="shape-info">
        <span class="shape-name">${s.name}${summonedBy}</span>
        <span class="shape-size">Tap to select</span>
      </div>
      <button class="icon-btn danger-icon" title="Unsummon">${ICON_REVERT}</button>
    `;
    row.addEventListener("click", async () => {
      try { ignoreNextSelectionChange = true; await OBR.player.select([s.id], true); } catch {}
    });
    row.querySelector("button").addEventListener("click", async (e) => {
      e.stopPropagation(); await unsummonSummon(s.id);
    });
    list.appendChild(row);
  });
}

async function refreshActiveNow() {
  const items = await OBR.scene.items.getItems(i => i.layer === "CHARACTER" && isImage(i));
  buildActiveFromSceneItems(items);
  if (isTransformViewActive()) renderActiveTransformedList();
  if (isSummonsViewActive()) renderActiveSummonsList();
}

// ------------------------------
// UI HELPERS
// ------------------------------
function normalizeLibraryHelperText() {
  const view = document.getElementById("view-library");
  if (!view || document.getElementById("lib-helper-text")) return;
  const card = view.querySelector(".card");
  const p = document.createElement("p");
  p.id = "lib-helper-text";
  p.className = "helper-text";
  p.innerText = "Select a token to save.";
  if (card) view.insertBefore(p, card); else view.prepend(p);
  const old = card?.querySelector("p.small");
  if (old) old.style.display = "none";
}

function updateLibraryHelperText(text, color) {
  const el = document.getElementById("lib-helper-text");
  if (!el) return;
  el.innerText = text;
  el.style.color = color === "#ff6666" ? "var(--danger)" : (color || "var(--text-muted)");
}

function ensureBatchUI() {
  const addBtn = $("#btn-add-shape");
  const nameInput = $("#input-name");
  
  if (addBtn && !addBtn.dataset.bound) {
    addBtn.dataset.bound = "true";
    addBtn.addEventListener("click", onAddButtonClick);
  }
  
  if (nameInput && !nameInput.dataset.bound) {
    nameInput.dataset.bound = "true";
    nameInput.addEventListener("keydown", async (e) => {
      if (e.key === "Enter") { e.preventDefault(); await onAddButtonClick(); }
    });
    nameInput.addEventListener("input", () => {
      batch.active ? syncBatchButtons() : syncSingleSaveButton();
    });
  }

  $("#btn-skip")?.addEventListener("click", onSkipClick);
  $("#btn-cancel-batch")?.addEventListener("click", cancelBatch);
  $("#btn-batch-done")?.addEventListener("click", dismissBatchComplete);
  $("#btn-batch-close")?.addEventListener("click", () => OBR.action.close());

  ensurePreviewLoadingUI();
}

function syncSingleSaveButton() {
  const btn = $("#btn-add-shape");
  const input = $("#input-name");
  if (!btn) return;
  const valid = !!currentSelectedImage && !!input?.value?.trim();
  btn.disabled = !valid;
}

function showBatchUI(show) {
  const status = $("#batch-status");
  const controls = $("#batch-controls");
  if (status) status.style.display = show ? "block" : "none";
  if (controls) controls.classList.toggle("hidden", !show);
  if (show) updateLibraryHelperText("Batch Mode: Name tokens.", "var(--primary)");
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
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name,
    size: size || 1,
    url: item.image.url,
    imgWidth: item.image.width,
    imgHeight: item.image.height,
  };

  const newLibrary = [...availableShapes, newShape];
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
  if (batch.index >= batch.ids.length) { await finishBatch(); return; }
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

async function updateSelectionUI(selection) {
  const libActive = isLibraryViewActive();
  normalizeLibraryHelperText();
  currentSelectionIds = Array.isArray(selection) ? [...selection] : [];

  const addBtn = $("#btn-add-shape");
  const nameInput = $("#input-name");
  const preview = $("#preview-area");
  const pImg = $("#preview-img");

  if (!addBtn) return;
  currentSelectedImage = null;

  if (batch.active) return;

  if (libActive && selection?.length > 1) {
    updateLibraryHelperText(`${selection.length} tokens selected. Click "Start Batch Add".`, "var(--text-main)");
    addBtn.innerText = "Start Batch Add";
    addBtn.disabled = false;
    addBtn.onclick = () => startBatch(selection);
    if (preview) preview.style.display = "none";
    if (nameInput) nameInput.disabled = true;
    return;
  }

  addBtn.onclick = onAddButtonClick;
  if (nameInput) nameInput.disabled = false;

  showBatchUI(false);
  showBatchCompleteUI(false);
  setLibraryFormEnabled(true);
  setPreviewLoading(false);

  if (selection && selection.length === 1) {
    const items = await OBR.scene.items.getItems(selection);
    const item = items[0];
    if (item && isImage(item) && item.image) {
      if (item.metadata?.[METADATA_ORIGINAL]) {
        updateLibraryHelperText("Token is already Transformed.", "var(--danger)");
        addBtn.disabled = true;
        addBtn.innerText = "Cannot Save";
        if (preview) preview.style.display = "none";
      } else {
        updateLibraryHelperText("Ready to save.", "var(--text-main)");
        addBtn.innerText = "Save to Library";
        currentSelectedImage = item.image.url;
        if (preview && pImg) {
          preview.style.display = "block";
          pImg.onload = () => setPreviewLoading(false);
          setPreviewLoading(true);
          pImg.src = currentSelectedImage;
        }
        if (nameInput) {
          if (libActive && nameInput.value === "") nameInput.value = item.text?.plainText || "";
        }
        syncSingleSaveButton();
      }
    } else {
      updateLibraryHelperText("Select an Image Token.");
      addBtn.disabled = true;
      if (preview) preview.style.display = "none";
    }
  } else {
    updateLibraryHelperText("Select a token on the map.");
    addBtn.disabled = true;
    addBtn.innerText = "Select Token";
    if (preview) preview.style.display = "none";
  }
}

async function handleSummonClick(shape) {
  if (pendingSummonPosition) {
    await summonCreature(shape, { type: "at", position: pendingSummonPosition });
    pendingSummonPosition = null;
    return;
  }
  if (!currentSelectionIds.length) {
    OBR.notification.show("Select a token to summon adjacent.", "WARNING");
    return;
  }
  const items = await OBR.scene.items.getItems([currentSelectionIds[0]]);
  const summoner = items[0];
  if (!summoner) return;
  await summonCreature(shape, { type: "adjacent", summoner });
}

function cellSizeFromItem(item) {
  const dpi = Number(item?.grid?.dpi || 0);
  return dpi > 0 ? dpi : 150;
}

function getItemBounds(item) {
  const w = Number(item?.image?.width || 0) * Number(item?.scale?.x || 1);
  const h = Number(item?.image?.height || 0) * Number(item?.scale?.y || 1);
  return { w, h };
}

function isAreaFree(candidatePos, candidateSize, existingItems) {
  const halfW = (candidateSize?.w || 0) / 2;
  const halfH = (candidateSize?.h || 0) / 2;
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

async function unsummonSummon(id) {
  if (id) await OBR.scene.items.deleteItems([id]);
}

async function unsummonAll() {
  if (!activeSummons.length) return;
  await OBR.scene.items.deleteItems(activeSummons.map(s => s.id));
}

async function handleContextMenuSummon(context) {
  await OBR.action.open();
  activateTab("view-summons");
  OBR.notification.show("Select creature to summon.");
}

function setupTabs() {
  if (tabsInitialized) return;
  const tabs = document.querySelectorAll(".tab");
  tabs.forEach(t => {
    t.addEventListener("click", () => activateTab(t.dataset.target));
  });
  tabsInitialized = true;
}

function activateTab(targetId) {
  const tabs = document.querySelectorAll(".tab");
  const views = document.querySelectorAll(".view");
  
  views.forEach(v => v.classList.add("hidden"));
  tabs.forEach(t => t.classList.remove("active"));

  const tab = document.querySelector(`.tab[data-target="${targetId}"]`);
  const view = document.getElementById(targetId);

  if (tab) tab.classList.add("active");
  if (view) view.classList.remove("hidden");

  localStorage.setItem(ACTIVE_TAB_KEY, targetId);

  if (!appReady) return;

  if (targetId === "view-transform") {
    ensureActiveTransformedUI(); ensureTransformSizingUI(); renderActiveTransformedList(); void refreshActiveNow();
  }
  if (targetId === "view-summons") {
    ensureSummonsUI(); renderAvailableSummonsList(); renderActiveSummonsList(); void refreshActiveNow();
  }
  if (targetId === "view-library") {
    ensureBatchUI(); normalizeLibraryHelperText(); void OBR.player.getSelection().then(updateSelectionUI);
  }
}

function resolveRequestedTab() {
  const requested = localStorage.getItem(OPEN_TAB_KEY) || localStorage.getItem(REQUEST_TAB_KEY);
  if (requested) {
    localStorage.removeItem(OPEN_TAB_KEY);
    localStorage.removeItem(REQUEST_TAB_KEY);
    return requested;
  }
  return localStorage.getItem(ACTIVE_TAB_KEY);
}

OBR.onReady(async () => {
  console.log("[WildShape] Ready");

  OBR.contextMenu.create({
    id: `${ID}/open-menu`,
    icons: [{ icon: "/icon.svg", label: "Wild Shape", filter: { every: [{ key: "layer", value: "CHARACTER" }] } }],
    onClick: async () => await OBR.action.open(),
  });

  OBR.contextMenu.create({
    id: `${ID}/summon-familiar`,
    icons: [{ icon: "/icon.svg", label: "Summon Familiar", filter: { every: [{ key: "layer", value: "CHARACTER" }] } }],
    onClick: handleContextMenuSummon,
  });

  OBR.contextMenu.create({
    id: `${ID}/revert`,
    icons: [{ icon: "/revert.svg", label: "Revert Form", filter: { every: [{ key: "layer", value: "CHARACTER" }, { key: ["metadata", METADATA_ORIGINAL], operator: "!=", value: undefined }] } }],
    onClick: handleRevert,
  });

  if (!$("#app")) return;

  setupTabs();
  ensureTransformSizingUI();
  ensureActiveTransformedUI();
  ensureBatchUI();
  ensureSummonsUI();
  normalizeLibraryHelperText();

  try {
    const role = await OBR.player.getRole();
    const libTab = $('.tab[data-target="view-library"]');
    if (libTab) {
      libTab.innerText = "Library";
      if (role && role.toUpperCase() !== "GM") {
        libTab.style.display = "none";
        if (localStorage.getItem(ACTIVE_TAB_KEY) === "view-library") activateTab("view-transform");
      }
    }
  } catch (e) { console.error(e); }

  const meta = await OBR.room.getMetadata();
  availableShapes = normalizeLibrary(meta?.[METADATA_LIBRARY] || []);
  renderShapeList(); renderLibraryList(); renderAvailableSummonsList();

  OBR.room.onMetadataChange(m => {
    availableShapes = normalizeLibrary(m?.[METADATA_LIBRARY] || []);
    renderShapeList(); renderLibraryList(); renderAvailableSummonsList();
  });

  OBR.scene.items.onChange(items => {
    buildActiveFromSceneItems(items);
    if (isTransformViewActive()) renderActiveTransformedList();
    if (isSummonsViewActive()) renderActiveSummonsList();
  });

  OBR.player.onChange(p => {
    if (!ignoreNextSelectionChange) updateSelectionUI(p.selection);
    else ignoreNextSelectionChange = false;
  });

  appReady = true;

  setupTabs();

  const initialTab = resolveRequestedTab() || "view-transform";
  activateTab(initialTab);

  const s = await OBR.player.getSelection();
  updateSelectionUI(s);
  await refreshActiveNow();
});

document.addEventListener("DOMContentLoaded", () => {
  if (!$("#app")) return;
  setupTabs();
  const savedTab = localStorage.getItem(ACTIVE_TAB_KEY) || "view-transform";
  activateTab(savedTab);
});
