// 筛查资料层：只描述数据结构，不含判定逻辑，也不直接读写存储。

/** 单耳初筛/复筛结果：通过 / 未通过（REFER）/ 暂未检测 */
export type EarResult = "pass" | "refer" | "untested";

/** 检测方式：耳声发射 OAE / 自动听性脑干反应 AABR */
export type TestMethod = "OAE" | "AABR";

export type EarSide = "left" | "right";

export interface EarReading {
  result: EarResult;
  method: TestMethod;
}

/** 一次筛查（初筛或复筛）中双耳的检测资料 */
export interface Screening {
  kind: "initial" | "rescreen";
  date: string; // YYYY-MM-DD
  left: EarReading;
  right: EarReading;
  operator?: string;
}

export type PostponeReason =
  | "联系未果"
  | "家长申请改期"
  | "婴儿身体不适"
  | "天气/交通"
  | "号源已满"
  | "其他";

/** 联系尝试：无论联系上与否都留痕 */
export interface ContactAttempt {
  id: string;
  at: string; // ISO 时间
  reached: boolean;
  note: string;
}

/** 延期记录：联系未果或改期时必须给出原因，改期还要记录释放的原号源 */
export interface Postponement {
  id: string;
  at: string;
  reason: PostponeReason;
  detail: string;
  releasedSlot?: string;
  nextDue: string; // YYYY-MM-DD 延期后的应到日期
}

export type RescreenOutcome = "passed" | "refer-continue" | "diagnosis";

/** 一次复筛的完整资料 */
export interface RescreenRecord {
  id: string;
  date: string;
  slot: string;
  left: EarReading;
  right: EarReading;
  method: TestMethod;
  outcome: RescreenOutcome;
  note?: string;
}

export type TransferStatus = "none" | "pending" | "confirmed" | "cancelled";

/** 转档申请：接收门店确认前，原门店任务保持开放 */
export interface TransferRequest {
  targetStore: string;
  targetContact?: string;
  status: TransferStatus;
  requestedAt: string;
  confirmedAt?: string;
  note?: string;
}

export type TaskStatus = "active" | "closed";

export interface FollowUpTask {
  id: string;
  babyName: string;
  birthDate: string; // YYYY-MM-DD
  store: string;
  guardianPhone: string;
  initial: Screening;
  dueDate: string; // 应复筛日期（初筛后第 42 天，延期会顺延）
  slot?: string; // 已约号源，同一时段全科室唯一
  contacts: ContactAttempt[];
  postponements: Postponement[];
  rescreens: RescreenRecord[];
  transfer: TransferRequest;
  status: TaskStatus;
  createdAt: string;
}

/** 一个可预约号源：某日复筛室的某个时段，同时段只接一名婴儿 */
export interface Slot {
  date: string;
  time: string;
}

export interface ScreeningStore {
  version: 1;
  tasks: FollowUpTask[];
}
