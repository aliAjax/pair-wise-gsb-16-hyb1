// 判定与规则层：全部为纯函数。
// 只接收数据、返回判定结果或新数据，不触碰 React 与 localStorage。

import type {
  ContactAttempt,
  EarReading,
  EarResult,
  EarSide,
  FollowUpTask,
  PostponeReason,
  Postponement,
  RescreenOutcome,
  RescreenRecord,
  Screening,
  ScreeningStore,
  Slot,
  TestMethod,
  TransferRequest,
  TransferStatus,
} from "./types";

/* ---------------------------------- 基础常量 ---------------------------------- */

/** 初筛未通过时，按出生满 42 天安排复筛 */
export const RESCREEN_DAYS_AFTER_BIRTH = 42;

/** 联系未果延期时的默认顺延天数 */
export const DEFAULT_POSTPONE_DAYS = 7;

/** 复筛室每日开放时段（同一时段全科室只接一名婴儿） */
export const SLOT_TIMES = [
  "08:30",
  "09:30",
  "10:30",
  "11:30",
  "14:00",
  "15:00",
  "16:00",
];

/* ---------------------------------- 日期工具 ---------------------------------- */

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayISO(): string {
  return toISODate(new Date());
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return toISODate(new Date(y, m - 1, d + days));
}

export function daysBetween(fromISO: string, toISO: string): number {
  const [y1, m1, d1] = fromISO.split("-").map(Number);
  const [y2, m2, d2] = toISO.split("-").map(Number);
  const ms = new Date(y2, m2 - 1, d2).getTime() - new Date(y1, m1 - 1, d1).getTime();
  return Math.round(ms / 86400000);
}

export function daysUntil(iso: string): number {
  return daysBetween(todayISO(), iso);
}

