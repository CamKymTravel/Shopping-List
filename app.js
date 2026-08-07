import { CATEGORIES } from "./data.js";
import {
  openDatabase, getAll, getRecord, getItemLibrary, toggleLocalItem, createCustomItem,
  updateCustomItem, deleteCustomItem, getCombinedShoppingList, setItemStatus,
  changeLocalQuantity, changeLocalStore, removeLocalItem, finishShopping, getMealSuggestions,
  createMealSuggestion, removeMealSuggestion, getSummary, getPeople, getOwner,
  savePerson, deletePerson, createTransferPayload, validateTransferPayload,
  previewTransfer, acceptTransfer, exportFullBackup, validateBackup, restoreFullBackup,
  getPinState, setSettingsPin, clearSettingsPin, verifySettingsPin,
  getAccessibilitySettings, setAccessibilitySettings, consumeRestoreNotice,
  hidePresetItem, restorePresetItem
} from "./db.js";

const main = document.querySelector("#main-content");
const backButton = document.querySelector("#back-button");
const homeButton = document.querySelector("#home-button");
const settingsButton = document.querySelector("#settings-button");
const title = document.querySelector("#header-title");
const subtitle = document.querySelector("#header-subtitle");
const toastRegion = document.querySelector("#toast-region");
const confirmDialog = document.querySelector("#confirm-dialog");
const customItemDialog = document.querySelector("#custom-item-dialog");
const customItemForm = document.querySelector("#custom-item-form");
const personDialog = document.querySelector("#person-dialog");
const personForm = document.querySelector("#person-form");
const personPhotoInput = document.querySelector("#person-photo-input");
const receiveFileInput = document.querySelector("#receive-file-input");
const restoreFileInput = document.querySelector("#restore-file-input");
const updateRegion = document.querySelector("#update-region");
const APP_BUILD = "0.6.8";

const state = {
  route: "home",
  previousRoute: "home",
  selectedCategoryId: null,
  itemSearch: "",
  categoryEditMode: false,
  statusFilter: "active",
  settingsUnlocked: false,
  pendingTransfer: null,
  pendingTransferPreview: null,
  lastImportResult: null,
  updateRegistration: null,
  refreshingForUpdate: false
};

const SETTINGS_ROUTES = new Set(["settings", "people", "custom-items", "data-tools", "accessibility"]);
const ROUTES = {
  home: { title: "Our Shopping List", subtitle: "Easy to read. Easy to use.", render: renderHome },
  add: { title: "My Weekly List", subtitle: "Tap items we need", render: renderAddItems },
  shopping: { title: "Shopping List", subtitle: "Everything still needed", render: renderShopping },
  status: { title: "This Week’s Shop", subtitle: "See items by shopping status", render: renderStatusBreakdown },
  meals: { title: "Meal Ideas", subtitle: "Shared by everyone", render: renderMeals },
  transfer: { title: "Send or Receive", subtitle: "Simple list transfer", render: renderTransfer },
  send: { title: "Send My List", subtitle: "Text message or copy", render: renderSend },
  receive: { title: "Receive a List", subtitle: "Paste and check the list", render: renderReceive },
  "receive-preview": { title: "Check This List", subtitle: "Review before updating", render: renderReceivePreview },
  "receive-success": { title: "List Updated", subtitle: "The transfer is complete", render: renderReceiveSuccess },
  "copy-success": { title: "List Copied", subtitle: "Open the app on your other device", render: renderCopySuccess },
  settings: { title: "Settings", subtitle: "People, items and backup", render: renderSettings },
  people: { title: "People", subtitle: "Everyone you can send to", render: renderPeople },
  "custom-items": { title: "Custom Items", subtitle: "Change your saved items", render: renderCustomItems },
  "data-tools": { title: "Backup and Restore", subtitle: "Protect your local data", render: renderDataTools },
  accessibility: { title: "Accessibility", subtitle: "Keep the app easy to read", render: renderAccessibility }
};

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>'"]/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  }[character]));
}

const SHOP_STORES = ["Coles", "Woolworths", "Aldi", "Either"];

function storeDisplayName(store) {
  return store === "Either" ? "Any Store" : store === "Aldi" ? "ALDI" : store;
}

function storeBrandMarkup(store, compact = false) {
  const safeStore = SHOP_STORES.includes(store) ? store : "Either";
  if (safeStore === "Either") {
    return `<span class="store-brand-badge store-brand-any ${compact ? "is-compact" : ""}"><span class="store-any-icon" aria-hidden="true">🛒</span><span>Any Store</span></span>`;
  }
  const asset = safeStore === "Coles" ? "coles-logo.svg" : safeStore === "Woolworths" ? "woolworths-logo.svg" : "aldi-logo.png";
  return `<span class="store-brand-badge store-brand-${safeStore.toLowerCase()} ${compact ? "is-compact" : ""}"><img src="./${asset}" alt="${escapeHTML(storeDisplayName(safeStore))}"></span>`;
}

function storeChoiceButtons(itemId, currentStore) {
  const selected = SHOP_STORES.includes(currentStore) ? currentStore : "Coles";
  return `<div class="store-choice-grid" role="group" aria-label="Choose a store">${SHOP_STORES.map(store => `
    <button type="button" class="store-choice-button ${store === selected ? "is-selected" : ""}" data-store-choice-item="${escapeHTML(itemId)}" data-store-value="${store}" aria-pressed="${store === selected}">${storeBrandMarkup(store, true)}</button>`).join("")}</div>`;
}

function shoppingStoreMarkup(row) {
  if (row.store !== "Different") return storeBrandMarkup(row.store, true);
  const stores = [...new Set(row.requesterStores.map(entry => entry.store || "Either"))];
  return `<span class="store-mixed-badge" aria-label="Different stores">${stores.map(store => storeBrandMarkup(store, true)).join("")}</span>`;
}

function safePhoto(value) {
  return typeof value === "string" && value.length <= 2_500_000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/i.test(value) ? value : "";
}

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  return (parts.slice(0, 2).map(part => part[0]).join("") || "👤").toUpperCase();
}

function avatarMarkup(person, large = false) {
  const photo = safePhoto(person?.photo);
  const className = `person-avatar${large ? " person-avatar-large" : ""}`;
  if (photo) return `<span class="${className}"><img src="${photo}" alt=""></span>`;
  return `<span class="${className}" aria-hidden="true">${escapeHTML(initials(person?.name))}</span>`;
}

function routeTo(route, options = {}) {
  if (!ROUTES[route]) route = "home";
  if (SETTINGS_ROUTES.has(state.route) && !SETTINGS_ROUTES.has(route)) state.settingsUnlocked = false;
  if (state.route !== route) state.previousRoute = state.route;
  state.route = route;
  if (options.categoryId !== undefined) {
    if (state.selectedCategoryId !== options.categoryId) state.categoryEditMode = false;
    state.selectedCategoryId = options.categoryId;
  }
  if (route !== "add") state.categoryEditMode = false;
  if (route === "home") {
    state.selectedCategoryId = null;
    state.itemSearch = "";
  }
  history.replaceState({ route }, "", `#${route}`);
  renderRoute();
}

async function applyAccessibility() {
  const settings = await getAccessibilitySettings();
  document.documentElement.classList.toggle("extra-large-text", settings.extraLargeText !== false);
}

async function renderRoute() {
  const route = ROUTES[state.route];
  title.textContent = route.title;
  subtitle.textContent = route.subtitle;
  backButton.classList.toggle("is-hidden", state.route === "home");
  settingsButton.classList.toggle("is-hidden", SETTINGS_ROUTES.has(state.route));
  main.setAttribute("aria-busy", "true");
  try {
    if (SETTINGS_ROUTES.has(state.route)) {
      const pinState = await getPinState();
      if (pinState.enabled && !state.settingsUnlocked) {
        await renderSettingsLock();
      } else {
        await route.render();
      }
    } else {
      await route.render();
    }
    main.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "auto" });
  } catch (error) {
    console.error(error);
    main.innerHTML = `<section class="screen"><div class="empty-card"><div class="empty-icon">⚠️</div><h2>Something went wrong</h2><p>${escapeHTML(error.message || "Please try again.")}</p><button class="button button-primary" data-route="home">Return Home</button></div></section>`;
  } finally {
    main.removeAttribute("aria-busy");
  }
}

function showToast(message, duration = 3000) {
  toastRegion.innerHTML = `<div class="toast" role="status">${escapeHTML(message)}</div>`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toastRegion.innerHTML = ""; }, duration);
}

function confirmAction({ title: heading, message, confirmText = "Confirm", danger = true }) {
  document.querySelector("#confirm-title").textContent = heading;
  document.querySelector("#confirm-message").textContent = message;
  const action = document.querySelector("#confirm-action");
  action.textContent = confirmText;
  action.className = `button ${danger ? "button-danger" : "button-success"}`;
  confirmDialog.returnValue = "";
  confirmDialog.showModal();
  return new Promise(resolve => {
    const close = () => {
      confirmDialog.removeEventListener("close", close);
      resolve(confirmDialog.returnValue === "confirm");
    };
    confirmDialog.addEventListener("close", close);
  });
}

