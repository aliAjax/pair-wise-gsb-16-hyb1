// 判定与流转规则（纯函数，不读 DOM、不读写存储、无副作用，除了通过 uid 生成标识）。
//
// 关键规则：
// 1. 双耳均“通过”才允许结束随访；任一侧未过 => 出生第 42 天生成首轮复筛任务。
// 2. 复筛室同一门店同一时段只接一名婴儿；改期先释放原位置，新位置冲突则整体回滚。
// 3. 联系未果必须登记尝试记录与延期原因。
// 4. 转档确认前原门店任务不能关闭、时段不能释放（防止重复安排）；
//    确认后任务才关闭并释放占用；驳回则恢复随访。

import { addDays, diffDays, todayISO } from "./date";
import { uid } from "./id";
import type {
  BabyRecord,
  ContactInput,
  EarResult,
  FollowStatus,
  RegisterInput,
  RescreenTask,
  Screening,
  Slot,
  SlotEvent,
  TransferInput,
} from "./types";

/** 首轮复筛：出生满 42 天 */
export const FIRST_RESCREEN_DAY = 42;
/** 复筛仍未双过：距上次复筛 7 天安排下一轮 */
export const NEXT_RESCREEN_GAP = 7;
/** 视为逾期的宽限天数：应到日次日起算 */
export const DUE_GRACE_DAYS = 0;

/** 复筛室可预约时段（全门店共用排班模板，实际按“门店+时段”互斥） */
export const PERIODS = [
  "09:00-09:30",
  "09:30-10:00",
  "10:00-10:30",
  "10:30-11:00",
  "11:00-11:30",
  "14:00-14:30",
  "14:30-15:00",
  "15:00-15:30",
  "15:30-16:00",
];

export const EAR_LABEL: Record<EarResult, string> = {
  pass: "通过",
  refer: "未过",
};

export const METHOD_LABEL = {
  OAE: "耳声发射 OAE",
  AABR: "自动听性脑干反应 AABR",
} as const;

export interface ActionResult {
  ok: boolean;
  message: string;
  record?: BabyRecord;
}

function event(
  kind: SlotEvent["kind"],
  from: Slot | null | undefined,
  to: Slot | null | undefined,
  note?: string,
): SlotEvent {
  return { id: uid("sl"), at: new Date().toISOString(), kind, from: from ?? null, to: to ?? null, note };
}

export function bothPass(s: Screening): boolean {
  return s.left === "pass" && s.right === "pass";
}

export function failedEars(s: Screening): Array<"left" | "right"> {
  return (["left", "right"] as const).filter((e) => s[e] === "refer");
}

/** 初筛登记后的即时判定（不保存，供表单实时预览） */
export interface InitialJudgment {
  bothPass: boolean;
  followStatus: FollowStatus;
  firstDueDate?: string;
  failedEars: Array<"left" | "right">;
}

export function judgeInitial(input: RegisterInput): InitialJudgment {
  const pass = bothPass(input.screening);
  return {
    bothPass: pass,
    followStatus: pass ? "closed-pass" : "active",
    firstDueDate: pass ? undefined : addDays(input.birthDate, FIRST_RESCREEN_DAY),
    failedEars: failedEars(input.screening),
  };
}

