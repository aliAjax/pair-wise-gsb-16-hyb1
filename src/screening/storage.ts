// 保存层：只负责数据的持久化读写（localStorage），不含任何业务判定。

import type { FollowUpTask, ScreeningStore } from "./types";

const STORAGE_KEY = "hxwl-01.screening-tracker.v1";

export function emptyStore(): ScreeningStore {
  return { version: 1, tasks: [] };
}

export function loadStore(): ScreeningStore {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as Partial<ScreeningStore>;
    if (parsed.version !== 1 || !Array.isArray(parsed.tasks)) return emptyStore();
    return { version: 1, tasks: parsed.tasks as FollowUpTask[] };
  } catch {
    return emptyStore();
  }
}

export function saveStore(store: ScreeningStore): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export function clearStore(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}
