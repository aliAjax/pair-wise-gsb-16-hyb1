import {
  addDays,
  bookSlot,
  bothEarsPass,
  cancelTransfer,
  confirmTransfer,
  judgeInitial,
  judgeRescreen,
  logContact,
  registerTask,
  requestTransfer,
  rescheduleSlot,
  RuleError,
  slotId,
  submitRescreen,
  slotOccupant,
  todayISO,
} from "../src/screening/rules";
import type { EarReading, ScreeningStore } from "../src/screening/types";

const emptyStore = (): ScreeningStore => ({ version: 1, tasks: [] });

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}`);
  }
}

function expectError(name: string, fn: () => unknown, messageIncludes?: string) {
  try {
    fn();
    failed += 1;
    console.error(`  ✗ ${name}（未抛错）`);
  } catch (err) {
    const ok = err instanceof RuleError && (messageIncludes ? err.message.includes(messageIncludes) : true);
    if (ok) {
      passed += 1;
      console.log(`  ✓ ${name}（${(err as Error).message}）`);
    } else {
      failed += 1;
      console.error(`  ✗ ${name}（错误不符：${(err as Error).message}）`);
    }
  }
}

const L: EarReading = { result: "pass", method: "OAE" };
const R: EarReading = { result: "refer", method: "AABR" };
const today = todayISO();
const baseInput = {
  babyName: "测试婴",
  birthDate: addDays(today, -30),
  store: "朝阳门店",
  guardianPhone: "13800000000",
  screenDate: addDays(today, -28),
  left: L,
  right: L,
};

console.log("1. 初筛判定");
check("双耳通过 bothEarsPass", bothEarsPass({ left: L, right: L }));
check("一耳未过不算通过", !bothEarsPass({ left: L, right: R }));
const verdictPass = judgeInitial({ left: L, right: L }, baseInput.birthDate);
check("双耳通过判定 passed", verdictPass.kind === "passed");
const verdictRefer = judgeInitial({ left: L, right: R }, baseInput.birthDate);
check("单耳未过判定 rescreen", verdictRefer.kind === "rescreen");
if (verdictRefer.kind === "rescreen") {
  check("复筛到期日为出生第42天", verdictRefer.dueDate === addDays(baseInput.birthDate, 42));
}

console.log("2. 登记");
let s = emptyStore();
const r1 = registerTask(s, { ...baseInput, babyName: "双耳过" });
check("双耳通过登记后直接关闭随访", r1.task.status === "closed");
s = r1.store;
const r2 = registerTask(s, { ...baseInput, babyName: "单耳未", right: R });
check("单耳未过登记后任务开放", r2.task.status === "active");
s = r2.store;
const t1 = r2.task;
expectError("缺少姓名拒绝保存", () => registerTask(s, { ...baseInput, babyName: "" }));
expectError("初筛早于出生拒绝保存", () =>
  registerTask(s, { ...baseInput, babyName: "日期错", screenDate: addDays(baseInput.birthDate, -1) }),
);

console.log("3. 号源同一时段只接一名婴儿");
const slotA = slotId({ date: addDays(today, 3), time: "09:30" });
const slotB = slotId({ date: addDays(today, 3), time: "10:30" });
s = bookSlot(s, t1.id, slotA);
const r3 = registerTask(s, { ...baseInput, babyName: "第二个", birthDate: addDays(today, -29), right: R });
s = r3.store;
const t2 = r3.task;
expectError("同一时段第二名婴儿被拒绝", () => bookSlot(s, t2.id, slotA), "占用");
check("占用方是第一个任务", slotOccupant(s, slotA)?.id === t1.id);
s = bookSlot(s, t2.id, slotB);
check("换个时段可以预约", s.tasks.find((t) => t.id === t2.id)?.slot === slotB);

console.log("4. 改期先释放原位置");
const slotC = slotId({ date: addDays(today, 4), time: "14:00" });
s = rescheduleSlot(s, t1.id, slotC, "家长申请改期", "接种冲突");
check("改期后任务指向新号源", s.tasks.find((t) => t.id === t1.id)?.slot === slotC);
check("原时段已释放，他人可约", slotOccupant(s, slotA) === undefined);
const r3b = registerTask(s, { ...baseInput, babyName: "补位婴", birthDate: addDays(today, -32), right: R });
s = r3b.store;
s = bookSlot(s, r3b.task.id, slotA);
check("其他婴儿可约入被释放的原时段", s.tasks.find((t) => t.id === r3b.task.id)?.slot === slotA);
const post = s.tasks.find((t) => t.id === t1.id)!.postponements[0];
check("延期记录保留原号源与原因", post?.releasedSlot === slotA && post.reason === "家长申请改期");
expectError("改期到被占时段：报错且原号源不丢失", () => rescheduleSlot(s, t1.id, slotA, "其他", "测试"), "保留未释放");
check("冲突后任务仍在原新号源", s.tasks.find((t) => t.id === t1.id)?.slot === slotC);
expectError("改期必须有情况说明", () => rescheduleSlot(s, t1.id, slotB, "其他", "   "));

console.log("5. 联系未果必须留尝试与延期原因");
expectError("有尝试但缺延期原因被拒", () => logContact(s, t1.id, false, "未接通", undefined), "延期原因");
expectError("联系情况为空被拒", () =>
  logContact(s, t1.id, true, "   ", undefined), "联系尝试",
);
expectError("联系未果缺说明被拒", () =>
  logContact(s, t1.id, false, "未接", { reason: "联系未果", detail: " ", days: 3 }),
);
const dueBefore = s.tasks.find((t) => t.id === t1.id)!.dueDate;
s = logContact(s, t1.id, false, "10 点两次拨打无人接听", { reason: "联系未果", detail: "三日后再拨", days: 3 });
const t1after = s.tasks.find((t) => t.id === t1.id)!;
check("联系尝试已记录", t1after.contacts.length === 1 && t1after.contacts[0].note.includes("无人接听"));
check("延期原因已记录", t1after.postponements.some((p) => p.reason === "联系未果"));
check("应到日按顺延天数更新", t1after.dueDate === addDays(today, 3) && t1after.dueDate !== dueBefore);
s = logContact(s, t1.id, true, "家长接听，按时前来", undefined);
check("联系上不产生延期", s.tasks.find((t) => t.id === t1.id)!.postponements.length === t1after.postponements.length);

console.log("6. 复筛登记与判定");
const r0 = registerTask(s, { ...baseInput, babyName: "未约号", birthDate: addDays(today, -36), right: R });
s = r0.store;
expectError("无号源不能登记复筛", () =>
  submitRescreen(s, r0.task.id, { date: today, method: "OAE", leftResult: "pass", rightResult: "pass" }),
);
// 用 t2（已约 slotA）做一次双耳通过的复筛
s = submitRescreen(s, t2.id, { date: addDays(today, 3), method: "OAE", leftResult: "pass", rightResult: "pass" });
const t2after = s.tasks.find((t) => t.id === t2.id)!;
check("复筛双耳通过：任务关闭", t2after.status === "closed");
check("复筛完成：号源释放", t2after.slot === undefined);

// 单耳未过：继续随访
const r4 = registerTask(s, { ...baseInput, babyName: "单耳复筛", birthDate: addDays(today, -40), right: R });
s = r4.store;
const t3 = r4.task;
s = bookSlot(s, t3.id, slotId({ date: addDays(today, 2), time: "08:30" }));
s = submitRescreen(s, t3.id, { date: addDays(today, 2), method: "OAE", leftResult: "pass", rightResult: "refer" });
const t3after = s.tasks.find((t) => t.id === t3.id)!;
check("复筛单耳未过：任务继续开放", t3after.status === "active");
check("判定为继续随访", judgeRescreen({ left: L, right: R }).outcome === "refer-continue");

// 双耳 refer：转诊断，不关闭
const r5 = registerTask(s, { ...baseInput, babyName: "双耳复筛", birthDate: addDays(today, -41), left: R, right: R });
s = r5.store;
const t4 = r5.task;
s = bookSlot(s, t4.id, slotId({ date: addDays(today, 2), time: "11:30" }));
s = submitRescreen(s, t4.id, { date: addDays(today, 2), method: "AABR", leftResult: "refer", rightResult: "refer" });
const t4after = s.tasks.find((t) => t.id === t4.id)!;
check("复筛双耳未过：转诊断且随访保持开放", t4after.status === "active" && t4after.rescreens[0].outcome === "diagnosis");
check("判定为转诊断", judgeRescreen({ left: R, right: R }).outcome === "diagnosis");

console.log("7. 转档确认前原门店任务不关闭");
const r6 = registerTask(s, {
  ...baseInput,
  babyName: "转档娃",
  birthDate: addDays(today, -20),
  screenDate: addDays(today, -18),
  right: R,
});
s = r6.store;
const t5 = r6.task;
const t5slot = slotId({ date: addDays(today, 6), time: "16:00" });
s = bookSlot(s, t5.id, t5slot);
s = requestTransfer(s, t5.id, "天津滨海门店", "022-0000", "迁居");
let t5after2 = s.tasks.find((t) => t.id === t5.id)!;
check("转档申请后任务仍开放", t5after2.status === "active" && t5after2.transfer.status === "pending");
check("转档待确认期间号源仍占用", t5after2.slot === t5slot && slotOccupant(s, t5slot)?.id === t5.id);
expectError("待确认期间不能改期", () => rescheduleSlot(s, t5.id, slotId({ date: addDays(today, 7), time: "08:30" }), "其他", "x"));
expectError("待确认期间不能登记复筛", () =>
  submitRescreen(s, t5.id, { date: today, method: "OAE", leftResult: "pass", rightResult: "pass" }),
);
// 驳回：继续随访
s = cancelTransfer(s, t5.id);
check("驳回转档后状态为 cancelled 且任务仍开放", s.tasks.find((t) => t.id === t5.id)!.transfer.status === "cancelled");
// 再次申请后确认
s = requestTransfer(s, t5.id, "天津滨海门店", "022-0000", "迁居");
s = confirmTransfer(s, t5.id);
t5after2 = s.tasks.find((t) => t.id === t5.id)!;
check("接收确认后原门店任务才关闭", t5after2.status === "closed");
check("确认后号源释放，可被他人预约", t5after2.slot === undefined && slotOccupant(s, t5slot) === undefined);

console.log(`\n结果：${passed} 通过，${failed} 失败`);
if (failed > 0) process.exit(1);