/** 用登记资料创建档案：未双过时自动生成 42 天复筛任务 */
export function registerBaby(input: RegisterInput): ActionResult {
  if (!input.name.trim()) return { ok: false, message: "请填写婴儿姓名" };
  if (!input.code.trim()) return { ok: false, message: "请填写建档编号" };
  if (!input.birthDate) return { ok: false, message: "请登记出生日期" };
  if (!input.store) return { ok: false, message: "请选择建档门店" };
  if (!input.screening.date) return { ok: false, message: "请填写初筛日期" };
  if (diffDays(input.birthDate, input.screening.date) < 0) {
    return { ok: false, message: "初筛日期不能早于出生日期" };
  }

  const verdict = judgeInitial(input);
  const tasks: RescreenTask[] = [];
  if (!verdict.bothPass && verdict.firstDueDate) {
    tasks.push({
      id: uid("tk"),
      round: 1,
      dueDate: verdict.firstDueDate,
      status: "pending",
      slot: null,
      result: null,
      attempts: [],
      postponements: [],
      slotEvents: [],
    });
  }

  const record: BabyRecord = {
    id: uid("bb"),
    code: input.code.trim(),
    name: input.name.trim(),
    birthDate: input.birthDate,
    store: input.store,
    initial: { ...input.screening },
    tasks,
    status: verdict.followStatus,
    closedAt: verdict.bothPass ? new Date().toISOString() : undefined,
    transfer: null,
    createdAt: new Date().toISOString(),
  };
  return { ok: true, message: verdict.bothPass ? "双耳通过，已结束随访" : `已生成出生第 ${FIRST_RESCREEN_DAY} 天复筛任务`, record };
}

/* ------------------------------ 时段互斥 ------------------------------ */

export interface SlotHolder {
  babyCode: string;
  taskId: string;
}

export function slotKey(store: string, slot: Slot): string {
  return `${store}|${slot.date}|${slot.period}`;
}

/** 全量占用表：已预约且未释放（未到筛/未转档）的时段 */
export function slotOccupancy(records: BabyRecord[]): Map<string, SlotHolder> {
  const map = new Map<string, SlotHolder>();
  for (const r of records) {
    for (const t of r.tasks) {
      if (t.status === "booked" && t.slot) {
        map.set(slotKey(r.store, t.slot), { babyCode: r.code, taskId: t.id });
      }
    }
  }
  return map;
}

function slotTaken(records: BabyRecord[], store: string, slot: Slot, exceptTaskId?: string): BabyRecord | undefined {
  return records.find((r) =>
    r.store === store &&
    r.tasks.some((t) => t.status === "booked" && t.slot &&
      slotKey(r.store, t.slot) === slotKey(store, slot) && t.id !== exceptTaskId),
  );
}

function validateSlot(slot: Slot): string | null {
  if (!slot.date) return "请选择复筛日期";
  if (!slot.period) return "请选择复筛时段";
  return null;
}

function withTask(record: BabyRecord, taskId: string, fn: (t: RescreenTask) => RescreenTask): BabyRecord {
  return { ...record, tasks: record.tasks.map((t) => (t.id === taskId ? fn(t) : t)) };
}

/** 预约复筛时段 */
export function bookSlot(records: BabyRecord[], recordId: string, taskId: string, slot: Slot): ActionResult {
  const err = validateSlot(slot);
  if (err) return { ok: false, message: err };
  const record = records.find((r) => r.id === recordId);
  if (!record) return { ok: false, message: "档案不存在" };
  if (record.status === "transfer-pending") return { ok: false, message: "转档待确认，原门店任务已锁定，不能预约" };
  if (record.status !== "active") return { ok: false, message: "随访已结束，不能再预约" };

  const busy = slotTaken(records, record.store, slot, taskId);
  if (busy) return { ok: false, message: `该时段已被 ${busy.code} 占用，复筛室同一时段只接一名婴儿` };

  const target = record.tasks.find((t) => t.id === taskId);
  if (!target) return { ok: false, message: "复筛任务不存在" };
  if (target.status !== "pending") return { ok: false, message: "任务状态不允许预约" };

  const next = withTask(record, taskId, (t) => ({
    ...t,
    status: "booked",
    slot: { ...slot },
    slotEvents: [...t.slotEvents, event("book", null, slot)],
  }));
  return { ok: true, message: `已预约 ${slot.date} ${slot.period}`, record: next };
}

