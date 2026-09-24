// 基础设施：随机标识。判定规则通过它保持“无外部状态”，但不自己持有计数器。

export function uid(prefix = "id"): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}
