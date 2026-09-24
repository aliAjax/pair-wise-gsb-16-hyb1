// 领域模型：新生儿听力筛查追踪台
// 仅描述“筛查资料”的形状，不包含任何判定与存储逻辑。

/** 单耳结果：通过 / 未过（refer） */
export type EarResult = "pass" | "refer";

/** 检测方式：耳声发射 / 自动听性脑干反应 */
export type ScreenMethod = "OAE" | "AABR";

/** 一次筛查（初筛或复筛）的登记资料 */
export interface Screening {
  /** 检测日期 YYYY-MM-DD */
  date: string;
  method: ScreenMethod;
  left: EarResult;
  right: EarResult;
}

/** 联系结果 */
export type ContactOutcome =
  | "connected" // 已接通，按时到筛
  | "reschedule" // 已接通，家长要求改期
  | "noanswer" // 未接通
  | "pending" // 家长称稍后再定
  | "refused"; // 家长拒绝 / 暂缓

export type ContactChannel = "电话" | "短信" | "微信";

export interface ContactAttempt {
  id: string;
  /** 联系时间 YYYY-MM-DDTHH:mm */
  at: string;
  channel: ContactChannel;
  outcome: ContactOutcome;
  note?: string;
}

/** 延期登记：联系未果时必须留下原因 */
export interface Postponement {
  id: string;
  at: string;
  reason: string;
}

/** 复筛室时段：同一门店同一时段全系统只能被一名婴儿占用 */
export interface Slot {
  /** YYYY-MM-DD */
  date: string;
  /** 如 09:00-09:30 */
  period: string;
}

export type SlotEventKind = "book" | "release" | "complete";

/** 时段占用流水：预约、改期释放、到筛释放均留痕 */
export interface SlotEvent {
  id: string;
  at: string;
  kind: SlotEventKind;
  from?: Slot | null;
  to?: Slot | null;
  note?: string;
}

/** 复筛任务状态 */
export type TaskStatus =
  | "pending" // 待预约
  | "booked" // 已预约（占用某一时段）
  | "passed" // 本次复筛双耳通过
  | "refer" // 本次复筛仍有未过耳，已生成下一轮任务
  | "moved"; // 转档确认，原门店关闭

export interface RescreenTask {
  id: string;
  /** 第几轮复筛（首轮为出生第 42 天） */
  round: number;
  /** 应到日期 */
  dueDate: string;
  status: TaskStatus;
  /** 当前占用的复筛室时段 */
  slot: Slot | null;
  /** 本次复筛结果（到筛后填写） */
  result: Screening | null;
  attempts: ContactAttempt[];
  postponements: Postponement[];
  /** 时段占用 / 释放流水 */
  slotEvents: SlotEvent[];
}

/** 随访状态 */
export type FollowStatus =
  | "active" // 随访中
  | "closed-pass" // 双耳通过，结束随访
  | "transfer-pending" // 转档已申请、待对方确认（任务锁定）
  | "transferred"; // 转档已确认，原门店任务关闭

export interface TransferInfo {
  targetStore: string;
  requestedAt: string;
  status: "pending" | "confirmed" | "rejected";
  confirmedAt?: string;
  rejectedAt?: string;
  /** 驳回 / 备注说明 */
  note?: string;
}

/** 一名婴儿的筛查追踪档案 */
export interface BabyRecord {
  id: string;
  /** 建档编号，如 NB-1042 */
  code: string;
  name: string;
  /** 出生日期 YYYY-MM-DD */
  birthDate: string;
  /** 建档门店 */
  store: string;
  /** 初筛资料 */
  initial: Screening;
  tasks: RescreenTask[];
  status: FollowStatus;
  closedAt?: string;
  transfer: TransferInfo | null;
  createdAt: string;
}

export interface Dataset {
  stores: string[];
  records: BabyRecord[];
}

/** 登记初筛表单的原始资料 */
export interface RegisterInput {
  code: string;
  name: string;
  birthDate: string;
  store: string;
  screening: Screening;
}

/** 联系尝试录入 */
export interface ContactInput {
  at: string;
  channel: ContactChannel;
  outcome: ContactOutcome;
  note?: string;
  /** 联系未果时必填的延期原因 */
  postponementReason?: string;
}

/** 转档申请 */
export interface TransferInput {
  targetStore: string;
  note?: string;
}
