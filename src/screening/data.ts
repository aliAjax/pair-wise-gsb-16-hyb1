// 筛查资料的演示数据（对应此前的纸单）。
// 以“今天”为锚点生成，保证逾期 / 今日到期 / 已预约 / 转档中等状态都可演示。

import { addDays, nowLocal } from "./date";
import { uid } from "./id";
import type { BabyRecord, Dataset } from "./types";

export const STORES = ["总院产科", "城东门店", "滨江妇幼点"];

function emptyTask(round: number, dueDate: string) {
  return {
    id: uid("tk"),
    round,
    dueDate,
    status: "pending" as const,
    slot: null,
    result: null,
    attempts: [],
    postponements: [],
    slotEvents: [],
  };
}

export function buildSeed(): Dataset {
  const today = new Date().toISOString().slice(0, 10);

  // 1. 初筛双耳通过：直接结束随访
  const pass: BabyRecord = {
    id: uid("bb"),
    code: "NB-1042",
    name: "李一禾",
    birthDate: addDays(today, -18),
    store: "总院产科",
    initial: { date: addDays(today, -15), method: "OAE", left: "pass", right: "pass" },
    tasks: [],
    status: "closed-pass",
    closedAt: nowLocal(),
    transfer: null,
    createdAt: nowLocal(),
  };

  // 2. 右耳未过：42 天复筛已逾期，电话未接，留有延期原因
  const dueDate2 = addDays(today, -3);
  const overdueTask = emptyTask(1, dueDate2);
  overdueTask.attempts = [
    {
      id: uid("ct"),
      at: `${addDays(today, -4)}T10:20`,
      channel: "电话",
      outcome: "noanswer",
      note: "振铃后无人接听",
    },
  ];
  overdueTask.postponements = [
    { id: uid("pt"), at: `${addDays(today, -4)}T10:20`, reason: "电话未接通，短信通知 42 天复筛，顺延 5 天再约" },
  ];
  const overdue: BabyRecord = {
    id: uid("bb"),
    code: "NB-1043",
    name: "陈思允",
    birthDate: addDays(today, -45),
    store: "城东门店",
    initial: { date: addDays(today, -42), method: "OAE", left: "pass", right: "refer" },
    tasks: [overdueTask],
    status: "active",
    transfer: null,
    createdAt: nowLocal(),
  };

  // 3. 左耳未过：已预约今日复筛时段
  const dueDate3 = today;
  const bookedTask = emptyTask(1, dueDate3);
  bookedTask.status = "booked";
  bookedTask.slot = { date: today, period: "10:00-10:30" };
  bookedTask.slotEvents = [{ id: uid("sl"), at: nowLocal(), kind: "book", from: null, to: bookedTask.slot }];
  const booked: BabyRecord = {
    id: uid("bb"),
    code: "NB-1044",
    name: "赵小满",
    birthDate: addDays(today, -42),
    store: "总院产科",
    initial: { date: addDays(today, -40), method: "AABR", left: "refer", right: "pass" },
    tasks: [bookedTask],
    status: "active",
    transfer: null,
    createdAt: nowLocal(),
  };

  // 4. 外地转档待确认：原门店任务锁定、时段保留
  const dueDate4 = addDays(today, 2);
  const lockedTask = emptyTask(1, dueDate4);
  lockedTask.status = "booked";
  lockedTask.slot = { date: addDays(today, 1), period: "14:30-15:00" };
  lockedTask.slotEvents = [{ id: uid("sl"), at: nowLocal(), kind: "book", from: null, to: lockedTask.slot }];
  const transferring: BabyRecord = {
    id: uid("bb"),
    code: "NB-1045",
    name: "王念安",
    birthDate: addDays(today, -40),
    store: "滨江妇幼点",
    initial: { date: addDays(today, -38), method: "OAE", left: "refer", right: "refer" },
    tasks: [lockedTask],
    status: "transfer-pending",
    transfer: {
      targetStore: "杭州西湖门店",
      requestedAt: nowLocal(),
      status: "pending",
      note: "家长回杭州坐月子，申请转档避免重复安排",
    },
    createdAt: nowLocal(),
  };

  return { stores: [...STORES], records: [pass, overdue, booked, transferring] };
}

/** 建议下一个建档编号 */
export function suggestCode(records: BabyRecord[]): string {
  let max = 1042;
  for (const r of records) {
    const n = Number(r.code.replace(/^NB-/, ""));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `NB-${max + 1}`;
}
