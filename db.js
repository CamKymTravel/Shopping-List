import { CATEGORIES, PRESET_ITEMS } from "./data.js";

const DB_NAME = "our-shopping-list";
const DB_VERSION = 6;
const LOCAL_REQUESTER_ID = "local-device";
const BACKUP_STORES = [
  "meta", "settings", "people", "categories", "items",
  "contributions", "mealSuggestions", "imports"
];
const ALLOWED_STORES = new Set(["Either", "Coles", "Woolworths", "Aldi"]);
const ALLOWED_STATUSES = new Set(["active", "got", "unavailable"]);
const STORED_STATUSES = new Set([...ALLOWED_STATUSES, "cleared"]);

let dbPromise;

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("Database transaction was aborted."));
  });
}

export function generateId(prefix = "id") {
  return `${prefix}:${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function isoNow() {
  return new Date().toISOString();
}

function addIndex(store, name, keyPath, options = { unique: false }) {
  if (!store.indexNames.contains(name)) store.createIndex(name, keyPath, options);
}

function putDefaultIfMissing(store, key, value) {
  const request = store.get(key);
  request.onsuccess = () => {
    if (request.result === undefined) store.put({ key, value });
  };
}

function putRecordIfMissing(store, key, value) {
  const request = store.get(key);
  request.onsuccess = () => {
    if (request.result === undefined) store.put(value);
  };
}

export function openDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = event => {
      const db = event.target.result;
      const tx = event.target.transaction;

      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
      if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings", { keyPath: "key" });
      if (!db.objectStoreNames.contains("people")) db.createObjectStore("people", { keyPath: "id" });
      if (!db.objectStoreNames.contains("categories")) db.createObjectStore("categories", { keyPath: "id" });
      if (!db.objectStoreNames.contains("items")) db.createObjectStore("items", { keyPath: "id" });
      if (!db.objectStoreNames.contains("contributions")) db.createObjectStore("contributions", { keyPath: "id" });
      if (!db.objectStoreNames.contains("mealSuggestions")) db.createObjectStore("mealSuggestions", { keyPath: "id" });
      if (!db.objectStoreNames.contains("imports")) db.createObjectStore("imports", { keyPath: "transferId" });

      const items = tx.objectStore("items");
      addIndex(items, "categoryId", "categoryId");
      addIndex(items, "normalisedName", "normalisedName");

      const contributions = tx.objectStore("contributions");
      addIndex(contributions, "itemId", "itemId");
      addIndex(contributions, "requesterId", "requesterId");
      addIndex(contributions, "status", "status");
      addIndex(contributions, "sourceSenderId", "sourceSenderId");
      addIndex(contributions, "originContributionId", "originContributionId");

      const meals = tx.objectStore("mealSuggestions");
      addIndex(meals, "sourceSenderId", "sourceSenderId");
      addIndex(meals, "requesterId", "requesterId");

      const imports = tx.objectStore("imports");
      addIndex(imports, "senderId", "senderId");

      if (event.oldVersion < 1) {
        const categories = tx.objectStore("categories");
        CATEGORIES.forEach(category => categories.put(category));
        PRESET_ITEMS.forEach(item => items.put({
          ...item,
          normalisedName: normaliseName(item.name),
          createdAt: isoNow(),
          updatedAt: isoNow()
        }));
        tx.objectStore("meta").put({ key: "deviceId", value: generateId("device") });
        tx.objectStore("meta").put({ key: "schemaVersion", value: DB_VERSION });
        tx.objectStore("meta").put({ key: "listRevision", value: 1 });
        tx.objectStore("settings").put({ key: "accessibility", value: { extraLargeText: true } });
      } else {
        const meta = tx.objectStore("meta");
        putDefaultIfMissing(meta, "deviceId", generateId("device"));
        putDefaultIfMissing(meta, "listRevision", 1);
        meta.put({ key: "schemaVersion", value: DB_VERSION });
        putDefaultIfMissing(tx.objectStore("settings"), "accessibility", { extraLargeText: true });
      }

      // Built-in categories and preset items are application structure rather than
      // user data. Add any newly introduced records during a safe schema upgrade,
      // without replacing existing local records or custom items.
      const categoryStore = tx.objectStore("categories");
      CATEGORIES.forEach(category => putRecordIfMissing(categoryStore, category.id, category));
      PRESET_ITEMS.forEach(item => putRecordIfMissing(items, item.id, {
        ...item,
        normalisedName: normaliseName(item.name),
        createdAt: isoNow(),
        updatedAt: isoNow()
      }));

      if (event.oldVersion < 4) {
        // Earlier builds temporarily exposed imported custom definitions in the
        // weekly item library. If the user deliberately selected one locally,
        // preserve that choice by promoting the definition into their own
        // permanent custom library during migration.
        const localContributionRequest = contributions.getAll();
        localContributionRequest.onsuccess = () => {
          const locallyUsedItemIds = new Set(
            localContributionRequest.result
              .filter(row => row.sourceType === "local" && row.status !== "cleared")
              .map(row => row.itemId)
          );
          locallyUsedItemIds.forEach(itemId => {
            const itemRequest = items.get(itemId);
            itemRequest.onsuccess = () => {
              if (itemRequest.result?.imported) {
                items.put({ ...itemRequest.result, imported: false, receivedFromList: true, updatedAt: isoNow() });
              }
            };
          });
        };
      }

      if (event.oldVersion < 5) {
        // From Build 0.6.5 onward, a custom item received from another person
        // becomes a normal permanent custom item in the matching category.
        // Legacy received definitions used the imported-item ID prefix. Promote
        // those records while preserving items the local user deliberately hid.
        const legacyImportedRequest = items.getAll();
        legacyImportedRequest.onsuccess = () => {
          legacyImportedRequest.result
            .filter(item => item?.isCustom && item?.imported && String(item.id || "").startsWith("imported-item:"))
            .forEach(item => items.put({
              ...item,
              imported: false,
              receivedFromList: true,
              updatedAt: isoNow()
            }));
        };
      }

      if (event.oldVersion < 6) {
        // Build 0.6.7 makes Coles the normal default for built-in products.
        // Existing deliberate store choices live on contributions, so this only
        // updates the library default used the next time a preset item is added.
        const presetDefaultsRequest = items.getAll();
        presetDefaultsRequest.onsuccess = () => {
          presetDefaultsRequest.result
            .filter(item => item && !item.isCustom && (!item.defaultStore || item.defaultStore === "Either"))
            .forEach(item => items.put({ ...item, defaultStore: "Coles", updatedAt: isoNow() }));
        };
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("The shopping list is open in another tab. Close the other tab and try again."));
  });
  return dbPromise;
}

export function normaliseName(value) {
  return String(value || "").trim().toLocaleLowerCase("en-AU").replace(/\s+/g, " ");
}

function cleanText(value, maxLength = 100) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function cleanPhone(value) {
  return String(value || "").trim().replace(/[^0-9+()\-\s]/g, "").slice(0, 30);
}

function cleanPhoto(value) {
  if (typeof value !== "string" || value.length > 2_500_000) return "";
  return /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/i.test(value) ? value : "";
}

function safeStore(value) {
  return ALLOWED_STORES.has(value) ? value : "Either";
}

function safeStatus(value) {
  return ALLOWED_STATUSES.has(value) ? value : "active";
}

function safeCategoryId(value) {
  const categoryId = cleanText(value, 80);
  return CATEGORIES.some(category => category.id === categoryId) ? categoryId : "other";
}

function isPlainRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function getAll(storeName) {
  const db = await openDatabase();
  const tx = db.transaction(storeName, "readonly");
  const result = await requestToPromise(tx.objectStore(storeName).getAll());
  await transactionDone(tx);
  return result;
}

export async function getRecord(storeName, key) {
  const db = await openDatabase();
  const tx = db.transaction(storeName, "readonly");
  const result = await requestToPromise(tx.objectStore(storeName).get(key));
  await transactionDone(tx);
  return result;
}

export async function putRecord(storeName, value) {
  const db = await openDatabase();
  const tx = db.transaction(storeName, "readwrite");
  tx.objectStore(storeName).put(value);
  await transactionDone(tx);
  return value;
}

export async function deleteRecord(storeName, key) {
  const db = await openDatabase();
  const tx = db.transaction(storeName, "readwrite");
  tx.objectStore(storeName).delete(key);
  await transactionDone(tx);
}

export async function getMetaValue(key, fallback = null) {
  const record = await getRecord("meta", key);
  return record?.value ?? fallback;
}

export async function setMetaValue(key, value) {
  return putRecord("meta", { key, value });
}

export async function getSetting(key, fallback = null) {
  const record = await getRecord("settings", key);
  return record?.value ?? fallback;
}

export async function setSetting(key, value) {
  return putRecord("settings", { key, value });
}

const HIDDEN_PRESET_ITEMS_SETTING = "hiddenPresetItems";

export async function getHiddenPresetItemIds() {
  const saved = await getSetting(HIDDEN_PRESET_ITEMS_SETTING, []);
  const validPresetIds = new Set(PRESET_ITEMS.map(item => item.id));
  return new Set(
    Array.isArray(saved)
      ? saved.filter(itemId => typeof itemId === "string" && validPresetIds.has(itemId))
      : []
  );
}

export async function hidePresetItem(itemId) {
  const item = await getRecord("items", itemId);
  if (!item || item.isCustom || item.imported) throw new Error("Only built-in category items can be removed this way.");
  const hiddenIds = await getHiddenPresetItemIds();
  hiddenIds.add(item.id);
  await setSetting(HIDDEN_PRESET_ITEMS_SETTING, [...hiddenIds].sort());
  return item;
}

export async function restorePresetItem(itemId) {
  const hiddenIds = await getHiddenPresetItemIds();
  hiddenIds.delete(itemId);
  await setSetting(HIDDEN_PRESET_ITEMS_SETTING, [...hiddenIds].sort());
  return getRecord("items", itemId);
}

export async function bumpListRevision() {
  const current = Number(await getMetaValue("listRevision", 1)) || 1;
  const next = current + 1;
  await setMetaValue("listRevision", next);
  return next;
}

export async function getPeople() {
  const people = await getAll("people");
  return people.sort((a, b) => Number(b.isOwner) - Number(a.isOwner) || a.name.localeCompare(b.name));
}

export async function getOwner() {
  return (await getPeople()).find(person => person.isOwner) || null;
}

export async function getLocalIdentity() {
  const owner = await getOwner();
  return owner
    ? { id: owner.id, name: owner.name, owner }
    : { id: LOCAL_REQUESTER_ID, name: "Me", owner: null };
}

export async function savePerson({ id, name, phone = "", photo = "", isOwner = false }) {
  const cleanedName = cleanText(name, 60);
  if (!cleanedName) throw new Error("Please enter the person’s name.");
  const people = await getPeople();
  const existing = id ? people.find(person => person.id === id) : null;
  const personId = existing?.id || generateId("person");
  const now = isoNow();
  const person = {
    id: personId,
    name: cleanedName,
    phone: cleanPhone(phone),
    photo: cleanPhoto(photo),
    isOwner: Boolean(isOwner),
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };

  const db = await openDatabase();
  const tx = db.transaction(["people", "contributions", "mealSuggestions"], "readwrite");
  const personStore = tx.objectStore("people");
  const contributionStore = tx.objectStore("contributions");
  const mealStore = tx.objectStore("mealSuggestions");
  const [allPeople, allContributions, allMeals] = await Promise.all([
    requestToPromise(personStore.getAll()),
    requestToPromise(contributionStore.getAll()),
    requestToPromise(mealStore.getAll())
  ]);

  if (person.isOwner) {
    allPeople.filter(row => row.isOwner && row.id !== person.id).forEach(row => {
      personStore.put({ ...row, isOwner: false, updatedAt: now });
    });
    allContributions.filter(row => row.sourceType === "local" || row.requesterId === LOCAL_REQUESTER_ID).forEach(row => {
      contributionStore.put({ ...row, requesterId: person.id, requesterName: person.name, sourceType: "local", updatedAt: now });
    });
    allMeals.filter(row => row.sourceType === "local" || row.requesterId === LOCAL_REQUESTER_ID).forEach(row => {
      mealStore.put({ ...row, requesterId: person.id, requesterName: person.name, requesterPhoto: person.photo, sourceType: "local", updatedAt: now });
    });
  } else if (existing?.isOwner) {
    person.isOwner = true;
  }

  personStore.put(person);
  await transactionDone(tx);
  await bumpListRevision();
  return person;
}

export async function deletePerson(personId) {
  const person = await getRecord("people", personId);
  if (!person) return;
  const db = await openDatabase();
  const tx = db.transaction(["people", "contributions", "mealSuggestions"], "readwrite");
  tx.objectStore("people").delete(personId);
  if (person.isOwner) {
    const now = isoNow();
    const contributionStore = tx.objectStore("contributions");
    const mealStore = tx.objectStore("mealSuggestions");
    const [contributions, meals] = await Promise.all([
      requestToPromise(contributionStore.getAll()),
      requestToPromise(mealStore.getAll())
    ]);
    contributions.filter(row => row.sourceType === "local").forEach(row => {
      contributionStore.put({ ...row, requesterId: LOCAL_REQUESTER_ID, requesterName: "Me", updatedAt: now });
    });
    meals.filter(row => row.sourceType === "local").forEach(row => {
      mealStore.put({ ...row, requesterId: LOCAL_REQUESTER_ID, requesterName: "Me", requesterPhoto: "", updatedAt: now });
    });
  }
  await transactionDone(tx);
  await bumpListRevision();
}

export async function getItemLibrary() {
  const [categories, items, contributions, hiddenPresetIds] = await Promise.all([
    getAll("categories"), getAll("items"), getAll("contributions"), getHiddenPresetItemIds()
  ]);
  const selectedIds = new Set(
    contributions
      .filter(row => row.sourceType === "local" && row.status !== "cleared")
      .map(row => row.itemId)
  );
  const localLibraryItems = items
    // Normal received custom items are permanent category items. The imported
    // flag is now reserved only for a custom item the local user deliberately
    // removed while another person's active request still needs its definition.
    .filter(item => !item.imported)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  return {
    categories: categories.sort((a, b) => {
      const aIndex = CATEGORIES.findIndex(category => category.id === a.id);
      const bIndex = CATEGORIES.findIndex(category => category.id === b.id);
      return (aIndex < 0 ? 999 : aIndex) - (bIndex < 0 ? 999 : bIndex);
    }),
    // Custom items received from another person's list remain available in
    // their matching category for future shopping lists on this device.
    items: localLibraryItems.filter(item => item.isCustom || !hiddenPresetIds.has(item.id)),
    hiddenItems: localLibraryItems.filter(item => !item.isCustom && hiddenPresetIds.has(item.id)),
    hiddenPresetIds,
    selectedIds,
    localContributions: contributions.filter(row => row.sourceType === "local" && row.status !== "cleared")
  };
}

export async function moveCategoryItem(itemId, direction) {
  const [item, allItems, hiddenPresetIds] = await Promise.all([
    getRecord("items", itemId),
    getAll("items"),
    getHiddenPresetItemIds()
  ]);
  if (!item || item.imported) throw new Error("That item cannot be reordered.");
  const visible = allItems
    .filter(candidate => candidate.categoryId === item.categoryId && !candidate.imported && (candidate.isCustom || !hiddenPresetIds.has(candidate.id)))
    .sort((a, b) => {
      const aSort = Number.isFinite(Number(a.sortOrder)) ? Number(a.sortOrder) : Number.MAX_SAFE_INTEGER;
      const bSort = Number.isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : Number.MAX_SAFE_INTEGER;
      return aSort - bSort || a.name.localeCompare(b.name);
    });
  const index = visible.findIndex(candidate => candidate.id === itemId);
  if (index < 0) throw new Error("That item is not currently visible in this category.");

  let targetIndex = index;
  if (direction === "top") targetIndex = 0;
  else if (direction === "up") targetIndex = Math.max(0, index - 1);
  else if (direction === "down") targetIndex = Math.min(visible.length - 1, index + 1);
  else throw new Error("Choose Up, Down, or Top.");
  if (targetIndex === index) return false;

  const reordered = [...visible];
  const [moved] = reordered.splice(index, 1);
  reordered.splice(targetIndex, 0, moved);

  // Reuse the category's existing visible sort slots. This moves the chosen
  // item without disturbing the positions of any items the user has hidden.
  let slots = visible.map(candidate => Number(candidate.sortOrder));
  const invalidSlots = slots.some(value => !Number.isFinite(value)) || new Set(slots).size !== slots.length;
  if (invalidSlots) {
    const categoryIndex = Math.max(0, CATEGORIES.findIndex(category => category.id === item.categoryId));
    const base = categoryIndex * 1000;
    slots = visible.map((_, position) => base + position);
  } else {
    slots.sort((a, b) => a - b);
  }

  const now = isoNow();
  const db = await openDatabase();
  const tx = db.transaction("items", "readwrite");
  const store = tx.objectStore("items");
  reordered.forEach((candidate, position) => {
    store.put({ ...candidate, sortOrder: slots[position], updatedAt: now });
  });
  await transactionDone(tx);
  await bumpListRevision();
  return true;
}

export async function toggleLocalItem(itemId) {
  const identity = await getLocalIdentity();
  const db = await openDatabase();
  const readTx = db.transaction(["contributions", "items"], "readonly");
  const [allContributions, item] = await Promise.all([
    requestToPromise(readTx.objectStore("contributions").index("itemId").getAll(itemId)),
    requestToPromise(readTx.objectStore("items").get(itemId))
  ]);
  await transactionDone(readTx);
  const match = allContributions.find(row => row.sourceType === "local" && row.status !== "cleared");
  if (!item) throw new Error("That item could not be found.");

  const tx = db.transaction("contributions", "readwrite");
  const store = tx.objectStore("contributions");
  if (match) {
    store.delete(match.id);
  } else {
    const now = isoNow();
    store.put({
      id: generateId("contribution"),
      itemId,
      requesterId: identity.id,
      requesterName: identity.name,
      explicitQuantity: null,
      store: item.defaultStore || "Coles",
      status: "active",
      sourceType: "local",
      sourceSenderId: null,
      originContributionId: null,
      createdAt: now,
      updatedAt: now
    });
  }
  await transactionDone(tx);
  await bumpListRevision();
  return !match;
}

export async function createCustomItem({ name, categoryId, store = "Coles", addNow = true }) {
  const cleanedName = cleanText(name, 80);
  if (!cleanedName) throw new Error("Please enter an item name.");
  if (!CATEGORIES.some(category => category.id === categoryId)) throw new Error("Please choose a valid category.");
  const safeDefaultStore = safeStore(store);
  const [items, identity, allContributions] = await Promise.all([getAll("items"), getLocalIdentity(), getAll("contributions")]);
  const duplicate = items.find(candidate => candidate.categoryId === categoryId && candidate.normalisedName === normaliseName(cleanedName));
  if (duplicate && !duplicate.imported) throw new Error(`${duplicate.name} already exists in this category.`);
  let item = duplicate?.imported ? {
    ...duplicate,
    name: cleanedName,
    normalisedName: normaliseName(cleanedName),
    defaultStore: safeDefaultStore,
    imported: false,
    updatedAt: isoNow()
  } : null;
  const db = await openDatabase();
  const tx = db.transaction(["items", "contributions"], "readwrite");
  const itemStore = tx.objectStore("items");
  const contributionStore = tx.objectStore("contributions");
  const now = isoNow();

  if (!item) {
    item = {
      id: generateId("custom-item"),
      categoryId,
      name: cleanedName,
      normalisedName: normaliseName(cleanedName),
      defaultStore: safeDefaultStore,
      isCustom: true,
      sortOrder: Date.now(),
      createdAt: now,
      updatedAt: now
    };
  }
  itemStore.put(item);
  if (addNow) {
    const local = allContributions.find(row => row.itemId === item.id && row.sourceType === "local" && row.status !== "cleared");
    if (!local) {
      contributionStore.put({
        id: generateId("contribution"), itemId: item.id,
        requesterId: identity.id, requesterName: identity.name,
        explicitQuantity: null, store: safeDefaultStore, status: "active",
        sourceType: "local", sourceSenderId: null, originContributionId: null,
        createdAt: now, updatedAt: now
      });
    }
  }
  await transactionDone(tx);
  await bumpListRevision();
  return item;
}

export async function updateCustomItem({ id, name, categoryId, store }) {
  const item = await getRecord("items", id);
  if (!item?.isCustom || item.imported) throw new Error("Only your own custom items can be changed here.");
  const cleanedName = cleanText(name, 80);
  if (!cleanedName) throw new Error("Please enter an item name.");
  if (!CATEGORIES.some(category => category.id === categoryId)) throw new Error("Please choose a valid category.");
  const allItems = await getAll("items");
  const duplicate = allItems.find(candidate =>
    candidate.id !== id &&
    candidate.categoryId === categoryId &&
    candidate.normalisedName === normaliseName(cleanedName)
  );
  if (duplicate && !duplicate.imported) throw new Error(`${duplicate.name} already exists in this category.`);
  const updated = {
    ...item,
    name: cleanedName,
    normalisedName: normaliseName(cleanedName),
    categoryId,
    defaultStore: safeStore(store),
    updatedAt: isoNow()
  };
  if (duplicate?.imported) {
    const contributions = await getAll("contributions");
    const db = await openDatabase();
    const tx = db.transaction(["items", "contributions"], "readwrite");
    const itemStore = tx.objectStore("items");
    const contributionStore = tx.objectStore("contributions");
    const existingLocal = contributions.find(row => row.itemId === item.id && row.sourceType === "local" && row.status !== "cleared");
    contributions.filter(row => row.itemId === duplicate.id).forEach(row => {
      if (row.sourceType === "local" && existingLocal && row.status !== "cleared") contributionStore.delete(row.id);
      else contributionStore.put({ ...row, itemId: item.id, updatedAt: isoNow() });
    });
    itemStore.delete(duplicate.id);
    itemStore.put(updated);
    await transactionDone(tx);
  } else {
    await putRecord("items", updated);
  }
  await bumpListRevision();
  return updated;
}

export async function deleteCustomItem(itemId) {
  const item = await getRecord("items", itemId);
  if (!item?.isCustom || item.imported) throw new Error("Only your own custom items can be deleted.");
  const contributions = await getAll("contributions");
  const itemContributions = contributions.filter(row => row.itemId === itemId);
  const activeOtherRequests = itemContributions.filter(row => row.sourceType !== "local" && row.status !== "cleared");
  const db = await openDatabase();
  const tx = db.transaction(["items", "contributions"], "readwrite");
  const itemStore = tx.objectStore("items");
  const contributionStore = tx.objectStore("contributions");
  if (activeOtherRequests.length) {
    // Remove local ownership and local requests while preserving requests that
    // belong to somebody else. The shared definition remains transfer-only and
    // disappears from this device's permanent custom-item library.
    itemStore.put({ ...item, imported: true, updatedAt: isoNow() });
    itemContributions.filter(row => row.sourceType === "local").forEach(row => contributionStore.delete(row.id));
  } else {
    itemStore.delete(itemId);
    itemContributions.forEach(row => contributionStore.delete(row.id));
  }
  await transactionDone(tx);
  await bumpListRevision();
  return { preservedSharedRequests: activeOtherRequests.length > 0 };
}

function combineStorePreferences(contributions) {
  const stores = [...new Set(contributions.map(row => row.store || "Either"))];
  return stores.length === 1 ? stores[0] : "Different";
}

export async function getCombinedShoppingList() {
  const [items, categories, contributions, people, owner] = await Promise.all([
    getAll("items"), getAll("categories"), getAll("contributions"), getPeople(), getOwner()
  ]);
  const itemMap = new Map(items.map(item => [item.id, item]));
  const categoryMap = new Map(categories.map(category => [category.id, category]));
  const personMap = new Map(people.map(person => [person.id, person]));
  const grouped = new Map();
  for (const contribution of contributions.filter(row => row.status !== "cleared")) {
    const item = itemMap.get(contribution.itemId);
    if (!item) continue;
    if (!grouped.has(item.id)) grouped.set(item.id, []);
    grouped.get(item.id).push(contribution);
  }

  const combined = [...grouped.entries()].map(([itemId, rows]) => {
    const item = itemMap.get(itemId);
    const statuses = new Set(rows.map(row => row.status));
    const status = statuses.has("active") ? "active" : statuses.has("unavailable") ? "unavailable" : "got";
    const explicit = rows.filter(row => Number.isFinite(row.explicitQuantity) && row.explicitQuantity > 0);
    const quantity = explicit.length ? explicit.reduce((sum, row) => sum + row.explicitQuantity, 0) : 1;
    const requesters = [...new Map(rows.map(row => {
      const localName = row.sourceType === "local" ? (owner?.name || "Me") : null;
      const displayName = localName || personMap.get(row.requesterId)?.name || row.requesterName || "Someone";
      return [normaliseName(displayName), displayName];
    })).values()];
    return {
      itemId,
      item,
      category: categoryMap.get(item.categoryId),
      contributions: rows,
      status,
      quantity,
      requesters,
      store: combineStorePreferences(rows),
      requesterStores: rows.map(row => ({
        name: row.sourceType === "local" ? (owner?.name || "Me") : (personMap.get(row.requesterId)?.name || row.requesterName || "Someone"),
        store: row.store || "Either"
      }))
    };
  });

  const categoryOrder = new Map(CATEGORIES.map((category, index) => [category.id, index]));
  combined.sort((a, b) => {
    const aSort = Number.isFinite(Number(a.item.sortOrder)) ? Number(a.item.sortOrder) : Number.MAX_SAFE_INTEGER;
    const bSort = Number.isFinite(Number(b.item.sortOrder)) ? Number(b.item.sortOrder) : Number.MAX_SAFE_INTEGER;
    return (categoryOrder.get(a.item.categoryId) ?? 999) - (categoryOrder.get(b.item.categoryId) ?? 999) ||
      aSort - bSort ||
      a.item.name.localeCompare(b.item.name);
  });
  return combined;
}

export async function setItemStatus(itemId, status) {
  if (!ALLOWED_STATUSES.has(status)) throw new Error("Invalid shopping status.");
  const rows = (await getAll("contributions")).filter(row => row.itemId === itemId && row.status !== "cleared");
  const db = await openDatabase();
  const tx = db.transaction("contributions", "readwrite");
  const store = tx.objectStore("contributions");
  const now = isoNow();
  rows.forEach(row => store.put({ ...row, status, updatedAt: now }));
  await transactionDone(tx);
  await bumpListRevision();
}

export async function changeLocalQuantity(itemId, delta) {
  const rows = (await getAll("contributions")).filter(row => row.itemId === itemId && row.status !== "cleared");
  const local = rows.find(row => row.sourceType === "local");
  if (!local) throw new Error("Only your own quantity can be changed on this device.");
  const amount = Number(delta);
  if (!Number.isFinite(amount) || amount === 0) return local.explicitQuantity ?? null;
  const explicit = Number.isFinite(local.explicitQuantity) && local.explicitQuantity > 0
    ? Number(local.explicitQuantity)
    : null;
  let next = explicit;
  if (amount > 0) next = Math.min(9999, (explicit ?? 1) + amount);
  else if (explicit !== null) next = explicit + amount <= 1 ? null : Math.max(2, explicit + amount);
  if (next === explicit) return next;
  await putRecord("contributions", { ...local, explicitQuantity: next, updatedAt: isoNow() });
  await bumpListRevision();
  return next;
}

export async function changeLocalStore(itemId, storePreference) {
  const rows = (await getAll("contributions")).filter(row => row.itemId === itemId && row.status !== "cleared");
  const local = rows.find(row => row.sourceType === "local");
  if (!local) throw new Error("Only your own store choice can be changed on this device.");
  const nextStore = safeStore(storePreference);
  if (local.store === nextStore) return nextStore;
  await putRecord("contributions", { ...local, store: nextStore, updatedAt: isoNow() });
  await bumpListRevision();
  return nextStore;
}

export async function removeLocalItem(itemId) {
  const rows = (await getAll("contributions")).filter(row => row.itemId === itemId && row.sourceType === "local" && row.status !== "cleared");
  if (!rows.length) throw new Error("Your request for this item is no longer on the list.");
  const db = await openDatabase();
  const tx = db.transaction("contributions", "readwrite");
  const store = tx.objectStore("contributions");
  rows.forEach(row => store.delete(row.id));
  await transactionDone(tx);
  await bumpListRevision();
  return rows.length;
}

export async function finishShopping() {
  const all = await getAll("contributions");
  const db = await openDatabase();
  const tx = db.transaction("contributions", "readwrite");
  const store = tx.objectStore("contributions");
  const now = isoNow();
  all.forEach(row => {
    if (row.status === "got") store.put({ ...row, status: "cleared", clearedAt: now, updatedAt: now });
    if (row.status === "unavailable") store.put({ ...row, status: "active", updatedAt: now });
  });
  await transactionDone(tx);
  await bumpListRevision();
}

export async function getMealSuggestions() {
  const [meals, people, owner] = await Promise.all([getAll("mealSuggestions"), getPeople(), getOwner()]);
  const personById = new Map(people.map(person => [person.id, person]));
  const personByName = new Map(people.map(person => [normaliseName(person.name), person]));
  return meals
    .map(row => {
      const matchedPerson = personById.get(row.requesterId) || personByName.get(normaliseName(row.requesterName));
      const displayRequesterName = row.sourceType === "local"
        ? (owner?.name || "Me")
        : (matchedPerson?.name || row.requesterName || "Someone");
      const displayRequesterPhoto = row.sourceType === "local"
        ? cleanPhoto(owner?.photo)
        : cleanPhoto(row.requesterPhoto || matchedPerson?.photo);
      return { ...row, displayRequesterName, displayRequesterPhoto };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function toggleMealSuggestion(name) {
  const identity = await getLocalIdentity();
  const all = await getAll("mealSuggestions");
  const existing = all.find(row => normaliseName(row.name) === normaliseName(name) && row.sourceType === "local");
  if (existing) {
    await deleteRecord("mealSuggestions", existing.id);
    await bumpListRevision();
    return false;
  }
  const now = isoNow();
  await putRecord("mealSuggestions", {
    id: generateId("meal"), name: cleanText(name, 80),
    requesterId: identity.id, requesterName: identity.name,
    requesterPhoto: cleanPhoto(identity.owner?.photo),
    sourceType: "local", sourceSenderId: null,
    originMealId: null, createdAt: now, updatedAt: now
  });
  await bumpListRevision();
  return true;
}

export async function removeMealSuggestion(mealId) {
  const meal = await getRecord("mealSuggestions", mealId);
  if (!meal || meal.sourceType !== "local") throw new Error("Only your own meal ideas can be removed here.");
  await deleteRecord("mealSuggestions", mealId);
  await bumpListRevision();
}

export async function createMealSuggestion(name) {
  const cleaned = cleanText(name, 80);
  if (!cleaned) throw new Error("Please enter a meal name.");
  const existing = (await getAll("mealSuggestions")).some(row => normaliseName(row.name) === normaliseName(cleaned) && row.sourceType === "local");
  if (existing) throw new Error(`${cleaned} is already saved as a meal idea.`);
  await toggleMealSuggestion(cleaned);
  return cleaned;
}

export async function getSummary() {
  const combined = await getCombinedShoppingList();
  return {
    need: combined.filter(item => item.status === "active").length,
    got: combined.filter(item => item.status === "got").length,
    unavailable: combined.filter(item => item.status === "unavailable").length
  };
}

function transferItemDefinition(item) {
  return {
    itemDefinitionId: item.isCustom ? null : item.id,
    name: item.name,
    categoryId: item.categoryId,
    isCustom: Boolean(item.isCustom),
    defaultStore: safeStore(item.defaultStore)
  };
}

export async function createTransferPayload(destinationPersonId = null) {
  const [owner, deviceId, revision, items, contributions, meals, people] = await Promise.all([
    getOwner(),
    getMetaValue("deviceId"),
    getMetaValue("listRevision", 1),
    getAll("items"),
    getAll("contributions"),
    getAll("mealSuggestions"),
    getPeople()
  ]);
  if (!owner) throw new Error("Please set up My Profile in Settings before sending a list.");
  const destination = people.find(person => person.id === destinationPersonId) || null;
  const itemMap = new Map(items.map(item => [item.id, item]));
  const peopleById = new Map(people.map(person => [person.id, person]));
  const peopleByName = new Map(people.map(person => [normaliseName(person.name), person]));
  const activeRows = contributions.filter(row => row.status !== "cleared" && itemMap.has(row.itemId));
  const mealProfiles = new Map();
  meals.forEach(row => {
    const matchedPerson = peopleById.get(row.requesterId) || peopleByName.get(normaliseName(row.requesterName));
    const requesterId = cleanText(row.requesterId, 160) || owner.id;
    if (!mealProfiles.has(requesterId)) {
      mealProfiles.set(requesterId, {
        requesterId,
        requesterName: cleanText(row.requesterName, 60) || matchedPerson?.name || owner.name,
        photo: cleanPhoto(row.sourceType === "local" ? owner.photo : (row.requesterPhoto || matchedPerson?.photo))
      });
    }
  });
  const createdAt = isoNow();
  return {
    format: "our-shopping-list-transfer",
    version: 1,
    transferId: generateId("transfer"),
    sender: { id: owner.id, name: owner.name },
    destination: destination ? { id: destination.id, name: destination.name } : null,
    sourceDeviceId: deviceId,
    revision: Number(revision) || 1,
    createdAt,
    updatedAt: createdAt,
    items: activeRows.map(row => ({
      originContributionId: row.originContributionId || row.id,
      requesterId: row.requesterId,
      requesterName: row.requesterName || (row.sourceType === "local" ? owner.name : "Someone"),
      explicitQuantity: Number.isFinite(row.explicitQuantity) && row.explicitQuantity > 0 ? row.explicitQuantity : null,
      store: safeStore(row.store),
      status: safeStatus(row.status),
      item: transferItemDefinition(itemMap.get(row.itemId))
    })),
    mealSuggestions: meals.map(row => ({
      originMealId: row.originMealId || row.id,
      name: cleanText(row.name, 80),
      requesterId: row.requesterId,
      requesterName: row.requesterName || (row.sourceType === "local" ? owner.name : "Someone")
    })),
    mealProfiles: [...mealProfiles.values()]
  };
}

export function validateTransferPayload(payload) {
  if (!payload || typeof payload !== "object") throw new Error("This file does not contain a shopping list.");
  if (payload.format !== "our-shopping-list-transfer") throw new Error("This is not an Our Shopping List transfer file.");
  if (payload.version !== 1) throw new Error("This list was made by an unsupported app version.");
  if (!cleanText(payload.transferId, 160)) throw new Error("The list transfer ID is missing.");
  if (!payload.sender || !cleanText(payload.sender.id, 160) || !cleanText(payload.sender.name, 60)) throw new Error("The list sender details are missing.");
  if (!cleanText(payload.sourceDeviceId, 160)) throw new Error("The source device details are missing.");
  if (!Number.isInteger(Number(payload.revision)) || Number(payload.revision) < 1) throw new Error("The list revision is invalid.");
  if (!Array.isArray(payload.items) || !Array.isArray(payload.mealSuggestions)) throw new Error("The shopping list file is incomplete.");
  if (payload.mealProfiles !== undefined && !Array.isArray(payload.mealProfiles)) throw new Error("The meal profile details are invalid.");
  if (payload.items.length > 2000 || payload.mealSuggestions.length > 500 || (payload.mealProfiles?.length || 0) > 100) throw new Error("This transfer is too large to import safely.");
  const originIds = new Set();
  payload.items.forEach((row, index) => {
    if (!row?.item || !cleanText(row.item.name, 80) || !cleanText(row.item.categoryId, 80)) {
      throw new Error(`Item ${index + 1} in the transfer is invalid.`);
    }
    const originId = cleanText(row.originContributionId, 180);
    if (!originId) throw new Error(`Item ${index + 1} is missing its stable request ID.`);
    if (originIds.has(originId)) throw new Error("This transfer contains the same request more than once.");
    originIds.add(originId);
    if (row.explicitQuantity !== null && row.explicitQuantity !== undefined &&
        (!Number.isFinite(row.explicitQuantity) || row.explicitQuantity <= 0 || row.explicitQuantity > 9999)) {
      throw new Error(`Item ${index + 1} has an invalid quantity.`);
    }
  });
  const profileIds = new Set();
  (payload.mealProfiles || []).forEach((profile, index) => {
    const requesterId = cleanText(profile?.requesterId, 160);
    if (!requesterId || !cleanText(profile?.requesterName, 60)) throw new Error(`Meal profile ${index + 1} is invalid.`);
    if (profileIds.has(requesterId)) throw new Error("This transfer contains the same meal profile more than once.");
    if (profile.photo && !cleanPhoto(profile.photo)) throw new Error(`Meal profile ${index + 1} has an invalid photo.`);
    profileIds.add(requesterId);
  });
  const mealOriginIds = new Set();
  payload.mealSuggestions.forEach((row, index) => {
    if (!row || !cleanText(row.name, 80)) throw new Error(`Meal idea ${index + 1} is invalid.`);
    const originId = cleanText(row.originMealId, 180);
    if (!originId) throw new Error(`Meal idea ${index + 1} is missing its stable request ID.`);
    if (mealOriginIds.has(originId)) throw new Error("This transfer contains the same meal idea more than once.");
    mealOriginIds.add(originId);
  });
  return payload;
}

function logicalTransferKey(row) {
  const definitionId = cleanText(row?.item?.itemDefinitionId, 160);
  return definitionId || `${safeCategoryId(row?.item?.categoryId)}:${normaliseName(row?.item?.name)}`;
}

export async function previewTransfer(payload) {
  validateTransferPayload(payload);
  const [imports, contributions, items, meals] = await Promise.all([
    getAll("imports"), getAll("contributions"), getAll("items"), getAll("mealSuggestions")
  ]);
  const senderImports = imports.filter(record => record.senderId === payload.sender.id);
  const latestSenderImport = senderImports.find(record => record.isCurrent === true) || [...senderImports].sort((a, b) =>
    String(b.importedAt || "").localeCompare(String(a.importedAt || ""))
  )[0] || null;
  const sourceImports = senderImports.filter(record => record.sourceDeviceId === payload.sourceDeviceId);
  const latestRevision = sourceImports.reduce((max, record) => Math.max(max, Number(record.revision) || 0), 0);
  const exactCurrentTransfer = latestSenderImport?.transferId === payload.transferId;
  const exactKnownTransfer = sourceImports.some(record => record.transferId === payload.transferId);
  const incomingRevision = Number(payload.revision);
  const unknownRepeatedRevision = !exactKnownTransfer && latestRevision > 0 && incomingRevision === latestRevision;
  const unknownStaleRevision = !exactKnownTransfer && incomingRevision < latestRevision;
  const itemMap = new Map(items.map(item => [item.id, item]));
  const existingRows = contributions.filter(row => row.sourceSenderId === payload.sender.id && row.status !== "cleared");
  const existingKeys = new Set(existingRows.map(row => {
    const item = itemMap.get(row.itemId);
    return item ? (item.isCustom ? `${item.categoryId}:${normaliseName(item.name)}` : item.id) : row.itemId;
  }));
  const incomingKeys = new Set(payload.items.map(logicalTransferKey));
  const added = [...incomingKeys].filter(key => !existingKeys.has(key)).length;
  const removed = [...existingKeys].filter(key => !incomingKeys.has(key)).length;
  const existingMeals = new Set(meals.filter(row => row.sourceSenderId === payload.sender.id).map(row => normaliseName(row.name)));
  const incomingMeals = new Set(payload.mealSuggestions.map(row => normaliseName(row.name)));
  const mealsAdded = [...incomingMeals].filter(key => !existingMeals.has(key)).length;
  return {
    status: exactCurrentTransfer || unknownRepeatedRevision ? "up-to-date" : unknownStaleRevision ? "older" : (latestSenderImport ? "updated" : "new"),
    senderName: cleanText(payload.sender.name, 60),
    revision: Number(payload.revision),
    latestRevision,
    totalItems: payload.items.length,
    totalMeals: payload.mealSuggestions.length,
    added,
    removed,
    mealsAdded
  };
}

function findLocalItemForTransfer(transferItem, items) {
  const definitionId = cleanText(transferItem.itemDefinitionId, 160);
  if (definitionId) {
    const preset = items.find(item => item.id === definitionId && !item.isCustom);
    if (preset) return preset;
  }
  const key = normaliseName(transferItem.name);
  const categoryId = safeCategoryId(transferItem.categoryId);
  return items.find(item => item.categoryId === categoryId && item.normalisedName === key) || null;
}

export async function acceptTransfer(payload) {
  validateTransferPayload(payload);
  const preview = await previewTransfer(payload);
  if (["up-to-date", "older"].includes(preview.status)) return { ...preview, changed: false };

  const [items, contributions, meals, imports] = await Promise.all([
    getAll("items"), getAll("contributions"), getAll("mealSuggestions"), getAll("imports")
  ]);
  const workingItems = [...items];
  const itemAdds = [];
  const contributionDeletes = contributions.filter(row => row.sourceSenderId === payload.sender.id).map(row => row.id);
  const mealDeletes = meals.filter(row => row.sourceSenderId === payload.sender.id).map(row => row.id);
  const contributionUpdates = [];
  const contributionAdds = [];
  const mealUpdates = [];
  const mealAdds = [];
  const now = isoNow();

  for (const transferRow of payload.items) {
    let item = findLocalItemForTransfer(transferRow.item, workingItems);
    if (!item) {
      item = {
        id: generateId("custom-item"),
        categoryId: safeCategoryId(transferRow.item.categoryId),
        name: cleanText(transferRow.item.name, 80),
        normalisedName: normaliseName(transferRow.item.name),
        defaultStore: safeStore(transferRow.item.defaultStore),
        isCustom: true,
        imported: false,
        receivedFromList: true,
        sortOrder: Date.now() + itemAdds.length,
        createdAt: now,
        updatedAt: now
      };
      workingItems.push(item);
      itemAdds.push(item);
    }

    const originId = cleanText(transferRow.originContributionId, 180);
    const matchingOrigin = contributions.find(row => (row.originContributionId || row.id) === originId && row.sourceSenderId !== payload.sender.id);
    if (matchingOrigin) {
      const requesterId = cleanText(transferRow.requesterId, 160) || payload.sender.id;
      const senderIsOriginalRequester = requesterId === payload.sender.id;
      if (senderIsOriginalRequester && matchingOrigin.sourceType !== "local") {
        // A direct update from the original requester becomes authoritative over
        // an earlier forwarded copy. Move provenance to the original requester
        // so a later update from the forwarding sender cannot delete it.
        contributionUpdates.push({
          ...matchingOrigin,
          itemId: item.id,
          requesterId,
          requesterName: cleanText(transferRow.requesterName, 60) || payload.sender.name,
          status: safeStatus(transferRow.status),
          store: safeStore(transferRow.store),
          explicitQuantity: Number.isFinite(transferRow.explicitQuantity) && transferRow.explicitQuantity > 0 ? Number(transferRow.explicitQuantity) : null,
          sourceType: "imported",
          sourceSenderId: payload.sender.id,
          sourceTransferId: payload.transferId,
          originContributionId: originId,
          updatedAt: now
        });
      } else if (["got", "unavailable"].includes(safeStatus(transferRow.status))) {
        // A shopper can return a result for somebody else's stable request.
        // Only the result status is applied; requester quantity/store ownership
        // remains with the original source.
        contributionUpdates.push({
          ...matchingOrigin,
          status: safeStatus(transferRow.status),
          updatedAt: now
        });
      }
    } else {
      contributionAdds.push({
        id: generateId("contribution"),
        itemId: item.id,
        requesterId: cleanText(transferRow.requesterId, 160) || payload.sender.id,
        requesterName: cleanText(transferRow.requesterName, 60) || payload.sender.name,
        explicitQuantity: Number.isFinite(transferRow.explicitQuantity) && transferRow.explicitQuantity > 0 ? Number(transferRow.explicitQuantity) : null,
        store: safeStore(transferRow.store),
        status: safeStatus(transferRow.status),
        sourceType: "imported",
        sourceSenderId: payload.sender.id,
        sourceTransferId: payload.transferId,
        originContributionId: originId,
        createdAt: now,
        updatedAt: now
      });
    }
  }

  const mealProfileMap = new Map((payload.mealProfiles || []).map(profile => [cleanText(profile.requesterId, 160), profile]));
  for (const transferMeal of payload.mealSuggestions) {
    const originMealId = cleanText(transferMeal.originMealId, 180);
    const requesterId = cleanText(transferMeal.requesterId, 160) || payload.sender.id;
    const name = cleanText(transferMeal.name, 80);
    const profile = mealProfileMap.get(requesterId);
    const requesterPhoto = cleanPhoto(profile?.photo || transferMeal.requesterPhoto);
    const matchingOrigin = meals.find(row => (row.originMealId || row.id) === originMealId && row.sourceSenderId !== payload.sender.id);
    if (matchingOrigin) {
      if (requesterId === payload.sender.id && matchingOrigin.sourceType !== "local") {
        mealUpdates.push({
          ...matchingOrigin,
          name,
          requesterId,
          requesterName: cleanText(transferMeal.requesterName, 60) || profile?.requesterName || payload.sender.name,
          requesterPhoto,
          sourceType: "imported",
          sourceSenderId: payload.sender.id,
          sourceTransferId: payload.transferId,
          originMealId,
          updatedAt: now
        });
      }
      continue;
    }
    mealAdds.push({
      id: generateId("meal"),
      name,
      requesterId,
      requesterName: cleanText(transferMeal.requesterName, 60) || profile?.requesterName || payload.sender.name,
      requesterPhoto,
      sourceType: "imported",
      sourceSenderId: payload.sender.id,
      sourceTransferId: payload.transferId,
      originMealId,
      createdAt: now,
      updatedAt: now
    });
  }

  const db = await openDatabase();
  const tx = db.transaction(["items", "contributions", "mealSuggestions", "imports"], "readwrite");
  const itemStore = tx.objectStore("items");
  const contributionStore = tx.objectStore("contributions");
  const mealStore = tx.objectStore("mealSuggestions");
  itemAdds.forEach(row => itemStore.put(row));
  contributionDeletes.forEach(id => contributionStore.delete(id));
  contributionUpdates.forEach(row => contributionStore.put(row));
  contributionAdds.forEach(row => contributionStore.put(row));
  mealDeletes.forEach(id => mealStore.delete(id));
  mealUpdates.forEach(row => mealStore.put(row));
  mealAdds.forEach(row => mealStore.put(row));
  const importStore = tx.objectStore("imports");
  imports.filter(record => record.senderId === payload.sender.id && record.isCurrent === true).forEach(record => {
    importStore.put({ ...record, isCurrent: false });
  });
  importStore.put({
    transferId: payload.transferId,
    senderId: payload.sender.id,
    senderName: cleanText(payload.sender.name, 60),
    sourceDeviceId: cleanText(payload.sourceDeviceId, 160),
    revision: Number(payload.revision),
    importedAt: now,
    isCurrent: true
  });
  await transactionDone(tx);
  await bumpListRevision();
  return { ...preview, changed: true };
}

export async function exportFullBackup() {
  const data = {};
  for (const store of BACKUP_STORES) data[store] = await getAll(store);
  return {
    format: "our-shopping-list-backup",
    version: 1,
    schemaVersion: DB_VERSION,
    exportedAt: isoNow(),
    data
  };
}

export function validateBackup(backup) {
  if (!isPlainRecord(backup)) throw new Error("The selected file is not a valid backup.");
  if (backup.format !== "our-shopping-list-backup" || backup.version !== 1) throw new Error("This is not a supported Our Shopping List backup.");
  const schemaVersion = Number(backup.schemaVersion);
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) throw new Error("The backup schema version is invalid.");
  if (schemaVersion > DB_VERSION) throw new Error("This backup was made by a newer version of Our Shopping List.");
  if (!isPlainRecord(backup.data)) throw new Error("The backup data is missing.");
  const countLimits = {
    meta: 100, settings: 100, people: 500, categories: 100,
    items: 10_000, contributions: 50_000, mealSuggestions: 5_000, imports: 10_000
  };
  const keyFields = {
    meta: "key", settings: "key", people: "id", categories: "id",
    items: "id", contributions: "id", mealSuggestions: "id", imports: "transferId"
  };
  for (const store of BACKUP_STORES) {
    if (!Array.isArray(backup.data[store])) throw new Error(`The backup is missing ${store} data.`);
    if (backup.data[store].length > countLimits[store]) throw new Error(`The backup contains too many ${store} records.`);
    const seenKeys = new Set();
    for (const record of backup.data[store]) {
      if (!isPlainRecord(record)) throw new Error(`The backup contains an invalid ${store} record.`);
      const key = cleanText(record[keyFields[store]], 200);
      if (!key) throw new Error(`The backup contains a ${store} record without an ID.`);
      if (seenKeys.has(key)) throw new Error(`The backup contains a duplicate ${store} ID.`);
      seenKeys.add(key);
    }
  }
  for (const person of backup.data.people) {
    if (!cleanText(person.name, 60)) throw new Error("The backup contains a person without a name.");
    if (typeof person.photo === "string" && person.photo.length > 2_500_000) throw new Error("A profile photo in this backup is too large.");
  }
  for (const item of backup.data.items) {
    if (!cleanText(item.name, 80) || !cleanText(item.categoryId, 80)) throw new Error("The backup contains an invalid shopping item.");
  }
  for (const row of backup.data.contributions) {
    if (!cleanText(row.itemId, 200) || !STORED_STATUSES.has(row.status)) throw new Error("The backup contains an invalid list request.");
  }
  for (const meal of backup.data.mealSuggestions) {
    if (!cleanText(meal.name, 80)) throw new Error("The backup contains an invalid meal idea.");
  }
  const currentImportSenders = new Set();
  for (const record of backup.data.imports) {
    if (!cleanText(record.senderId, 160) || !cleanText(record.sourceDeviceId, 160) ||
        !Number.isInteger(Number(record.revision)) || Number(record.revision) < 1) {
      throw new Error("The backup contains invalid transfer history.");
    }
    if (record.isCurrent === true) {
      if (currentImportSenders.has(record.senderId)) throw new Error("The backup contains more than one current list for the same sender.");
      currentImportSenders.add(record.senderId);
    }
  }
  const sizeEstimate = JSON.stringify(backup).length;
  if (sizeEstimate > 30_000_000) throw new Error("This backup is too large to restore safely.");
  return backup;
}

function normaliseImportCurrentMarkers(records) {
  const grouped = new Map();
  records.forEach(record => {
    if (!grouped.has(record.senderId)) grouped.set(record.senderId, []);
    grouped.get(record.senderId).push({ ...record });
  });
  const output = [];
  for (const senderRecords of grouped.values()) {
    let current = senderRecords.find(record => record.isCurrent === true) || [...senderRecords].sort((a, b) =>
      String(b.importedAt || "").localeCompare(String(a.importedAt || ""))
    )[0];
    senderRecords.forEach(record => output.push({ ...record, isCurrent: record.transferId === current?.transferId }));
  }
  return output;
}

async function ensureCoreLibrary() {
  const db = await openDatabase();
  const tx = db.transaction(["categories", "items"], "readwrite");
  const categoryStore = tx.objectStore("categories");
  const itemStore = tx.objectStore("items");
  const items = await requestToPromise(itemStore.getAll());
  const itemMap = new Map(items.map(row => [row.id, row]));
  const now = isoNow();
  CATEGORIES.forEach(row => categoryStore.put(row));
  PRESET_ITEMS.forEach(row => {
    const existing = itemMap.get(row.id);
    itemStore.put({
      ...existing,
      ...row,
      normalisedName: normaliseName(row.name),
      createdAt: existing?.createdAt || now,
      updatedAt: existing?.updatedAt || now
    });
  });
  await transactionDone(tx);
}

export async function restoreFullBackup(backup) {
  validateBackup(backup);
  const currentDeviceId = await getMetaValue("deviceId", generateId("device"));
  const currentRevision = Number(await getMetaValue("listRevision", 1)) || 1;
  const backupDeviceId = backup.data.meta.find(record => record?.key === "deviceId")?.value || null;
  const backupRevision = Number(backup.data.meta.find(record => record?.key === "listRevision")?.value) || 1;
  const restoredRevision = Math.max(currentRevision, backupRevision) + 1;
  const restoredData = Object.fromEntries(BACKUP_STORES.map(store => [store, [...backup.data[store]]]));
  restoredData.imports = normaliseImportCurrentMarkers(restoredData.imports);
  restoredData.meta = backup.data.meta
    .filter(record => !["deviceId", "schemaVersion", "listRevision"].includes(record?.key))
    .concat([
      { key: "deviceId", value: currentDeviceId },
      { key: "schemaVersion", value: DB_VERSION },
      { key: "listRevision", value: restoredRevision }
    ]);

  const pinRecord = restoredData.settings.find(record => record?.key === "settingsPin");
  const legacyPinCannotMove = Boolean(
    pinRecord?.value?.hash &&
    (!pinRecord.value.version || !pinRecord.value.salt) &&
    backupDeviceId && backupDeviceId !== currentDeviceId
  );
  restoredData.settings = restoredData.settings.filter(record => record?.key !== "restoreNotice" && (!legacyPinCannotMove || record?.key !== "settingsPin"));
  if (!restoredData.settings.some(record => record.key === "accessibility")) {
    restoredData.settings.push({ key: "accessibility", value: { extraLargeText: true } });
  }
  restoredData.settings.push({
    key: "restoreNotice",
    value: {
      message: legacyPinCannotMove
        ? "Backup restored successfully. The old Settings PIN was safely turned off because this is a different device."
        : "Backup restored successfully."
    }
  });

  const db = await openDatabase();
  const tx = db.transaction(BACKUP_STORES, "readwrite");
  for (const storeName of BACKUP_STORES) {
    const store = tx.objectStore(storeName);
    store.clear();
    restoredData[storeName].forEach(record => store.put(record));
  }
  await transactionDone(tx);
  await ensureCoreLibrary();
  return { pinReset: legacyPinCannotMove };
}

async function hashPin(pin, salt) {
  const bytes = new TextEncoder().encode(`${String(salt || "pin")}:${String(pin || "")}`);
  if (crypto.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
  }
  let hash = 2166136261;
  bytes.forEach(value => { hash ^= value; hash = Math.imul(hash, 16777619); });
  return `fallback-${(hash >>> 0).toString(16)}`;
}

async function legacyPinHash(pin) {
  return hashPin(pin, await getMetaValue("deviceId", "device"));
}

export async function getPinState() {
  const value = await getSetting("settingsPin", null);
  return { enabled: Boolean(value?.hash) };
}

export async function setSettingsPin(pin) {
  if (!/^\d{4}$/.test(String(pin || ""))) throw new Error("Please enter exactly four numbers.");
  const salt = generateId("pin-salt");
  await setSetting("settingsPin", { version: 2, salt, hash: await hashPin(pin, salt), updatedAt: isoNow() });
}

export async function clearSettingsPin() {
  await deleteRecord("settings", "settingsPin");
}

export async function verifySettingsPin(pin) {
  const value = await getSetting("settingsPin", null);
  if (!value?.hash) return true;
  if (value.version === 2 && value.salt) return value.hash === await hashPin(pin, value.salt);
  const matchesLegacy = value.hash === await legacyPinHash(pin);
  if (matchesLegacy) await setSettingsPin(pin);
  return matchesLegacy;
}

export async function consumeRestoreNotice() {
  const notice = await getSetting("restoreNotice", null);
  if (notice) await deleteRecord("settings", "restoreNotice");
  return cleanText(notice?.message, 220) || "";
}

export async function getAccessibilitySettings() {
  return await getSetting("accessibility", { extraLargeText: true });
}

export async function setAccessibilitySettings(settings) {
  const value = { extraLargeText: settings?.extraLargeText !== false };
  await setSetting("accessibility", value);
  return value;
}