export function formatCN(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${y}年${Number(m)}月${Number(d)}日`;
}

let seq = 0;
export function uid(prefix: string): string {
  seq = (seq + 1) % 100000;
  return `${prefix}-${Date.now().toString(36)}${seq.toString(36).padStart(3, "0")}`;
}

/* ---------------------------------- 判定规则 ---------------------------------- */

/** 双耳均通过才视为筛查通过；任一侧 refer/untested 都不算 */
export function bothEarsPass(screening: Pick<Screening, "left" | "right">): boolean {
  return screening.left.result === "pass" && screening.right.result === "pass";
}

export function earLabel(side: EarSide): string {
  return side === "left" ? "左耳" : "右耳";
}

export function resultLabel(result: EarResult): string {
  return result === "pass" ? "通过" : result === "refer" ? "未通过" : "未检测";
}

export function methodLabel(method: TestMethod): string {
  return method === "OAE" ? "OAE 耳声发射" : "AABR 自动脑干反应";
}

/** 初筛结论：双耳通过结束随访，否则按出生 42 天生成复筛任务 */
export type InitialVerdict =
  | { kind: "passed"; text: string }
  | { kind: "rescreen"; text: string; dueDate: string };

export function judgeInitial(screening: Pick<Screening, "left" | "right">, birthDate: string): InitialVerdict {
  if (bothEarsPass(screening)) {
    return { kind: "passed", text: "双耳通过，结束随访" };
  }
  const dueDate = addDays(birthDate, RESCREEN_DAYS_AFTER_BIRTH);
  const failed: string[] = [];
  if (screening.left.result !== "pass") failed.push("左耳");
  if (screening.right.result !== "pass") failed.push("右耳");
  return {
    kind: "rescreen",
    text: `${failed.join("、")}未通过，须于出生满 42 天（${formatCN(dueDate)}）前完成复筛`,
    dueDate,
  };
}

/* ---------------------------------- 号源规则 ---------------------------------- */

export function slotId(slot: Slot): string {
  return `${slot.date} ${slot.time}`;
}

export function parseSlotId(id: string): Slot {
  const [date, time] = id.split(" ");
  return { date, time };
}

/** 生成从某日期起 numberDays 天的全部时段（复筛室每天 SLOT_TIMES 个时段） */
export function buildSlots(fromISO: string, numberDays: number): Slot[] {
  const slots: Slot[] = [];
  for (let i = 0; i < numberDays; i += 1) {
    const date = addDays(fromISO, i);
    for (const time of SLOT_TIMES) {
      slots.push({ date, time });
    }
  }
  return slots;
}

/**
 * 查询号源占用方。
 * 关键约束：转档确认前，原门店任务不能关闭，其号源也继续占用，避免外地重复安排。
 */
export function slotOccupant(store: ScreeningStore, target: string, excludeTaskId?: string): FollowUpTask | undefined {
  return store.tasks.find(
    (task) =>
      task.id !== excludeTaskId &&
      task.status === "active" &&
      task.transfer.status !== "confirmed" &&
      task.slot === target,
  );
}

export function isSlotBookable(store: ScreeningStore, target: string, excludeTaskId?: string): boolean {
  return !slotOccupant(store, target, excludeTaskId);
}

/* ---------------------------------- 任务派生信息 ---------------------------------- */

/** 最新一次双耳结果（取最近一次复筛，否则取初筛） */
export function latestReading(task: FollowUpTask): Pick<Screening, "left" | "right"> & { at: string; kind: Screening["kind"] } {
  const last = task.rescreens[task.rescreens.length - 1];
  if (last) {
    return {
      at: last.date,
      kind: "rescreen",
      left: last.left,
      right: last.right,
    };
  }
  return { at: task.initial.date, kind: "initial", left: task.initial.left, right: task.initial.right };
}

/** 复筛结论：双耳通过 -> 结束随访；仅双耳复筛仍 REFER 才转诊断；其余（单耳未过/有耳未检测）继续随访 */
export function judgeRescreen(screening: Pick<Screening, "left" | "right">): {
  outcome: RescreenOutcome;
  text: string;
} {
  const leftRefer = screening.left.result === "refer";
  const rightRefer = screening.right.result === "refer";
  const bothPass = screening.left.result === "pass" && screening.right.result === "pass";
  if (bothPass) {
    return { outcome: "passed", text: "双耳通过，结束随访" };
  }
  if (leftRefer && rightRefer) {
    return { outcome: "diagnosis", text: "双耳复筛未通过，转诊断评估，随访保持开放" };
  }
  const problemEars: string[] = [];
  if (screening.left.result !== "pass") problemEars.push("左耳");
  if (screening.right.result !== "pass") problemEars.push("右耳");
  return {
    outcome: "refer-continue",
    text: `${problemEars.join("、")}未通过/未完成，继续随访并安排再次复筛`,
  };
}

export type TaskStage =
  | "due-soon"
  | "overdue"
  | "booked"
  | "unreached"
  | "transfer-pending"
  | "passed"
  | "diagnosis"
  | "active";

/** 任务当前阶段（用于列表徽标与筛选） */
export function taskStage(task: FollowUpTask): TaskStage {
  if (task.status === "closed") return "passed";
  const last = task.rescreens[task.rescreens.length - 1];
  if (last?.outcome === "diagnosis") return "diagnosis";
  if (task.transfer.status === "pending") return "transfer-pending";
  if (task.slot) return "booked";
  const lastContact = task.contacts[task.contacts.length - 1];
  if (lastContact && !lastContact.reached) return "unreached";
  const left = daysUntil(task.dueDate);
  if (left < 0) return "overdue";
  if (left <= 14) return "due-soon";
  return "active";
}

export const STAGE_LABELS: Record<TaskStage, string> = {
  "due-soon": "临期",
  overdue: "逾期未筛",
  booked: "已约复筛",
  unreached: "联系未果",
  "transfer-pending": "转档待确认",
  passed: "双耳通过",
  diagnosis: "转诊断",
  active: "随访中",
};

/* ---------------------------------- 写操作（纯函数，返回新 store） ---------------------------------- */

export class RuleError extends Error {}

function withTasks(store: ScreeningStore, tasks: FollowUpTask[]): ScreeningStore {
  return { ...store, tasks };
}

function updateTask(
  store: ScreeningStore,
  id: string,
  fn: (task: FollowUpTask) => FollowUpTask,
): { store: ScreeningStore; task: FollowUpTask } {
  const index = store.tasks.findIndex((t) => t.id === id);
  if (index < 0) throw new RuleError("任务不存在");
  const task = fn(store.tasks[index]);
  const tasks = store.tasks.slice();
  tasks[index] = task;
  return { store: withTasks(store, tasks), task };
}

export interface RegisterInput {
  babyName: string;
  birthDate: string;
  store: string;
  guardianPhone: string;
  screenDate: string;
  left: EarReading;
  right: EarReading;
}

/**
 * 登记初筛。
 * 双耳通过 -> 任务直接关闭结束随访；
 * 任一侧未过 -> 开放任务，到期日为出生第 42 天。
 */
export function registerTask(store: ScreeningStore, input: RegisterInput): { store: ScreeningStore; task: FollowUpTask } {
  if (!input.babyName.trim()) throw new RuleError("请填写婴儿姓名");
  if (!input.birthDate) throw new RuleError("请选择出生日期");
  if (!input.screenDate) throw new RuleError("请选择初筛日期");
  if (input.screenDate < input.birthDate) throw new RuleError("初筛日期不能早于出生日期");
  if (!input.guardianPhone.trim()) throw new RuleError("请填写监护人联系电话");
  if (!input.store.trim()) throw new RuleError("请填写门店");

  const initial: Screening = {
    kind: "initial",
    date: input.screenDate,
    left: input.left,
    right: input.right,
  };
  const verdict = judgeInitial(initial, input.birthDate);
  const task: FollowUpTask = {
    id: uid("T"),
    babyName: input.babyName.trim(),
    birthDate: input.birthDate,
    store: input.store.trim(),
    guardianPhone: input.guardianPhone.trim(),
    initial,
    dueDate: verdict.kind === "rescreen" ? verdict.dueDate : input.birthDate,
    contacts: [],
    postponements: [],
    rescreens: [],
    transfer: { status: "none", requestedAt: "" },
    status: verdict.kind === "passed" ? "closed" : "active",
    createdAt: new Date().toISOString(),
  };
  return { store: withTasks(store, [task, ...store.tasks]), task };
}

/**
 * 预约号源（首次预约）。复筛室同一时段只接一名婴儿。
 */
export function bookSlot(store: ScreeningStore, taskId: string, target: string): ScreeningStore {
  return updateTask(store, taskId, (task) => {
    if (task.status === "closed") throw new RuleError("随访已结束，无需预约");
    if (task.transfer.status === "pending") throw new RuleError("转档待接收确认，暂不能在原门店预约");
    if (task.slot) throw new RuleError("已有预约，请使用改期功能");
    const occupant = slotOccupant(store, target, taskId);
    if (occupant) throw new RuleError(`该时段已被 ${occupant.babyName} 占用，请另选时段`);
    return { ...task, slot: target };
  }).store;
}

/**
 * 改期：先校验新位置可用，随后先释放原位置、再占用新位置。
 * 冲突在释放前就会报错，原位置不会丢失；释放的号源与延期原因写入延期记录。
 */
export function rescheduleSlot(
  store: ScreeningStore,
  taskId: string,
  target: string,
  reason: PostponeReason,
  detail: string,
): ScreeningStore {
  const current = store.tasks.find((t) => t.id === taskId);
  if (!current) throw new RuleError("任务不存在");
  if (current.status === "closed") throw new RuleError("随访已结束，不能改期");
  if (current.transfer.status === "pending") throw new RuleError("转档待确认，不能改期");
  if (!current.slot) throw new RuleError("该任务尚未预约");
  if (!detail.trim()) throw new RuleError("改期必须填写延期情况说明");
  if (target === current.slot) throw new RuleError("新时段与原时段相同，无需改期");
  const conflict = slotOccupant(store, target, taskId);
  if (conflict) throw new RuleError(`${target} 已被 ${conflict.babyName} 占用，请另选时段；原时段保留未释放。`);

  // 第一步：释放原位置（原任务退出该时段）
  const released = updateTask(store, taskId, (task) => ({ ...task, slot: undefined })).store;

  // 第二步：占用新位置并登记延期原因
  const postponement: Postponement = {
    id: uid("P"),
    at: new Date().toISOString(),
    reason,
    detail: detail.trim(),
    releasedSlot: current.slot,
    nextDue: parseSlotId(target).date,
  };

  return updateTask(released, taskId, (task) => ({
    ...task,
    slot: target,
    dueDate: parseSlotId(target).date,
    postponements: [...task.postponements, postponement],
  })).store;
}

/** 登记一次联系尝试。联系未果时必须填写延期原因，并顺延到期日 */
export function logContact(
  store: ScreeningStore,
  taskId: string,
  reached: boolean,
  note: string,
  postpone: { reason: PostponeReason; detail: string; days: number } | undefined,
): ScreeningStore {
  return updateTask(store, taskId, (task) => {
    if (task.status === "closed") throw new RuleError("随访已结束");
    if (task.transfer.status === "pending") throw new RuleError("转档待确认，原门店任务保持开放但不再安排");
    if (!note.trim()) throw new RuleError("请记录本次联系尝试的情况");
    const attempt: ContactAttempt = {
      id: uid("C"),
      at: new Date().toISOString(),
      reached,
      note: note.trim(),
    };
    let dueDate = task.dueDate;
    let postponements = task.postponements;
    if (!reached) {
      if (!postpone) throw new RuleError("联系未果必须记录延期原因");
      if (!postpone.detail.trim()) throw new RuleError("请补充延期情况说明");
      if (!Number.isInteger(postpone.days) || postpone.days < 1) throw new RuleError("顺延天数至少 1 天");
      dueDate = addDays(todayISO(), postpone.days);
      postponements = [
        ...postponements,
        {
          id: uid("P"),
          at: attempt.at,
          reason: postpone.reason,
          detail: postpone.detail.trim(),
          nextDue: dueDate,
        },
      ];
    }
    return { ...task, contacts: [...task.contacts, attempt], dueDate, postponements };
  }).store;
}

export interface RescreenInput {
  date: string;
  method: TestMethod;
  leftResult: EarResult;
  rightResult: EarResult;
  note?: string;
}

/**
 * 登记复筛结果。
 * 双耳通过 -> 释放号源并关闭随访；否则任务继续（双耳未过转诊断）。
 */
export function submitRescreen(store: ScreeningStore, taskId: string, input: RescreenInput): ScreeningStore {
  return updateTask(store, taskId, (task) => {
    if (task.status === "closed") throw new RuleError("随访已结束");
    if (task.transfer.status === "pending") throw new RuleError("转档待确认，不能在原门店登记复筛");
    if (!task.slot) throw new RuleError("该任务尚未预约复筛号源");
    if (!input.date) throw new RuleError("请选择复筛日期");

    const left: EarReading = { result: input.leftResult, method: input.method };
    const right: EarReading = { result: input.rightResult, method: input.method };
    const judgement = judgeRescreen({ left, right });
    const record: RescreenRecord = {
      id: uid("R"),
      date: input.date,
      slot: task.slot,
      left,
      right,
      method: input.method,
      outcome: judgement.outcome,
      note: input.note?.trim() || undefined,
    };
    const passed = judgement.outcome === "passed";
    return {
      ...task,
      rescreens: [...task.rescreens, record],
      slot: undefined, // 复筛完成，号源释放
      dueDate: passed ? task.dueDate : addDays(input.date, DEFAULT_POSTPONE_DAYS * 2),
      status: passed ? "closed" : "active",
    };
  }).store;
}

/** 发起转档：不关闭原任务、不释放号源，直到对方确认 */
export function requestTransfer(store: ScreeningStore, taskId: string, targetStore: string, targetContact: string, note: string): ScreeningStore {
  return updateTask(store, taskId, (task) => {
    if (task.status === "closed") throw new RuleError("随访已结束，不能转档");
    if (task.transfer.status === "pending") throw new RuleError("已有待确认的转档申请");
    if (!targetStore.trim()) throw new RuleError("请填写接收门店");
    const transfer: TransferRequest = {
      targetStore: targetStore.trim(),
      targetContact: targetContact.trim() || undefined,
      status: "pending",
      requestedAt: new Date().toISOString(),
      note: note.trim() || undefined,
    };
    return { ...task, transfer };
  }).store;
}

function mutateTransfer(store: ScreeningStore, taskId: string, status: TransferStatus): ScreeningStore {
  return updateTask(store, taskId, (task) => {
    if (task.transfer.status !== "pending") throw new RuleError("没有待确认的转档申请");
    if (status === "confirmed") {
      // 确认接收：原门店任务此刻才允许关闭并释放号源，避免两地重复安排
      return {
        ...task,
        transfer: { ...task.transfer, status, confirmedAt: new Date().toISOString() },
        slot: undefined,
        status: "closed",
      };
    }
    // 取消（驳回）：退回原门店继续随访，号源若有则保留
    return { ...task, transfer: { ...task.transfer, status, confirmedAt: new Date().toISOString() } };
  }).store;
}

export function confirmTransfer(store: ScreeningStore, taskId: string): ScreeningStore {
  return mutateTransfer(store, taskId, "confirmed");
}

export function cancelTransfer(store: ScreeningStore, taskId: string): ScreeningStore {
  return mutateTransfer(store, taskId, "cancelled");
}
