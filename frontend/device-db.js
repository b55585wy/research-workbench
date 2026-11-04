import { openDB } from "./vendor/device-storage/device-storage.js";

export const DEVICE_DB_NAME = "research-workspace-device-v1";
export const DEVICE_STORES = ["documents", "notes", "images", "excerpts", "mutations", "settings"];

let opening;

export function openDeviceDB() {
  if (opening) return opening;
  let rejectBlocked;
  const blocked = new Promise((_, reject) => { rejectBlocked = reject; });
  const opened = openDB(DEVICE_DB_NAME, 1, {
    upgrade(db) {
      const documents = db.createObjectStore("documents", { keyPath: "id" });
      documents.createIndex("sha256", "sha256", { unique: false });
      for (const name of ["notes", "images", "excerpts"]) {
        const store = db.createObjectStore(name, { keyPath: name === "excerpts" ? "note_id" : "id" });
        store.createIndex("document_id", "document_id", { unique: false });
      }
      db.createObjectStore("mutations", { keyPath: "request_id" });
      db.createObjectStore("settings", { keyPath: "key" });
    },
    blocked() {
      rejectBlocked(Object.assign(new Error("Device database upgrade is blocked by another tab."), { name: "DeviceStorageBlockedError" }));
      opened.then((database) => database.close(), () => {});
    },
    blocking() {
      opening = null;
      opened.then((database) => database.close(), () => {});
    },
    terminated() { opening = null; }
  });
  opening = Promise.race([opened, blocked]).catch((error) => {
    opening = null;
    throw error;
  });
  return opening;
}