function categoryStyle(category) {
  return `--accent:${category?.accent || "#18873a"};--tint:${category?.tint || "#eef9ed"}`;
}

function fileDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function readJSONFile(file, maximumBytes = 10_000_000) {
  if (!file) throw new Error("No file was selected.");
  if (file.size > maximumBytes) throw new Error("This file is too large to open safely.");
  try {
    return JSON.parse(await file.text());
  } catch {
    throw new Error("This file could not be read. Please choose the original list or backup file.");
  }
}

function makeTransferFile(payload) {
  const safeName = String(payload.sender.name || "shopping-list").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "shopping-list";
  const filename = `${safeName}-${fileDate()}.shoppinglist`;
  const text = JSON.stringify(payload, null, 2);
  return new File([text], filename, { type: "application/json" });
}


const TRANSFER_TEXT_PREFIX = "OURSHOPPINGLIST1:";

function bytesToBase64Url(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function transferText(payload) {
  const encoded = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  return [
    `OUR SHOPPING LIST from ${payload.sender.name}`,
    "",
    "To update your app:",
    "1. Copy this whole message.",
    "2. Open Our Shopping List.",
    "3. Tap Receive a List, then Paste and Check.",
    "",
    `${TRANSFER_TEXT_PREFIX}${encoded}`
  ].join("\n");
}

function parseTransferText(value) {
  const text = String(value || "").trim();
  if (!text) throw new Error("Nothing was pasted. Copy the shopping-list message first.");
  if (text.startsWith("{")) {
    try { return validateTransferPayload(JSON.parse(text)); }
    catch { throw new Error("The pasted text is not a valid shopping list."); }
  }
  const match = text.match(/OURSHOPPINGLIST1:([A-Za-z0-9_-]+)/);
  if (!match) throw new Error("This message does not contain an Our Shopping List update.");
  let payload;
  try {
    const json = new TextDecoder().decode(base64UrlToBytes(match[1]));
    payload = JSON.parse(json);
  } catch {
    throw new Error("The copied shopping-list message is incomplete. Copy the whole message and try again.");
  }
  return validateTransferPayload(payload);
}

async function writeClipboardText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  const copied = document.execCommand("copy");
  area.remove();
  if (!copied) throw new Error("This device could not copy the list automatically.");
}

async function loadPendingTransfer(payload) {
  state.pendingTransfer = validateTransferPayload(payload);
  state.pendingTransferPreview = await previewTransfer(state.pendingTransfer);
  routeTo("receive-preview");
}