/** 改期：先释放原位置，再占新位置；新位置被占则回滚（原位置恢复） */
export function rescheduleSlot(
  records: BabyRecord[],
  recordId: string,
  taskId: string,
  nextSlot: Slot,
  reason?: string,
): ActionResult {
  const err = validateSlot(nextSlot);
  if (err) return { ok: false, message: err };
  const record = records.find((r) => r.id === recordId);
  if (!record) return { ok: false, message: "档案不存在" };
  if (record.status === "transfer-pending") return { ok: false, message: "转档待确认，任务已锁定，不能改期" };
  if (record.status !== "active") return { ok: false, message: "随访已结束，不能改期" };

  const task = record.tasks.find((t) => t.id === taskId);
  if (!task || task.status !== "booked" || !task.slot) return { ok: false, message: "当前任务没有已预约时段" };
  const oldSlot = task.slot;

  if (slotKey(record.store, oldSlot) === slotKey(record.store, nextSlot)) {
    return { ok: false, message: "新时段与原时段相同，无需改期" };
  }

  // 先在占用视图中释放原位置，再检查新位置
  const releasedRecords = records.map((r) =>
    r.id === recordId ? withTask(r, taskId, (t) => ({ ...t, status: "pending", slot: null })) : r,
  );
  const busy = slotTaken(releasedRecords, record.store, nextSlot, taskId);
  if (busy) {
    return { ok: false, message: `改期失败：${nextSlot.date} ${nextSlot.period} 已被 ${busy.code} 占用，原预约位置已保留` };
  }

  const next = withTask(record, taskId, (t) => ({
    ...t,
    status: "booked",
    slot: { ...nextSlot },
    slotEvents: [
      ...t.slotEvents,
      event("release", oldSlot, null, reason),
      event("book", null, nextSlot, reason),
    ],
  }));
  return { ok: true, message: `已改期，原位置 ${oldSlot.date} ${oldSlot.period} 已释放`, record: next };
}

/** 仅释放时段（家长取消到筛等场景；转档待确认时不允许释放） */
export function releaseSlot(records: BabyRecord[], recordId: string, taskId: string, reason?: string): ActionResult {
  const record = records.find((r) => r.id === recordId);
  if (!record) return { ok: false, message: "档案不存在" };
  if (record.status === "transfer-pending") return { ok: false, message: "转档确认前原门店时段不能释放" };
  const task = record.tasks.find((t) => t.id === taskId);
  if (!task || task.status !== "booked" || !task.slot) return { ok: false, message: "当前任务没有可释放的预约" };
  const oldSlot = task.slot;
  const next = withTask(record, taskId, (t) => ({
    ...t,
    status: "pending",
    slot: null,
    slotEvents: [...t.slotEvents, event("release", oldSlot, null, reason)],
  }));
  return { ok: true, message: `已释放 ${oldSlot.date} ${oldSlot.period}`, record: next };
}

/* ------------------------------ 联系与延期 ------------------------------ */

/** 视为“联系未果”的结果：必须留延期原因 */
export function isUnsuccessful(outcome: ContactInput["outcome"]): boolean {
  return outcome === "noanswer" || outcome === "pending" || outcome === "refused";
}

export function logContact(records: BabyRecord[], recordId: string, taskId: string, input: ContactInput): ActionResult {
  const record = records.find((r) => r.id === recordId);
  if (!record) return { ok: false, message: "档案不存在" };
  if (record.status === "closed-pass" || record.status === "transferred") {
    return { ok: false, message: "随访已结束，不再登记联系" };
  }
  if (!input.at) return { ok: false, message: "请填写联系时间" };
  if (isUnsuccessful(input.outcome) && !input.postponementReason?.trim()) {
    return { ok: false, message: "联系未果必须填写延期原因" };
  }

  const target = record.tasks.find((t) => t.id === taskId);
  if (!target) return { ok: false, message: "复筛任务不存在" };
  if (isTaskClosed(target)) return { ok: false, message: "该任务已关闭，不能登记联系" };

  const next = withTask(record, taskId, (t) => {
    const postponements = isUnsuccessful(input.outcome)
      ? [...t.postponements, { id: uid("pt"), at: input.at, reason: input.postponementReason!.trim() }]
      : t.postponements;
    return {
      ...t,
      attempts: [...t.attempts, {
        id: uid("ct"),
        at: input.at,
        channel: input.channel,
        outcome: input.outcome,
        note: input.note?.trim() || undefined,
      }],
      postponements,
    };
  });
  return { ok: true, message: isUnsuccessful(input.outcome) ? "已记录联系尝试与延期原因" : "已记录联系结果", record: next };
}

