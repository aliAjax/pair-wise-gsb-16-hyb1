// 保存层：只负责与 localStorage 打交道，不包含任何业务判定。
// 读不到 / 解析失败时返回 null，由上层决定是否使用演示资料。

import { buildSeed } from "./data";
import type { Dataset } from "./types";

const STORAGE_KEY = "newborn-hearing-screening:v1";

export function loadDataset(): Dataset {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Dataset;
      if (parsed && Array.isArray(parsed.records)) return parsed;
    }
  } catch {
    // 存储损坏时回落到演示资料
  }
  return buildSeed();
}

export function saveDataset(dataset: Dataset): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dataset));
    return true;
  } catch {
    return false;
  }
}

export function resetDataset(): Dataset {
  const seed = buildSeed();
  saveDataset(seed);
  return seed;
}