function transferSummary(payload) {
  const grouped = new Map();
  payload.items.filter(row => ["active", "got", "unavailable"].includes(row.status)).forEach(row => {
    const key = row.item.itemDefinitionId || `${row.item.categoryId}:${String(row.item.name).trim().toLowerCase()}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  });
  const lines = [...grouped.values()].map(rows => {
    const explicitRows = rows.filter(row => Number.isFinite(row.explicitQuantity) && row.explicitQuantity > 0);
    const quantity = explicitRows.length ? explicitRows.reduce((total, row) => total + row.explicitQuantity, 0) : 1;
    const stores = [...new Set(rows.map(row => row.store || "Either"))];
    const store = stores.length === 1 ? stores[0] : "Different stores";
    const statuses = new Set(rows.map(row => row.status));
    const status = statuses.size > 1
      ? "Mixed status"
      : statuses.has("got")
        ? "Got It"
        : statuses.has("unavailable")
          ? "Couldn’t Get"
          : "";
    return `• ${rows[0].item.name}${quantity > 1 ? ` — quantity ${quantity}` : ""}${store !== "Either" ? ` — ${store}` : ""}${status ? ` — ${status}` : ""}`;
  });
  const visible = lines.slice(0, 30);
  if (lines.length > visible.length) visible.push(`• Plus ${lines.length - visible.length} more items`);
  const mealLines = payload.mealSuggestions.slice(0, 20).map(row => `• ${row.name} — suggested by ${row.requesterName || payload.sender.name}`);
  if (payload.mealSuggestions.length > mealLines.length) mealLines.push(`• Plus ${payload.mealSuggestions.length - mealLines.length} more meal ideas`);
  const sections = [`Our Shopping List from ${payload.sender.name}`, "", ...(visible.length ? visible : ["No items needed."])];
  if (mealLines.length) sections.push("", "Meal Ideas", ...mealLines);
  return sections.join("\n");
}

async function renderHome() {
  const [summary, owner] = await Promise.all([getSummary(), getOwner()]);
  main.innerHTML = `
    <section class="screen" aria-labelledby="home-summary-title">
      <div class="summary-card">
        <h1 id="home-summary-title">This Week’s Shop</h1>
        <div class="summary-grid">
          <button class="summary-stat need" data-summary-status="active" aria-label="View ${summary.need} items still needed"><span>Still Need</span><strong>${summary.need}</strong></button>
          <button class="summary-stat got" data-summary-status="got" aria-label="View ${summary.got} items marked Got It"><span>Got It</span><strong>${summary.got}</strong></button>
          <button class="summary-stat missed" data-summary-status="unavailable" aria-label="View ${summary.unavailable} items marked Couldn’t Get"><span>Couldn’t Get</span><strong>${summary.unavailable}</strong></button>
        </div>
      </div>
      ${owner ? "" : `<div class="setup-card"><strong>First time here?</strong><span>Add your name once so you can send lists between people and devices.</span><button class="button button-primary button-wide" data-route="people">Set Up My Profile</button></div>`}
      <nav class="primary-actions" aria-label="Main actions">
        <button class="home-action action-blue" data-route="add"><span class="action-icon">＋</span><span>Add What We Need</span><span class="action-arrow">›</span></button>
        <button class="home-action action-purple" data-route="shopping"><span class="action-icon">📋</span><span>View Shopping List</span><span class="action-arrow">›</span></button>
        <button class="home-action action-green" data-route="transfer"><span class="action-icon">👥</span><span>Send or Receive a List</span><span class="action-arrow">›</span></button>
        <button class="home-action action-orange" data-route="meals"><span class="action-icon">🍽️</span><span>Meal Ideas</span><span class="action-arrow">›</span></button>
      </nav>
    </section>`;
}

async function renderAddItems() {
  const { categories, items, hiddenItems, selectedIds, localContributions } = await getItemLibrary();
  const selectedCategory = categories.find(category => category.id === state.selectedCategoryId);
  const localByItem = new Map((localContributions || []).map(row => [row.itemId, row]));
  if (!selectedCategory) {
    state.categoryEditMode = false;
    main.innerHTML = `
      <section class="screen">
        <h1 class="section-heading">Add What We Need</h1>
        <p class="section-subtitle">Choose a shopping category.</p>
        <div class="category-grid">
          ${categories.map(category => {
            const count = [...items, ...hiddenItems].filter(item => item.categoryId === category.id && selectedIds.has(item.id)).length;
            return `<button class="category-card" style="${categoryStyle(category)}" data-category="${category.id}">
              <span class="category-emoji" aria-hidden="true">${category.emoji}</span>
              <span class="category-name-row"><span class="category-name">${escapeHTML(category.shortName)}</span><span class="category-count">${count}</span></span>
            </button>`;
          }).join("")}
        </div>
        <div class="sticky-actions"><button class="button button-success button-wide" data-route="shopping">🛒 Open Shopping List</button></div>
      </section>`;
    return;
  }

  const filter = state.itemSearch.trim().toLowerCase();
  const alphabetical = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  const allCategoryItems = items.filter(item => item.categoryId === selectedCategory.id).sort(alphabetical);
  const categoryItems = allCategoryItems.filter(item => !filter || item.name.toLowerCase().includes(filter));
  const removedItems = hiddenItems.filter(item => item.categoryId === selectedCategory.id).sort(alphabetical);
  const editMode = state.categoryEditMode;
  main.innerHTML = `
    <section class="screen">
      <button class="text-button align-left" data-category-back>‹ All Categories</button>
      <div class="category-edit-heading">
        <div>
          <h1 class="section-heading">${escapeHTML(selectedCategory.name)}</h1>
          <p class="section-subtitle">${editMode ? "Remove items you never buy. Items always stay in alphabetical order." : "Tap an item, then set its quantity and store here."}</p>
        </div>
        <button class="button ${editMode ? "button-success" : "button-secondary"} category-edit-button" data-toggle-category-edit>${editMode ? "✓ Done" : "✏️ Edit List"}</button>
      </div>
      ${editMode ? `<div class="notice-card compact-notice"><strong>Editing this category</strong><span>Items are automatically alphabetical. Removing an item only hides it from this category.</span></div>` : ""}
      <div class="panel" style="${categoryStyle(selectedCategory)}" aria-labelledby="selected-category-heading">
        <div class="panel-header"><span class="panel-emoji" aria-hidden="true">${selectedCategory.emoji}</span><strong id="selected-category-heading">${escapeHTML(selectedCategory.name)}</strong><span class="panel-count">${categoryItems.length} items</span></div>
        <div class="panel-body">
          <div class="list-toolbar"><input class="search-field" id="item-search" type="search" placeholder="Search this category" value="${escapeHTML(state.itemSearch)}" aria-label="Search ${escapeHTML(selectedCategory.name)}"></div>
          ${categoryItems.length ? categoryItems.map((item) => {
            const selected = selectedIds.has(item.id);
            const local = localByItem.get(item.id);
            const localQuantity = local && Number.isFinite(local.explicitQuantity) && local.explicitQuantity > 0 ? Number(local.explicitQuantity) : 1;
            const store = local?.store || item.defaultStore || "Coles";
            if (editMode) return `
            <div class="item-row category-management-row">
              <div class="item-copy"><div class="item-name">${escapeHTML(item.name)}</div><div class="item-meta">${item.isCustom ? "Custom item" : "Built-in item"} • ${escapeHTML(storeDisplayName(item.defaultStore || "Coles"))}</div></div>
              <div class="category-item-actions">
                ${item.isCustom
                  ? `<button class="button button-secondary" data-edit-custom="${item.id}">Edit</button><button class="button button-danger" data-delete-custom="${item.id}">Delete</button>`
                  : `<button class="button button-danger" data-hide-preset="${item.id}">Remove</button>`}
              </div>
            </div>`;
            return `
            <div class="item-row selectable-item-row ${selected ? "is-selected" : ""}">
              <button class="item-select" style="--accent:${selectedCategory.accent}" data-toggle-item="${item.id}" aria-pressed="${selected}" aria-label="${selected ? "Remove" : "Add"} ${escapeHTML(item.name)}">${selected ? "✓" : ""}</button>
              <div class="item-copy"><div class="item-name">${escapeHTML(item.name)}</div>${item.isCustom ? '<div class="item-meta">Custom item</div>' : ""}</div>
              ${selected ? storeBrandMarkup(store, true) : ""}
              ${selected ? `<div class="item-entry-controls">
                <div class="entry-control-section">
                  <span class="entry-control-label">Quantity</span>
                  <span class="quantity-control entry-quantity-control"><button data-quantity="${item.id}" data-delta="-1" aria-label="Reduce quantity of ${escapeHTML(item.name)}">−</button><output aria-label="Quantity of ${escapeHTML(item.name)}">${localQuantity}</output><button data-quantity="${item.id}" data-delta="1" aria-label="Increase quantity of ${escapeHTML(item.name)}">+</button></span>
                </div>
                <div class="entry-control-section entry-store-section">
                  <span class="entry-control-label">Shop at</span>
                  ${storeChoiceButtons(item.id, store)}
                </div>
              </div>` : ""}
            </div>`;
          }).join("") : `<div class="empty-card borderless"><div class="empty-icon">${editMode ? "📝" : "🔎"}</div><h2>${editMode ? "No visible items" : "No matching items"}</h2><p>${editMode ? "Restore a removed item below or add a custom item." : "Try a different search or add a custom item."}</p></div>`}
        </div>
      </div>
      ${editMode && removedItems.length ? `
        <section class="panel removed-items-panel" aria-labelledby="removed-items-heading">
          <div class="panel-header"><span class="panel-emoji" aria-hidden="true">↩️</span><strong id="removed-items-heading">Removed Items</strong><span class="panel-count">${removedItems.length}</span></div>
          <div class="panel-body">
            ${removedItems.map(item => `<div class="item-row category-management-row restored-item-row"><div class="item-copy"><div class="item-name">${escapeHTML(item.name)}</div><div class="item-meta">Hidden from ${escapeHTML(selectedCategory.name)}</div></div><div class="category-item-actions"><button class="button button-secondary" data-restore-preset="${item.id}">Restore</button></div></div>`).join("")}
          </div>
        </section>` : ""}
      <div class="sticky-actions">
        <button class="button button-primary button-wide" data-custom-item="${selectedCategory.id}">＋ Add Custom Item</button>
        ${editMode ? `<button class="button button-success button-wide" data-toggle-category-edit>✓ Done Editing</button>` : `<button class="button button-success button-wide" data-route="shopping">🛒 Open Shopping List</button>`}
      </div>
    </section>`;
  const search = document.querySelector("#item-search");
  search?.addEventListener("input", event => {
    state.itemSearch = event.target.value;
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(renderAddItems, 120);
  });
}

async function renderShopping() {
  const [combined, meals] = await Promise.all([getCombinedShoppingList(), getMealSuggestions()]);
  const active = combined.filter(row => row.status === "active");
  const got = combined.filter(row => row.status === "got");
  const unavailable = combined.filter(row => row.status === "unavailable");
  const grouped = new Map();
  for (const row of active) {
    if (!grouped.has(row.item.categoryId)) grouped.set(row.item.categoryId, []);
    grouped.get(row.item.categoryId).push(row);
  }

  main.innerHTML = `
    <section class="screen">
      <div class="summary-card compact-summary"><h1>${active.length} ${active.length === 1 ? "item" : "items"} to buy</h1></div>
      <button class="meal-shortcut-button" data-route="meals"><span aria-hidden="true">🍽️</span><span><strong>View Meal Ideas</strong><small>${meals.length} shared ${meals.length === 1 ? "idea" : "ideas"}</small></span><span aria-hidden="true">›</span></button>
      ${active.length ? [...grouped.entries()].map(([categoryId, rows]) => {
        const category = rows[0].category || CATEGORIES.find(row => row.id === categoryId);
        const sortedRows = [...rows].sort((a, b) => a.item.name.localeCompare(b.item.name, undefined, { sensitivity: "base" }));
        return `<section class="panel shopping-category" style="${categoryStyle(category)}" aria-labelledby="shopping-category-${escapeHTML(category.id)}">
          <div class="panel-header"><span class="panel-emoji" aria-hidden="true">${category.emoji}</span><strong id="shopping-category-${escapeHTML(category.id)}">${escapeHTML(category.name)}</strong><span class="panel-count">${rows.length}</span></div>
          ${sortedRows.map(row => renderShoppingRow(row, category)).join("")}
        </section>`;
      }).join("") : `<div class="empty-card"><div class="empty-icon">🛒</div><h2>Your shopping list is empty</h2><p>Tap Add What We Need to choose some items.</p><button class="button button-primary" data-route="add">Add What We Need</button></div>`}
      <details class="collapsible-summary got">
        <summary><span>✓</span><span>Got It</span><span class="status-count">${got.length}</span></summary>
        <div class="status-list">${got.length ? got.map(row => renderStatusRow(row, "got")).join("") : "<p>No items marked Got It yet.</p>"}</div>
      </details>
      <details class="collapsible-summary missed">
        <summary><span>✕</span><span>Couldn’t Get</span><span class="status-count">${unavailable.length}</span></summary>
        <div class="status-list">${unavailable.length ? unavailable.map(row => renderStatusRow(row, "unavailable")).join("") : "<p>No unavailable items.</p>"}</div>
      </details>
      ${(got.length || unavailable.length) ? `<div class="result-reminder"><strong>Shopping for somebody else?</strong><span>Send the list now if they need to see what you got or couldn’t get. Finish Shopping clears the Got It results from this device.</span><button class="button button-secondary button-wide" data-route="send">📤 Send List or Results</button></div><div class="sticky-actions"><button class="button button-success button-wide" data-finish-shopping>✓ Finish Shopping</button></div>` : ""}
    </section>`;
}

async function renderStatusBreakdown() {
  const combined = await getCombinedShoppingList();
  const status = ["active", "got", "unavailable"].includes(state.statusFilter) ? state.statusFilter : "active";
  const labels = {
    active: { title: "Still Need", empty: "Nothing still needed", icon: "🛒", className: "need" },
    got: { title: "Got It", empty: "Nothing marked Got It", icon: "✓", className: "got" },
    unavailable: { title: "Couldn’t Get", empty: "Nothing marked Couldn’t Get", icon: "✕", className: "missed" }
  };
  const meta = labels[status];
  const rows = combined.filter(row => row.status === status);
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.item.categoryId)) grouped.set(row.item.categoryId, []);
    grouped.get(row.item.categoryId).push(row);
  }
  const orderedGroups = [...grouped.entries()].sort((a, b) => {
    const ai = CATEGORIES.findIndex(category => category.id === a[0]);
    const bi = CATEGORIES.findIndex(category => category.id === b[0]);
    return ai - bi;
  });

  main.innerHTML = `
    <section class="screen status-breakdown-screen">
      <div class="summary-card compact-summary status-breakdown-summary ${meta.className}">
        <h1>${escapeHTML(meta.title)}</h1>
        <strong class="status-breakdown-count">${rows.length}</strong>
        <p>${rows.length === 1 ? "1 item" : `${rows.length} items`}</p>
      </div>
      ${rows.length ? orderedGroups.map(([categoryId, groupRows]) => {
        const category = groupRows[0].category || CATEGORIES.find(row => row.id === categoryId);
        const sortedRows = [...groupRows].sort((a, b) => a.item.name.localeCompare(b.item.name, undefined, { sensitivity: "base" }));
        return `<section class="panel shopping-category" style="${categoryStyle(category)}">
          <div class="panel-header"><span class="panel-emoji" aria-hidden="true">${category.emoji}</span><strong>${escapeHTML(category.name)}</strong><span class="panel-count">${sortedRows.length}</span></div>
          ${status === "active"
            ? sortedRows.map(row => renderShoppingRow(row, category)).join("")
            : `<div class="status-list">${sortedRows.map(row => renderStatusRow(row, status)).join("")}</div>`}
        </section>`;
      }).join("") : `<div class="empty-card"><div class="empty-icon">${meta.icon}</div><h2>${escapeHTML(meta.empty)}</h2><p>Press Back to return to the Home screen.</p></div>`}
    </section>`;
}

function renderShoppingRow(row, category) {
  const requesters = row.requesters.length ? row.requesters.join(" • ") : "Me";
  const differentStores = row.store === "Different"
    ? `<div class="shopping-store-detail">${row.requesterStores.map(entry => `${escapeHTML(entry.name)}: ${escapeHTML(storeDisplayName(entry.store))}`).join(" • ")}</div>`
    : "";
  return `<div class="shopping-row compact-shopping-row">
    <button class="shopping-status-button got-status-button" style="--accent:${category.accent}" data-status-item="${row.itemId}" data-status="got" aria-label="Mark ${escapeHTML(row.item.name)} Got It"><span aria-hidden="true">✓</span><small>Got</small></button>
    <div class="item-copy shopping-item-copy">
      <div class="item-name">${escapeHTML(row.item.name)}</div>
      <div class="requesters">${escapeHTML(requesters)}</div>
      <div class="shopping-readonly-meta">${row.quantity > 1 ? `<span class="quantity-badge">×${row.quantity}</span>` : ""}${shoppingStoreMarkup(row)}</div>
      ${differentStores}
    </div>
    <button class="shopping-status-button missed-status-button" data-status-item="${row.itemId}" data-status="unavailable" aria-label="Mark ${escapeHTML(row.item.name)} Couldn’t Get"><span aria-hidden="true">×</span><small>Couldn't<br>Get</small></button>
  </div>`;
}

function renderStatusRow(row, currentStatus) {
  const hasLocal = row.contributions.some(contribution => contribution.sourceType === "local");
  const removeButton = currentStatus === "unavailable" && hasLocal ? `<button class="remove-request-button compact-remove" data-remove-local="${row.itemId}">Remove Mine</button>` : "";
  return `<div class="status-list-row"><span><strong>${escapeHTML(row.item.name)}</strong><br><small>${escapeHTML(row.requesters.join(" • ") || "Me")}</small></span><div class="status-row-actions"><button class="undo-button" data-status-item="${row.itemId}" data-status="active" aria-label="Undo status for ${escapeHTML(row.item.name)}">Undo</button>${removeButton}</div></div>`;
}

async function renderMeals() {
  const [saved, owner] = await Promise.all([getMealSuggestions(), getOwner()]);
  if (!owner) {
    main.innerHTML = `<section class="screen"><div class="empty-card"><div class="empty-icon">👤</div><h2>Set up your profile first</h2><p>Your name and photo show who suggested each meal.</p><button class="button button-primary" data-route="people">Set Up My Profile</button></div></section>`;
    return;
  }
  main.innerHTML = `
    <section class="screen">
      <h1 class="section-heading">Meal Ideas</h1>
      <p class="section-subtitle">Anyone can add a meal name. Add any ingredients you need separately to the shopping list.</p>
      <div class="panel meal-entry-panel">
        <div class="panel-body padded-panel">
          <label for="custom-meal"><strong>Add a meal idea</strong></label>
          <input class="search-field" id="custom-meal" maxlength="80" autocomplete="off" placeholder="Example: Chicken salad">
          <button class="button button-primary button-wide top-gap" data-add-meal>Add Meal Idea</button>
        </div>
      </div>
      <section class="panel meal-list-panel">
        <div class="panel-header"><span class="panel-emoji" aria-hidden="true">🍽️</span><strong>Everyone’s Meal Ideas</strong><span class="panel-count">${saved.length}</span></div>
        <div class="saved-meals">${saved.length ? saved.map(row => `<article class="saved-meal-row">
          ${avatarMarkup({ name: row.displayRequesterName, photo: row.displayRequesterPhoto })}
          <span class="saved-meal-copy"><strong>${escapeHTML(row.name)}</strong><small>Suggested by ${escapeHTML(row.displayRequesterName)}</small></span>
          ${row.sourceType === "local" ? `<button class="undo-button" data-remove-meal="${row.id}" aria-label="Remove ${escapeHTML(row.name)} from my meal ideas">Remove Mine</button>` : ""}
        </article>`).join("") : `<div class="meal-empty-state"><span aria-hidden="true">🍽️</span><strong>No meal ideas yet</strong><p>Type the first meal idea above.</p></div>`}</div>
      </section>
    </section>`;
}

async function renderTransfer() {
  const owner = await getOwner();
  main.innerHTML = `
    <section class="screen">
      <h1 class="section-heading">Send or Receive a List</h1>
      <p class="section-subtitle">Choose one large button. The easiest iPad-to-iPhone method is first.</p>
      <div class="transfer-choice-grid transfer-simple-grid">
        <button class="transfer-choice self-copy-choice" data-copy-self ${owner ? "" : "disabled"}><span aria-hidden="true">📱</span><strong>Copy List to My Phone</strong><small>On your iPad, copy the list. Then open this app on your iPhone and tap Receive a List.</small></button>
        <button class="transfer-choice send-choice" data-route="send"><span aria-hidden="true">💬</span><strong>Send List to Someone</strong><small>Choose a saved person, then send the prepared list by text message.</small></button>
        <button class="transfer-choice receive-choice" data-route="receive"><span aria-hidden="true">📥</span><strong>Receive a List</strong><small>Paste a copied list from Messages or from your other Apple device.</small></button>
      </div>
      ${owner ? "" : `<div class="notice-card"><strong>Set up My Profile first</strong><span>Your name is needed before this device can copy or send a list.</span><button class="button button-primary button-wide" data-route="people">Set Up My Profile</button></div>`}
    </section>`;
}

async function renderSend() {
  const [owner, people, combined, meals] = await Promise.all([getOwner(), getPeople(), getCombinedShoppingList(), getMealSuggestions()]);
  if (!owner) {
    main.innerHTML = `<section class="screen"><div class="empty-card"><div class="empty-icon">👤</div><h2>Set up your profile first</h2><p>Your name identifies who sent the list.</p><button class="button button-primary" data-route="people">Set Up My Profile</button></div></section>`;
    return;
  }
  main.innerHTML = `
    <section class="screen">
      <div class="summary-card compact-summary"><h1>${combined.length} ${combined.length === 1 ? "item" : "items"} and ${meals.length} meal ${meals.length === 1 ? "idea" : "ideas"} ready to send</h1></div>
      <h2 class="section-heading smaller-heading">Who are you sending to?</h2>
      <p class="section-subtitle">Tap one large green button. Shopping items and meal ideas travel together.</p>
      <div class="people-list send-people-list">
        ${people.length ? people.map(person => `<article class="person-card send-person-card">
          ${avatarMarkup(person)}
          <div class="person-card-copy"><strong>${escapeHTML(person.name)}</strong>${person.isOwner ? '<span class="owner-badge">My Profile</span>' : ""}<small>${escapeHTML(person.phone || "No mobile number saved")}</small></div>
          <div class="person-send-actions simple-send-actions">
            ${person.isOwner
              ? `<button class="button button-success button-very-large" data-copy-person="${person.id}">Copy List to My Phone</button>`
              : person.phone
                ? `<button class="button button-success button-very-large" data-message-person="${person.id}">Send by Text Message</button>`
                : `<button class="button button-success button-very-large" data-share-text-person="${person.id}">Share This List</button>`}
            <details class="transfer-more-options">
              <summary>Other Ways to Send</summary>
              <div class="transfer-more-actions">
                <button class="button button-secondary" data-share-person="${person.id}">AirDrop or Share File</button>
                ${person.phone ? `<button class="button button-secondary" data-sms-person="${person.id}">Send Readable List Only</button>` : ""}
                <button class="text-button" data-export-person="${person.id}">Save List File</button>
              </div>
            </details>
          </div>
        </article>`).join("") : `<div class="empty-card"><h2>No people added yet</h2><p>Add yourself and anyone you share lists with.</p><button class="button button-primary" data-route="people">Add People</button></div>`}
      </div>
      <div class="notice-card"><strong>Simple method for Mum</strong><span>Use Copy List to My Phone between her iPad and iPhone. Use Send by Text Message when somebody else sends her a list.</span></div>
    </section>`;
}

async function renderReceive() {
  main.innerHTML = `
    <section class="screen">
      <div class="receive-hero">
        <span class="receive-icon" aria-hidden="true">📥</span>
        <h1>Receive a List</h1>
        <p>First copy the whole shopping-list message. Then tap the large button below.</p>
        <button class="button button-success button-wide button-very-large" data-paste-transfer>Paste and Check List</button>
      </div>
      <ol class="plain-steps simple-receive-steps">
        <li><strong>1.</strong> Copy the whole message, or copy the list on your iPad.</li>
        <li><strong>2.</strong> Open this app and tap <strong>Paste and Check List</strong>.</li>
        <li><strong>3.</strong> Check the sender, then tap <strong>Accept and Update</strong>.</li>
      </ol>
      <details class="transfer-other-card">
        <summary>Other Ways to Receive</summary>
        <div class="transfer-other-body">
          <label for="manual-transfer-text"><strong>Paste the message here manually</strong></label>
          <textarea id="manual-transfer-text" rows="5" autocomplete="off" placeholder="Press and hold here, then tap Paste"></textarea>
          <button class="button button-secondary button-wide" data-check-manual-transfer>Check Pasted List</button>
          <button class="button button-secondary button-wide" data-choose-receive-file>Choose a Shopping List File</button>
        </div>
      </details>
    </section>`;
}

async function renderCopySuccess() {
  main.innerHTML = `
    <section class="screen success-screen copy-success-screen">
      <div class="success-mark" aria-hidden="true">✓</div>
      <h1>List Copied</h1>
      <p>Now open <strong>Our Shopping List</strong> on your other device.</p>
      <div class="copy-next-steps">
        <strong>On the other device:</strong>
        <span>1. Tap Send or Receive a List.</span>
        <span>2. Tap Receive a List.</span>
        <span>3. Tap Paste and Check List.</span>
      </div>
      <button class="button button-primary button-wide button-very-large" data-route="home">Done</button>
    </section>`;
}

async function renderReceivePreview() {
  const preview = state.pendingTransferPreview;
  if (!preview || !state.pendingTransfer) {
    main.innerHTML = `<section class="screen"><div class="empty-card"><h2>No list is waiting</h2><p>Paste a shopping-list message or choose a file first.</p><button class="button button-primary" data-route="receive">Choose a File</button></div></section>`;
    return;
  }
  const upToDate = preview.status === "up-to-date";
  const older = preview.status === "older";
  const noChange = upToDate || older;
  main.innerHTML = `
    <section class="screen">
      <div class="receive-preview-card ${noChange ? "up-to-date" : ""}">
        <span class="receive-icon" aria-hidden="true">${upToDate ? "✓" : older ? "↩️" : "👤"}</span>
        <h1>${upToDate ? "This List Is Already Up to Date" : older ? "This Is an Older List" : `List from ${escapeHTML(preview.senderName)}`}</h1>
        <p>${upToDate ? "Nothing will be duplicated or changed." : older ? "A newer list from this source device was already received. This older file will not replace it." : `Revision ${preview.revision} is ready to update this device.`}</p>
      </div>
      <div class="preview-grid">
        <div class="preview-stat"><strong>${preview.totalItems}</strong><span>Items in file</span></div>
        <div class="preview-stat"><strong>${preview.added}</strong><span>New items</span></div>
        <div class="preview-stat"><strong>${preview.removed}</strong><span>Removed by sender</span></div>
        <div class="preview-stat"><strong>${preview.totalMeals}</strong><span>Meal ideas</span></div>
      </div>
      ${noChange ? `<button class="button button-primary button-wide" data-cancel-transfer>Done</button>` : `<div class="sticky-actions"><button class="button button-success button-wide button-very-large" data-accept-transfer>Accept and Update</button><button class="button button-secondary button-wide" data-cancel-transfer>Not Now</button></div>`}
    </section>`;
}

async function renderReceiveSuccess() {
  const result = state.lastImportResult;
  main.innerHTML = `
    <section class="screen success-screen">
      <div class="success-mark" aria-hidden="true">✓</div>
      <h1>List Updated</h1>
      <p>${result ? `${escapeHTML(result.senderName)}’s latest list is now included.` : "The latest list is now included."}</p>
      <button class="button button-success button-wide button-very-large" data-route="shopping">Open My Updated List</button>
      <button class="button button-secondary button-wide" data-route="home">Return Home</button>
    </section>`;
}

async function renderSettingsLock() {
  main.innerHTML = `
    <section class="screen">
      <div class="locked-card">
        <span aria-hidden="true">🔒</span>
        <h1>Settings Are Protected</h1>
        <p>Enter the four-number Settings PIN.</p>
        <label for="unlock-pin"><strong>Settings PIN</strong></label>
        <input class="pin-input" id="unlock-pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" aria-label="Four-number Settings PIN">
        <button class="button button-primary button-wide" data-unlock-settings>Open Settings</button>
        <button class="button button-secondary button-wide" data-route="home">Cancel</button>
      </div>
    </section>`;
  setTimeout(() => document.querySelector("#unlock-pin")?.focus(), 60);
}

async function renderSettings() {
  const [owner, people, customItems, pinState] = await Promise.all([
    getOwner(), getPeople(), getAll("items").then(rows => rows.filter(row => row.isCustom)), getPinState()
  ]);
  main.innerHTML = `
    <section class="screen">
      <h1 class="section-heading">Settings</h1>
      <p class="section-subtitle">Setup and data tools are kept away from everyday shopping.</p>
      <div class="settings-grid">
        <button class="settings-navigation-card" data-route="people"><span class="settings-card-icon">👥</span><span><strong>My Profile and People</strong><small>${owner ? `My profile: ${escapeHTML(owner.name)} • ` : "No profile yet • "}${people.length} ${people.length === 1 ? "person" : "people"}</small></span><span>›</span></button>
        <button class="settings-navigation-card" data-route="custom-items"><span class="settings-card-icon">📝</span><span><strong>Custom Items</strong><small>${customItems.length} saved custom ${customItems.length === 1 ? "item" : "items"}</small></span><span>›</span></button>
        <button class="settings-navigation-card" data-route="data-tools"><span class="settings-card-icon">💾</span><span><strong>Backup and Restore</strong><small>Export one complete backup or replace from a saved backup.</small></span><span>›</span></button>
        <button class="settings-navigation-card" data-route="accessibility"><span class="settings-card-icon">👓</span><span><strong>Accessibility and PIN</strong><small>Large text is on • Settings PIN ${pinState.enabled ? "is on" : "is off"}</small></span><span>›</span></button>
      </div>
      <div class="sticky-actions"><button class="button button-success button-wide" data-route="home">Return to Shopping List</button></div>
      <p class="build-label">Version 1 • Build ${APP_BUILD}</p>
    </section>`;
}

async function renderPeople() {
  const people = await getPeople();
  main.innerHTML = `
    <section class="screen">
      <div class="section-title-row"><div><h1 class="section-heading">My Profile and People</h1><p class="section-subtitle">Everyone appears in the same Send area.</p></div><button class="button button-primary" data-add-person>＋ Add Person</button></div>
      <div class="people-list">
        ${people.length ? people.map(person => `<article class="person-card">
          ${avatarMarkup(person)}
          <div class="person-card-copy"><strong>${escapeHTML(person.name)}</strong>${person.isOwner ? '<span class="owner-badge">My Profile</span>' : ""}<small>${escapeHTML(person.phone || "No mobile number")}</small></div>
          <div class="person-card-actions"><button class="button button-secondary" data-edit-person="${person.id}">Edit</button><button class="text-button danger-text" data-delete-person="${person.id}">Delete</button></div>
        </article>`).join("") : `<div class="empty-card"><div class="empty-icon">👥</div><h2>No people yet</h2><p>Start by adding your own profile.</p><button class="button button-primary" data-add-person>Add My Profile</button></div>`}
      </div>
      <div class="notice-card"><strong>Sending to yourself is supported</strong><span>Add the same owner profile on each device, then use Message or AirDrop to deliberately transfer a list.</span></div>
      <div class="sticky-actions"><button class="button button-success button-wide" data-route="home">Return to Shopping List</button></div>
    </section>`;
}

async function renderCustomItems() {
  const items = (await getAll("items")).filter(item => item.isCustom).sort((a, b) => a.name.localeCompare(b.name));
  const categoryMap = new Map(CATEGORIES.map(category => [category.id, category]));
  main.innerHTML = `
    <section class="screen">
      <div class="section-title-row"><div><h1 class="section-heading">Custom Items</h1><p class="section-subtitle">These items stay in your category list.</p></div><button class="button button-primary" data-custom-item="other">＋ Add Item</button></div>
      <div class="custom-management-list">
        ${items.length ? items.map(item => {
          const category = categoryMap.get(item.categoryId) || categoryMap.get("other");
          return `<article class="custom-management-row"><span class="custom-category-icon" style="${categoryStyle(category)}">${category.emoji}</span><span><strong>${escapeHTML(item.name)}</strong><small>${escapeHTML(category.name)} • ${escapeHTML(item.defaultStore)}</small></span><div><button class="button button-secondary" data-edit-custom="${item.id}">Edit</button><button class="text-button danger-text" data-delete-custom="${item.id}">Delete</button></div></article>`;
        }).join("") : `<div class="empty-card"><div class="empty-icon">📝</div><h2>No custom items yet</h2><p>Use Add Custom Item in any category, or add one here.</p><button class="button button-primary" data-custom-item="other">Add Custom Item</button></div>`}
      </div>
    </section>`;
}

async function renderDataTools() {
  main.innerHTML = `
    <section class="screen">
      <div class="settings-card"><h2>Export Full Backup</h2><p>Saves people, items, current lists, meal ideas, Settings and transfer history in one JSON file.</p><button class="button button-success button-wide" data-export-backup>Export Full Backup</button></div>
      <div class="settings-card warning-card"><h2>Restore Full Backup</h2><p>Restore replaces everything currently stored on this device. You will see a large warning before it happens.</p><button class="button button-danger button-wide" data-choose-restore-file>Choose Backup to Restore</button></div>
      <div class="notice-card"><strong>Your normal app data stays local</strong><span>Keep backup files somewhere safe, such as Files, iCloud Drive or another device.</span></div>
    </section>`;
}

async function renderAccessibility() {
  const [settings, pinState] = await Promise.all([getAccessibilitySettings(), getPinState()]);
  main.innerHTML = `
    <section class="screen">
      <div class="settings-card">
        <h2>Text Size</h2>
        <p>Extra Large Text makes headings, list rows and controls easier to read.</p>
        <label class="check-card setting-check">
          <input id="extra-large-text" type="checkbox" ${settings.extraLargeText !== false ? "checked" : ""}>
          <span aria-hidden="true" class="big-check"></span>
          <span>Use Extra Large Text</span>
        </label>
        <button class="button button-primary button-wide top-gap" data-save-accessibility>Save Text Setting</button>
      </div>
      <div class="settings-card">
        <h2>Optional Settings PIN</h2>
        <p>${pinState.enabled ? "Settings are protected by a four-number PIN on this device." : "A PIN can prevent accidental changes. It is off by default."}</p>
        ${pinState.enabled ? `<button class="button button-danger button-wide" data-disable-pin>Turn Off Settings PIN</button>` : `
          <label for="new-pin"><strong>New four-number PIN</strong></label><input class="pin-input" id="new-pin" type="password" inputmode="numeric" maxlength="4" pattern="[0-9]*" autocomplete="new-password">
          <label for="confirm-pin"><strong>Enter it again</strong></label><input class="pin-input" id="confirm-pin" type="password" inputmode="numeric" maxlength="4" pattern="[0-9]*" autocomplete="new-password">
          <button class="button button-success button-wide" data-enable-pin>Turn On Settings PIN</button>`}
      </div>
    </section>`;
}

function openCustomItem(categoryId = "other", item = null) {
  document.querySelector("#custom-item-category").innerHTML = CATEGORIES.map(category => `<option value="${category.id}">${escapeHTML(category.name)}</option>`).join("");
  document.querySelector("#custom-item-id").value = item?.id || "";
  document.querySelector("#custom-item-dialog-title").textContent = item ? "Edit Custom Item" : "Add Custom Item";
  document.querySelector("#custom-item-dialog-help").textContent = item ? "Change this saved item." : "Add something not already in the list.";
  document.querySelector("#custom-item-name").value = item?.name || "";
  document.querySelector("#custom-item-category").value = item?.categoryId || categoryId;
  customItemForm.querySelectorAll('input[name="store"]').forEach(input => { input.checked = input.value === (item?.defaultStore || "Coles"); });
  document.querySelector("#custom-item-add-now-row").classList.toggle("is-hidden-row", Boolean(item));
  document.querySelector("#custom-item-add-now").checked = true;
  customItemDialog.showModal();
  setTimeout(() => document.querySelector("#custom-item-name").focus(), 50);
}

let customItemSaving = false;

async function saveCustomItem(event) {
  event.preventDefault();
  if (event.submitter?.value === "cancel") { customItemDialog.close(); return; }
  if (customItemSaving) return;
  customItemSaving = true;
  const submitButton = event.submitter || customItemForm.querySelector('button[value="default"]');
  if (submitButton) { submitButton.disabled = true; submitButton.setAttribute("aria-busy", "true"); }
  const data = new FormData(customItemForm);
  try {
    const id = data.get("id");
    const item = id
      ? await updateCustomItem({ id, name: data.get("name"), categoryId: data.get("categoryId"), store: data.get("store") })
      : await createCustomItem({ name: data.get("name"), categoryId: data.get("categoryId"), store: data.get("store"), addNow: data.get("addNow") === "on" });
    customItemDialog.close();
    if (state.route === "custom-items") await renderCustomItems();
    else { state.selectedCategoryId = item.categoryId; await renderAddItems(); }
    showToast(`${item.name} was saved.`);
  } catch (error) {
    showToast(error.message);
  } finally {
    customItemSaving = false;
    if (submitButton?.isConnected) { submitButton.disabled = false; submitButton.removeAttribute("aria-busy"); }
  }
}

async function openPerson(personId = null) {
  const person = personId ? await getRecord("people", personId) : null;
  document.querySelector("#person-dialog-title").textContent = person ? "Edit Person" : "Add Person";
  document.querySelector("#person-id").value = person?.id || "";
  document.querySelector("#person-name").value = person?.name || "";
  document.querySelector("#person-phone").value = person?.phone || "";
  document.querySelector("#person-is-owner").checked = Boolean(person?.isOwner) || (!person && !(await getOwner()));
  document.querySelector("#person-photo-data").value = safePhoto(person?.photo);
  updatePersonPhotoPreview(person?.name, person?.photo);
  personPhotoInput.value = "";
  personDialog.showModal();
  setTimeout(() => document.querySelector("#person-name").focus(), 50);
}

function updatePersonPhotoPreview(name = "", photo = "") {
  const preview = document.querySelector("#person-photo-preview");
  const safe = safePhoto(photo);
  preview.innerHTML = safe ? `<img src="${safe}" alt="">` : escapeHTML(initials(name));
}

let personSaving = false;

async function savePersonForm(event) {
  event.preventDefault();
  if (event.submitter?.value === "cancel") { personDialog.close(); return; }
  if (personSaving) return;
  personSaving = true;
  const submitButton = event.submitter || personForm.querySelector('button[value="default"]');
  if (submitButton) { submitButton.disabled = true; submitButton.setAttribute("aria-busy", "true"); }
  const data = new FormData(personForm);
  try {
    const hadOwner = Boolean(await getOwner());
    const person = await savePerson({
      id: data.get("id") || null,
      name: data.get("name"),
      phone: data.get("phone"),
      photo: data.get("photo"),
      isOwner: data.get("isOwner") === "on"
    });
    personDialog.close();
    if (!hadOwner && person.isOwner) {
      routeTo("home");
      showToast(`${person.name} was saved. Your shopping list is ready.`);
    } else {
      await renderPeople();
      showToast(`${person.name} was saved.`);
    }
  } catch (error) {
    showToast(error.message);
  } finally {
    personSaving = false;
    if (submitButton?.isConnected) { submitButton.disabled = false; submitButton.removeAttribute("aria-busy"); }
  }
}

async function resizeImageFile(file) {
  if (!file || !file.type.startsWith("image/")) throw new Error("Please choose a photo.");
  if (file.size > 15_000_000) throw new Error("That photo is too large. Please choose a smaller one.");
  let image;
  let cleanup = () => {};
  if ("createImageBitmap" in window) {
    image = await createImageBitmap(file);
    cleanup = () => image.close?.();
  } else {
    const url = URL.createObjectURL(file);
    image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("That photo could not be opened."));
      image.src = url;
    });
    cleanup = () => URL.revokeObjectURL(url);
  }
  const size = 512;
  const sourceWidth = image.width;
  const sourceHeight = image.height;
  const side = Math.min(sourceWidth, sourceHeight);
  const sx = (sourceWidth - side) / 2;
  const sy = (sourceHeight - side) / 2;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = "#fffaf0";
  context.fillRect(0, 0, size, size);
  context.drawImage(image, sx, sy, side, side, 0, 0, size, size);
  cleanup();
  return canvas.toDataURL("image/jpeg", 0.82);
}

async function exportBackup() {
  const backup = await exportFullBackup();
  downloadBlob(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }), `our-shopping-list-backup-${fileDate()}.json`);
  showToast("Full backup prepared.");
}

async function exportTransfer(personId) {
  const payload = await createTransferPayload(personId);
  const file = makeTransferFile(payload);
  downloadBlob(file, file.name);
  showToast("List file prepared. Send it through Message, AirDrop or Files.", 4200);
}

async function copyTransferText(personId = null) {
  const payload = await createTransferPayload(personId);
  await writeClipboardText(transferText(payload));
  routeTo("copy-success");
}

async function shareTextTransfer(personId) {
  const payload = await createTransferPayload(personId);
  const text = transferText(payload);
  if (navigator.share) {
    try {
      await navigator.share({ title: "Our Shopping List", text });
      showToast("The list was handed to Apple Share.");
      return;
    } catch (error) {
      if (error?.name === "AbortError") {
        showToast("Sharing was cancelled. Nothing was changed.");
        return;
      }
    }
  }
  await writeClipboardText(text);
  routeTo("copy-success");
}

async function sendTransferMessage(personId) {
  const person = await getRecord("people", personId);
  if (!person?.phone) return shareTextTransfer(personId);
  const payload = await createTransferPayload(personId);
  const text = transferText(payload);
  const phone = person.phone.replace(/[^0-9+]/g, "");
  if (text.length <= 7000) {
    window.location.href = `sms:${phone}&body=${encodeURIComponent(text)}`;
    return;
  }
  if (navigator.share) {
    try {
      await navigator.share({ title: `Shopping list for ${person.name}`, text });
      showToast("Choose Messages, then send the prepared list.");
      return;
    } catch (error) {
      if (error?.name === "AbortError") {
        showToast("Sending was cancelled. Nothing was changed.");
        return;
      }
    }
  }
  await writeClipboardText(text);
  routeTo("copy-success");
}

async function pasteTransferFromClipboard() {
  if (!navigator.clipboard?.readText) {
    const details = document.querySelector(".transfer-other-card");
    if (details) details.open = true;
    document.querySelector("#manual-transfer-text")?.focus();
    throw new Error("Press and hold in the box below, tap Paste, then tap Check Pasted List.");
  }
  try {
    const text = await navigator.clipboard.readText();
    await loadPendingTransfer(parseTransferText(text));
  } catch (error) {
    const details = document.querySelector(".transfer-other-card");
    if (details) details.open = true;
    if (error?.name === "NotAllowedError") {
      document.querySelector("#manual-transfer-text")?.focus();
      throw new Error("Allow Paste when your device asks. If it does not ask, press and hold in the box below and tap Paste.");
    }
    throw error;
  }
}

async function shareTransfer(personId) {
  const payload = await createTransferPayload(personId);
  const file = makeTransferFile(payload);
  const shareData = { title: "Our Shopping List", text: `Shopping list from ${payload.sender.name}`, files: [file] };
  const canShareFiles = Boolean(navigator.share) && (!navigator.canShare || navigator.canShare({ files: [file] }));
  if (!canShareFiles) {
    downloadBlob(file, file.name);
    showToast("Apple file sharing is not available here, so the list file was exported instead.", 5000);
    return;
  }
  try {
    await navigator.share(shareData);
    showToast("The list was handed to Apple Share.");
  } catch (error) {
    if (error?.name === "AbortError") {
      showToast("Sharing was cancelled. Nothing was changed.");
      return;
    }
    downloadBlob(file, file.name);
    showToast("Apple Share could not attach the file, so the list file was exported instead.", 5200);
  }
}

async function sendReadableText(personId) {
  const person = await getRecord("people", personId);
  if (!person?.phone) throw new Error("Add a mobile number for this person first.");
  const payload = await createTransferPayload(personId);
  const phone = person.phone.replace(/[^0-9+]/g, "");
  const body = encodeURIComponent(transferSummary(payload));
  window.location.href = `sms:${phone}&body=${body}`;
}

function showUpdatePrompt(registration) {
  if (!registration?.waiting) return;
  if ("serviceWorker" in navigator && !navigator.serviceWorker.controller) return;
  state.updateRegistration = registration;
  updateRegion.innerHTML = `<section class="update-card" role="status"><div><strong>App update ready</strong><span>Update when you are not in the middle of shopping. Your saved lists will stay on this device.</span></div><div class="update-actions"><button class="button button-primary" data-update-now>Update App Now</button><button class="button button-secondary" data-update-later>Later</button></div></section>`;
}

updateRegion.addEventListener("click", event => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.hasAttribute("data-update-later")) {
    updateRegion.innerHTML = "";
    return;
  }
  if (button.hasAttribute("data-update-now")) {
    const worker = state.updateRegistration?.waiting;
    if (!worker) {
      updateRegion.innerHTML = "";
      showToast("The update is no longer waiting. It will be checked again next time.");
      return;
    }
    state.refreshingForUpdate = true;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    worker.postMessage({ type: "SKIP_WAITING" });
  }
});

let mainActionBusy = false;

main.addEventListener("click", async event => {
  const button = event.target.closest("button");
  if (!button || mainActionBusy) return;
  mainActionBusy = true;
  const wasDisabled = button.disabled;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  try {
    if (button.dataset.summaryStatus) { state.statusFilter = button.dataset.summaryStatus; return routeTo("status"); }
    if (button.dataset.route) return routeTo(button.dataset.route);
    if (button.dataset.category) { state.itemSearch = ""; state.categoryEditMode = false; return routeTo("add", { categoryId: button.dataset.category }); }
    if (button.hasAttribute("data-category-back")) { state.selectedCategoryId = null; state.itemSearch = ""; state.categoryEditMode = false; return renderAddItems(); }
    if (button.hasAttribute("data-toggle-category-edit")) { state.categoryEditMode = !state.categoryEditMode; state.itemSearch = ""; return renderAddItems(); }
    if (button.dataset.hidePreset) {
      const item = await getRecord("items", button.dataset.hidePreset);
      const confirmed = await confirmAction({
        title: "Remove From This Category?",
        message: `${item?.name || "This item"} will no longer appear in this category. You can restore it at any time by choosing Edit List.`,
        confirmText: "Remove Item"
      });
      if (confirmed) { await hidePresetItem(button.dataset.hidePreset); await renderAddItems(); showToast(`${item?.name || "Item"} removed from this category.`); }
      return;
    }
    if (button.dataset.restorePreset) {
      const item = await restorePresetItem(button.dataset.restorePreset);
      await renderAddItems();
      showToast(`${item?.name || "Item"} restored.`);
      return;
    }
    if (button.dataset.storeChoiceItem) {
      await changeLocalStore(button.dataset.storeChoiceItem, button.dataset.storeValue);
      await renderAddItems();
      showToast(`Store set to ${storeDisplayName(button.dataset.storeValue)}.`);
      return;
    }
    if (button.dataset.toggleItem) {
      const selected = await toggleLocalItem(button.dataset.toggleItem);
      await renderAddItems();
      showToast(selected ? "Item added to your shopping list." : "Item removed from your shopping list.");
      return;
    }
    if (button.dataset.customItem) return openCustomItem(button.dataset.customItem);
    if (button.dataset.editCustom) return openCustomItem("other", await getRecord("items", button.dataset.editCustom));
    if (button.dataset.deleteCustom) {
      const item = await getRecord("items", button.dataset.deleteCustom);
      const confirmed = await confirmAction({ title: "Delete Custom Item?", message: `${item?.name || "This item"} will be removed from your saved items and your part of the current list. Other people’s requests will stay.`, confirmText: "Delete Item" });
      if (confirmed) {
        const result = await deleteCustomItem(button.dataset.deleteCustom);
        if (state.route === "add") await renderAddItems();
        else await renderCustomItems();
        showToast(result.preservedSharedRequests ? "Your custom item was removed. Other people’s request is still on the Shopping List." : "Custom item deleted.", 4800);
      }
      return;
    }
    if (button.dataset.statusItem) {
      await setItemStatus(button.dataset.statusItem, button.dataset.status);
      await renderShopping();
      showToast(button.dataset.status === "got" ? "Moved to Got It. Tap Undo to change it." : button.dataset.status === "unavailable" ? "Moved to Couldn’t Get. Tap Undo to change it." : "Item returned to your active list.");
      return;
    }
    if (button.dataset.quantity) {
      await changeLocalQuantity(button.dataset.quantity, Number(button.dataset.delta));
      if (state.route === "add") await renderAddItems();
      else await renderShopping();
      return;
    }
    if (button.dataset.removeLocal) {
      const item = await getRecord("items", button.dataset.removeLocal);
      const confirmed = await confirmAction({ title: "Remove Your Request?", message: `${item?.name || "This item"} will be removed from your part of the shopping list. Other people’s requests will stay.`, confirmText: "Remove My Request" });
      if (confirmed) { await removeLocalItem(button.dataset.removeLocal); await renderShopping(); showToast("Your request was removed."); }
      return;
    }
    if (button.hasAttribute("data-finish-shopping")) {
      const confirmed = await confirmAction({ title: "Finish Shopping?", message: "Got It items will be cleared. Couldn’t Get items will stay on the next shopping list. If somebody needs the results, send the list before finishing.", confirmText: "Finish Shopping", danger: false });
      if (confirmed) { await finishShopping(); await renderShopping(); showToast("Shopping finished. Unavailable items are still on your list."); }
      return;
    }
    if (button.hasAttribute("data-add-meal")) { const input = document.querySelector("#custom-meal"); const name = await createMealSuggestion(input.value); await renderMeals(); showToast(`${name} was saved as a meal idea.`); return; }
    if (button.dataset.removeMeal) { await removeMealSuggestion(button.dataset.removeMeal); await renderMeals(); showToast("Meal idea removed."); return; }
    if (button.hasAttribute("data-add-person")) return openPerson();
    if (button.dataset.editPerson) return openPerson(button.dataset.editPerson);
    if (button.dataset.deletePerson) {
      const person = await getRecord("people", button.dataset.deletePerson);
      const confirmed = await confirmAction({ title: "Delete Person?", message: `${person?.name || "This person"} will be removed from your Send area. Shopping requests already received will remain visible by name.`, confirmText: "Delete Person" });
      if (confirmed) { await deletePerson(button.dataset.deletePerson); await renderPeople(); showToast("Person deleted."); }
      return;
    }
    if (button.hasAttribute("data-copy-self")) { const owner = await getOwner(); if (!owner) throw new Error("Set up My Profile first."); return copyTransferText(owner.id); }
    if (button.dataset.copyPerson) return copyTransferText(button.dataset.copyPerson);
    if (button.dataset.messagePerson) return sendTransferMessage(button.dataset.messagePerson);
    if (button.dataset.shareTextPerson) return shareTextTransfer(button.dataset.shareTextPerson);
    if (button.hasAttribute("data-paste-transfer")) return pasteTransferFromClipboard();
    if (button.hasAttribute("data-check-manual-transfer")) return loadPendingTransfer(parseTransferText(document.querySelector("#manual-transfer-text")?.value));
    if (button.dataset.sharePerson) return shareTransfer(button.dataset.sharePerson);
    if (button.dataset.exportPerson) return exportTransfer(button.dataset.exportPerson);
    if (button.dataset.smsPerson) return sendReadableText(button.dataset.smsPerson);
    if (button.hasAttribute("data-choose-receive-file")) { receiveFileInput.value = ""; receiveFileInput.click(); return; }
    if (button.hasAttribute("data-accept-transfer")) {
      const result = await acceptTransfer(state.pendingTransfer);
      state.lastImportResult = result;
      state.pendingTransfer = null;
      state.pendingTransferPreview = null;
      routeTo("receive-success");
      return;
    }
    if (button.hasAttribute("data-cancel-transfer")) { state.pendingTransfer = null; state.pendingTransferPreview = null; routeTo("transfer"); return; }
    if (button.hasAttribute("data-export-backup")) return exportBackup();
    if (button.hasAttribute("data-choose-restore-file")) { restoreFileInput.value = ""; restoreFileInput.click(); return; }
    if (button.hasAttribute("data-unlock-settings")) {
      const pin = document.querySelector("#unlock-pin")?.value || "";
      if (await verifySettingsPin(pin)) { state.settingsUnlocked = true; await renderRoute(); showToast("Settings opened."); }
      else { showToast("That PIN is not correct."); document.querySelector("#unlock-pin")?.select(); }
      return;
    }
    if (button.hasAttribute("data-save-accessibility")) {
      await setAccessibilitySettings({ extraLargeText: document.querySelector("#extra-large-text")?.checked });
      await applyAccessibility();
      await renderAccessibility();
      showToast("Text setting saved.");
      return;
    }
    if (button.hasAttribute("data-enable-pin")) {
      const first = document.querySelector("#new-pin")?.value || "";
      const second = document.querySelector("#confirm-pin")?.value || "";
      if (first !== second) throw new Error("The two PIN entries do not match.");
      await setSettingsPin(first);
      state.settingsUnlocked = true;
      await renderAccessibility();
      showToast("Settings PIN turned on.");
      return;
    }
    if (button.hasAttribute("data-disable-pin")) {
      const confirmed = await confirmAction({ title: "Turn Off Settings PIN?", message: "Settings will open without a PIN on this device.", confirmText: "Turn Off PIN" });
      if (confirmed) { await clearSettingsPin(); await renderAccessibility(); showToast("Settings PIN turned off."); }
    }
  } catch (error) {
    console.warn("Action could not be completed", error);
    showToast(error.message || "That action could not be completed.", 4500);
  } finally {
    mainActionBusy = false;
    if (button.isConnected) {
      button.disabled = wasDisabled;
      button.removeAttribute("aria-busy");
    }
  }
});

main.addEventListener("change", async event => {
  const select = event.target.closest("select[data-store-item]");
  if (!select) return;
  const previousValue = select.dataset.previousValue || "Either";
  select.disabled = true;
  select.setAttribute("aria-busy", "true");
  try {
    await changeLocalStore(select.dataset.storeItem, select.value);
    if (state.route === "add") await renderAddItems();
    else await renderShopping();
    showToast("Store choice updated.");
  } catch (error) {
    console.warn("Store choice could not be changed", error);
    select.value = previousValue;
    showToast(error.message || "The store choice could not be changed.", 4500);
  } finally {
    if (select.isConnected) {
      select.disabled = false;
      select.removeAttribute("aria-busy");
    }
  }
});

const ROUTE_PARENTS = {
  add: "home",
  shopping: "home",
  status: "home",
  meals: "home",
  transfer: "home",
  send: "transfer",
  receive: "transfer",
  "receive-preview": "receive",
  "receive-success": "transfer",
  "copy-success": "transfer",
  settings: "home",
  people: "settings",
  "custom-items": "settings",
  "data-tools": "settings",
  accessibility: "settings"
};


main.addEventListener("keydown", event => {
  if (event.key !== "Enter" || event.target?.id !== "custom-meal") return;
  event.preventDefault();
  document.querySelector("[data-add-meal]")?.click();
});

backButton.addEventListener("click", () => {
  if (state.route === "add" && state.selectedCategoryId) {
    state.selectedCategoryId = null;
    state.itemSearch = "";
    state.categoryEditMode = false;
    return renderAddItems();
  }
  routeTo(ROUTE_PARENTS[state.route] || "home");
});

homeButton.addEventListener("click", () => routeTo("home"));
settingsButton.addEventListener("click", () => routeTo("settings"));

document.addEventListener("click", event => {
  const button = event.target.closest("button[data-close-dialog]");
  if (!button) return;
  const dialog = document.getElementById(button.dataset.closeDialog);
  if (dialog?.open) dialog.close("cancel");
});
customItemForm.addEventListener("submit", saveCustomItem);
personForm.addEventListener("submit", savePersonForm);

document.querySelector("#person-name").addEventListener("input", event => {
  if (!document.querySelector("#person-photo-data").value) updatePersonPhotoPreview(event.target.value, "");
});

document.querySelector("#remove-person-photo").addEventListener("click", () => {
  document.querySelector("#person-photo-data").value = "";
  updatePersonPhotoPreview(document.querySelector("#person-name").value, "");
});

personPhotoInput.addEventListener("change", async () => {
  try {
    const dataUrl = await resizeImageFile(personPhotoInput.files?.[0]);
    document.querySelector("#person-photo-data").value = dataUrl;
    updatePersonPhotoPreview(document.querySelector("#person-name").value, dataUrl);
  } catch (error) {
    showToast(error.message);
  }
});

receiveFileInput.addEventListener("change", async () => {
  try {
    const payload = validateTransferPayload(await readJSONFile(receiveFileInput.files?.[0]));
    await loadPendingTransfer(payload);
  } catch (error) {
    showToast(error.message, 5200);
  }
});

restoreFileInput.addEventListener("change", async () => {
  try {
    const backup = validateBackup(await readJSONFile(restoreFileInput.files?.[0], 30_000_000));
    const confirmed = await confirmAction({
      title: "Replace Everything on This Device?",
      message: "Restore will permanently replace all current people, items, lists, meal ideas and Settings on this device with the selected backup.",
      confirmText: "Replace and Restore"
    });
    if (!confirmed) return;
    await restoreFullBackup(backup);
    showToast("Backup restored. The app will reopen now.", 4000);
    setTimeout(() => location.reload(), 700);
  } catch (error) {
    showToast(error.message, 5200);
  }
});

window.addEventListener("hashchange", () => {
  const route = location.hash.slice(1);
  if (ROUTES[route] && route !== state.route) routeTo(route);
});

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!state.refreshingForUpdate) return;
      state.refreshingForUpdate = false;
      location.reload();
    });
    const registration = await navigator.serviceWorker.register("./service-worker.js", { scope: "./" });
    if (registration.waiting && navigator.serviceWorker.controller) showUpdatePrompt(registration);
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) showUpdatePrompt(registration);
      });
    });
  } catch (error) {
    console.warn("Service worker registration failed", error);
  }
}

(async function start() {
  await openDatabase();
  await applyAccessibility();
  const restoreNotice = await consumeRestoreNotice();
  const initialRoute = location.hash.slice(1);
  state.route = ROUTES[initialRoute] ? initialRoute : "home";
  await renderRoute();
  if (restoreNotice) showToast(restoreNotice, 6500);
  registerServiceWorker();
})();