/* ------------------------------ 复筛结果 ------------------------------ */

/**
 * 登记复筛结果：
 * - 双耳通过 => 该任务通过，随访结束（双耳通过才结束）。
 * - 任一侧未过 => 本轮 refer，按“上次复筛日期 + 7 天”自动生成下一轮任务。
 * 到筛后自动释放时段。
 */
export function submitRescreenResult(
  records: BabyRecord[],
  recordId: string,
  taskId: string,
  result: Screening,
): ActionResult {
  const record = records.find((r) => r.id === recordId);
  if (!record) return { ok: false, message: "档案不存在" };
  if (record.status !== "active") return { ok: false, message: "随访不在进行中，不能登记复筛结果" };
  if (!result.date) return { ok: false, message: "请填写复筛日期" };
  if (diffDays(record.birthDate, result.date) < 0) return { ok: false, message: "复筛日期不能早于出生日期" };

  const task = record.tasks.find((t) => t.id === taskId);
  if (!task) return { ok: false, message: "复筛任务不存在" };
  if (task.status !== "booked") return { ok: false, message: "只有已预约的任务才能登记结果" };

  const pass = bothPass(result);
  const nowIso = new Date().toISOString();
  const base = withTask(record, taskId, (t) => ({
    ...t,
    status: pass ? "passed" : "refer",
    result: { ...result },
    slotEvents: [...t.slotEvents, event("complete", t.slot, null)],
    slot: null,
  }));

  let next: BabyRecord;
  if (pass) {
    next = { ...base, status: "closed-pass", closedAt: nowIso };
    return { ok: true, message: "复筛双耳通过，随访结束", record: next };
  }

  const nextTask: RescreenTask = {
    id: uid("tk"),
    round: task.round + 1,
    dueDate: addDays(result.date, NEXT_RESCREEN_GAP),
    status: "pending",
    slot: null,
    result: null,
    attempts: [],
    postponements: [],
    slotEvents: [],
  };
  next = { ...base, tasks: [...base.tasks, nextTask] };
  return { ok: true, message: `仍有耳未过，已生成第 ${nextTask.round} 轮复筛任务（${nextTask.dueDate}）`, record: next };
}

/* ------------------------------ 随访关闭 ------------------------------ */

export function closeFollow(records: BabyRecord[], recordId: string): ActionResult {
  const record = records.find((r) => r.id === recordId);
  if (!record) return { ok: false, message: "档案不存在" };
  if (record.status === "transfer-pending") return { ok: false, message: "转档确认前不能关闭原门店任务" };
  if (record.status === "transferred") return { ok: false, message: "已随转档关闭" };
  const latest = latestScreening(record);
  if (!latest || !bothPass(latest)) {
    return { ok: false, message: "双耳通过才能结束随访" };
  }
  return {
    ok: true,
    message: "双耳通过，随访已结束",
    record: { ...record, status: "closed-pass", closedAt: new Date().toISOString() },
  };
}

/* ------------------------------ 转档 ------------------------------ */

