// 演示数据：通过规则函数依次操作生成，保证与真实登记走同一条判定链路。

import {
  addDays,
  bookSlot,
  logContact,
  registerTask,
  requestTransfer,
  rescheduleSlot,
  slotId,
  submitRescreen,
  todayISO,
} from "./rules";
import { emptyStore } from "./storage";
import type { ScreeningStore, TestMethod } from "./types";

export function buildSampleStore(): ScreeningStore {
  let store = emptyStore();

  const OAE: TestMethod = "OAE";
  const AABR: TestMethod = "AABR";
  const today = todayISO();

  // 1. 双耳通过：登记即结束随访
  ({ store } = registerTask(store, {
    babyName: "王沐沐",
    birthDate: addDays(today, -20),
    store: "朝阳门店",
    guardianPhone: "138****0214",
    screenDate: addDays(today, -18),
    left: { result: "pass", method: OAE },
    right: { result: "pass", method: OAE },
  }));

  // 2. 单耳未过，未预约，出生 37 天（临期）
  ({ store } = registerTask(store, {
    babyName: "李朵朵",
    birthDate: addDays(today, -37),
    store: "朝阳门店",
    guardianPhone: "139****8851",
    screenDate: addDays(today, -35),
    left: { result: "refer", method: OAE },
    right: { result: "pass", method: OAE },
  }));

  // 3. 逾期未筛：出生 50 天，仍未约号
  ({ store } = registerTask(store, {
    babyName: "赵小树",
    birthDate: addDays(today, -50),
    store: "海淀门店",
    guardianPhone: "137****3309",
    screenDate: addDays(today, -48),
    left: { result: "pass", method: OAE },
    right: { result: "refer", method: AABR },
  }));

  // 4. 已预约：明天 09:30 复筛（此前联系未果延期过一次）
  let task4: { id: string };
  ({ store, task: task4 } = registerTask(store, {
    babyName: "陈一诺",
    birthDate: addDays(today, -40),
    store: "海淀门店",
    guardianPhone: "136****7720",
    screenDate: addDays(today, -38),
    left: { result: "refer", method: AABR },
    right: { result: "refer", method: OAE },
  }));
  store = logContact(
    store,
    task4.id,
    false,
    "两次拨打均无人接听",
    { reason: "联系未果", detail: "家长回电后优先安排本周时段", days: 7 },
  );
  store = bookSlot(store, task4.id, slotId({ date: addDays(today, 1), time: "09:30" }));

  // 5. 改期示例：原约今天 10:30，家长申请改至后天 14:00（原位置已释放）
  let task5: { id: string };
  ({ store, task: task5 } = registerTask(store, {
    babyName: "孙念念",
    birthDate: addDays(today, -41),
    store: "朝阳门店",
    guardianPhone: "135****4418",
    screenDate: addDays(today, -39),
    left: { result: "refer", method: OAE },
    right: { result: "pass", method: OAE },
  }));
  store = bookSlot(store, task5.id, slotId({ date: today, time: "10:30" }));
  store = rescheduleSlot(
    store,
    task5.id,
    slotId({ date: addDays(today, 2), time: "14:00" }),
    "家长申请改期",
    "接种疫苗当日无法前来",
  );

  // 6. 转档待确认：申请转往天津门店，确认前原门店任务不关闭、号源不释放
  let task6: { id: string };
  ({ store, task: task6 } = registerTask(store, {
    babyName: "周安安",
    birthDate: addDays(today, -30),
    store: "朝阳门店",
    guardianPhone: "188****9062",
    screenDate: addDays(today, -28),
    left: { result: "pass", method: OAE },
    right: { result: "refer", method: AABR },
  }));
  store = bookSlot(store, task6.id, slotId({ date: addDays(today, 5), time: "11:30" }));
  store = requestTransfer(store, task6.id, "天津滨海门店", "022-6****8", "家庭迁居外地，避免重复安排复筛");

  // 7. 已复筛：双耳未过，转诊断评估，随访保持开放
  let task7: { id: string };
  ({ store, task: task7 } = registerTask(store, {
    babyName: "吴听听",
    birthDate: addDays(today, -60),
    store: "海淀门店",
    guardianPhone: "133****1190",
    screenDate: addDays(today, -58),
    left: { result: "refer", method: OAE },
    right: { result: "refer", method: OAE },
  }));
  store = bookSlot(store, task7.id, slotId({ date: addDays(today, -16), time: "15:00" }));
  store = submitRescreen(store, task7.id, {
    date: addDays(today, -16),
    method: AABR,
    leftResult: "refer",
    rightResult: "refer",
    note: "建议尽快至诊断中心行诊断性 ABR",
  });

  // 稳定的短 ID 仅用于演示可读性
  store = {
    ...store,
    tasks: store.tasks.map((task, index) => ({ ...task, id: `demo-${String(index + 1).padStart(2, "0")}` })),
  };
  return store;
}
