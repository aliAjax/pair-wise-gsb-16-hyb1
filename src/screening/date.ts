// 纯日期工具：不依赖任何第三方库，统一按本地日期处理，避免时区漂移。

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayISO(): string {
  return toISODate(new Date());
}

/** 表单 datetime-local 的当前值 YYYY-MM-DDTHH:mm */
export function nowLocal(): string {
  const d = new Date();
  return `${toISODate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** iso 日期加减天数 */
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

/** b - a 的整天数 */
export function diffDays(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00`).getTime();
  const db = new Date(`${b}T00:00:00`).getTime();
  return Math.round((db - da) / 86400000);
}

/** 出生日龄 */
export function ageDays(birthDate: string, today: string): number {
  return diffDays(birthDate, today);
}

/** 中文星期，用于排班展示 */
export function weekdayCN(iso: string): string {
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][
    new Date(`${iso}T00:00:00`).getDay()
  ];
}