export function requestTransfer(records: BabyRecord[], recordId: string, input: TransferInput): ActionResult {
  if (!input.targetStore.trim()) return { ok: false, message: "请填写转入门店" };
  const record = records.find((r) => r.id === recordId);
  if (!record) return { ok: false, message: "档案不存在" };
  if (record.status === "transfer-pending") return { ok: false, message: "已在转档确认中" };
  if (record.status === "transferred") return { ok: false, message: "已转档" };
  if (record.status === "closed-pass") return { ok: false, message: "随访已结束，无需转档" };

  const next: BabyRecord = {
    ...record,
    status: "transfer-pending",
    transfer: {
      targetStore: input.targetStore.trim(),
      requestedAt: new Date().toISOString(),
      status: "pending",
      note: input.note?.trim() || undefined,
    },
  };
  return { ok: true, message: `转档申请已提交至 ${input.targetStore}，确认前原门店任务保持锁定`, record: next };
}

/** 确认转档：此时才关闭原门店任务；已预约时段在此刻释放并留痕 */
export function confirmTransfer(records: BabyRecord[], recordId: string): ActionResult {
  const record = records.find((r) => r.id === recordId);
  if (!record) return { ok: false, message: "档案不存在" };
  if (record.status !== "transfer-pending" || !record.transfer) return { ok: false, message: "没有待确认的转档申请" };

  const nowIso = new Date().toISOString();
  const tasks = record.tasks.map((t) => {
    if ((t.status === "pending" || t.status === "booked") && !isTaskClosed(t)) {
      return {
        ...t,
        status: "moved" as const,
        slot: null,
        slotEvents: t.slot
          ? [...t.slotEvents, event("release", t.slot, null, "转档确认，释放原门店时段")]
          : t.slotEvents,
      };
    }
    return t;
  });

  const next: BabyRecord = {
    ...record,
    tasks,
    status: "transferred",
    closedAt: nowIso,
    transfer: { ...record.transfer, status: "confirmed", confirmedAt: nowIso },
  };
  return { ok: true, message: `转档至 ${next.transfer!.targetStore} 已确认，原门店任务已关闭`, record: next };
}

/** 驳回转档：恢复随访，预约位置与任务原样保留 */
export function rejectTransfer(records: BabyRecord[], recordId: string, note?: string): ActionResult {
  const record = records.find((r) => r.id === recordId);
  if (!record) return { ok: false, message: "档案不存在" };
  if (record.status !== "transfer-pending" || !record.transfer) return { ok: false, message: "没有待确认的转档申请" };

  const next: BabyRecord = {
    ...record,
    status: "active",
    transfer: {
      ...record.transfer,
      status: "rejected",
      rejectedAt: new Date().toISOString(),
      note: note?.trim() || record.transfer.note,
    },
  };
  return { ok: true, message: "转档被驳回，已恢复随访（原预约保留）", record: next };
}

/* ------------------------------ 派生查询 ------------------------------ */

export function latestScreening(record: BabyRecord): Screening | null {
  for (let i = record.tasks.length - 1; i >= 0; i--) {
    const r = record.tasks[i].result;
    if (r) return r;
  }
  return record.initial;
}

export function openTask(record: BabyRecord): RescreenTask | undefined {
  return record.tasks.find((t) => t.status === "pending" || t.status === "booked");
}

export function isTaskClosed(t: RescreenTask): boolean {
  return t.status === "passed" || t.status === "refer" || t.status === "moved";
}

export type Urgency = "overdue" | "due" | "upcoming" | "scheduled" | "none";

export function taskUrgency(t: RescreenTask, today = todayISO()): Urgency {
  if (t.status === "booked") return "scheduled";
  if (t.status !== "pending") return "none";
  const d = diffDays(today, t.dueDate);
  if (d > DUE_GRACE_DAYS) return "overdue";
  if (d === 0) return "due";
  return "upcoming";
}

export const FOLLOW_LABEL: Record<FollowStatus, string> = {
  active: "随访中",
  "closed-pass": "双耳通过 · 已结束",
  "transfer-pending": "转档待确认 · 任务锁定",
  transferred: "已转档 · 原门店任务关闭",
};
