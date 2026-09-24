import { useEffect, useMemo, useState } from "react";
import "./styles.css";
import RegisterForm from "./components/RegisterForm";
import BabyDetail from "./components/BabyDetail";
import { loadDataset, resetDataset, saveDataset } from "./screening/storage";
import { STORES } from "./screening/data";
import {
  FOLLOW_LABEL,
  openTask,
  slotOccupancy,
  taskUrgency,
} from "./screening/rules";
import * as rules from "./screening/rules";
import type { ActionResult } from "./screening/rules";
import type {
  BabyRecord,
  ContactInput,
  Dataset,
  RegisterInput,
  Screening,
  Slot,
  TransferInput,
} from "./screening/types";

type View = "all" | "active" | "due" | "overdue" | "transfer" | "closed";

const VIEWS: Array<{ key: View; label: string }> = [
  { key: "all", label: "全部档案" },
  { key: "active", label: "随访中" },
  { key: "due", label: "今日到期" },
  { key: "overdue", label: "已逾期" },
  { key: "transfer", label: "转档中" },
  { key: "closed", label: "已结束" },
];

const today = new Date().toISOString().slice(0, 10);

interface Toast {
  msg: string;
  ok: boolean;
  n: number;
}

function App() {
  const [dataset, setDataset] = useState<Dataset>(() => loadDataset());
  const [view, setView] = useState<View>("all");
  const [store, setStore] = useState<string>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    saveDataset(dataset);
  }, [dataset]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const flash = (msg: string, ok: boolean) => setToast({ msg, ok, n: Date.now() });

  const occupancy = useMemo(() => slotOccupancy(dataset.records), [dataset.records]);

  // 所有规则调用都经过这里：规则函数只返回新档案，保存统一由本组件 + storage 完成
  const apply = (res: ActionResult): ActionResult => {
    if (res.ok && res.record) {
      setDataset((d) => ({ ...d, records: d.records.map((r) => (r.id === res.record!.id ? res.record! : r)) }));
    }
    return res;
  };

  const addRecord = (input: RegisterInput): ActionResult => {
    const res = rules.registerBaby(input);
    if (res.ok && res.record) {
      setDataset((d) => ({ ...d, records: [res.record!, ...d.records] }));
      setOpenId(res.record.id);
    }
    return res;
  };

  const taskActions = {
    book: (recordId: string, taskId: string, slot: Slot) => apply(rules.bookSlot(dataset.records, recordId, taskId, slot)),
    reschedule: (recordId: string, taskId: string, slot: Slot, reason?: string) =>
      apply(rules.rescheduleSlot(dataset.records, recordId, taskId, slot, reason)),
    release: (recordId: string, taskId: string, reason?: string) =>
      apply(rules.releaseSlot(dataset.records, recordId, taskId, reason)),
    submitResult: (recordId: string, taskId: string, result: Screening) =>
      apply(rules.submitRescreenResult(dataset.records, recordId, taskId, result)),
    logContact: (recordId: string, taskId: string, input: ContactInput) =>
      apply(rules.logContact(dataset.records, recordId, taskId, input)),
  };

  const detailActions = {
    ...taskActions,
    closeFollow: (recordId: string) => apply(rules.closeFollow(dataset.records, recordId)),
    requestTransfer: (recordId: string, input: TransferInput) =>
      apply(rules.requestTransfer(dataset.records, recordId, input)),
    confirmTransfer: (recordId: string) => apply(rules.confirmTransfer(dataset.records, recordId)),
    rejectTransfer: (recordId: string, note?: string) =>
      apply(rules.rejectTransfer(dataset.records, recordId, note)),
  };

  const metrics = useMemo(() => {
    const rs = dataset.records;
    const active = rs.filter((r) => r.status === "active").length;
    let overdue = 0;
    let due = 0;
    const booked = new Set<string>();
    for (const r of rs) {
      const t = openTask(r);
      if (!t) continue;
      const u = taskUrgency(t, today);
      if (u === "overdue") overdue += 1;
      if (u === "due") due += 1;
      if (t.status === "booked") booked.add(r.id);
    }
    const transfer = rs.filter((r) => r.status === "transfer-pending").length;
    return [
      { label: "随访中", value: active, tone: "watch" as const },
      { label: "今日应复筛", value: due, tone: "warn" as const },
      { label: "复筛逾期", value: overdue, tone: "danger" as const },
      { label: "转档待确认", value: transfer, tone: "accent" as const },
    ];
  }, [dataset.records]);

  const filtered = useMemo(() => {
    return dataset.records
      .filter((r) => (store === "all" ? true : r.store === store))
      .filter((r) => {
        const t = openTask(r);
        switch (view) {
          case "active":
            return r.status === "active";
          case "due":
            return r.status === "active" && t && ["due", "scheduled"].includes(taskUrgency(t, today));
          case "overdue":
            return r.status === "active" && t && taskUrgency(t, today) === "overdue";
          case "transfer":
            return r.status === "transfer-pending";
          case "closed":
            return r.status === "closed-pass" || r.status === "transferred";
          default:
            return true;
        }
      })
      .sort((a, b) => {
        const ta = openTask(a)?.dueDate ?? "";
        const tb = openTask(b)?.dueDate ?? "";
        if (!ta) return 1;
        if (!tb) return -1;
        return ta < tb ? -1 : 1;
      });
  }, [dataset.records, view, store]);

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">新生儿听力筛查 · 追踪台</p>
          <h1>从纸单到闭环随访</h1>
          <p className="subtitle">
            登记出生日期、左右耳结果与检测方式：双耳通过才结束随访；任一侧未过自动生成出生第 42 天复筛。
            复筛室一时段一婴儿，改期先释放原位置；转档确认前原门店任务不关闭。
          </p>
        </div>
        <div className="stack-card">
          <span>规则要点</span>
          <strong>双耳通过 → 结束</strong>
          <strong>任一未过 → 42 天复筛</strong>
          <strong>资料 / 判定 / 保存分离</strong>
        </div>
      </section>

      <section className="metrics-grid">
        {metrics.map((m) => (
          <article className="metric-card" key={m.label}>
            <span>{m.label}</span>
            <strong>{m.value}</strong>
            <i className={"tone-" + m.tone} />
          </article>
        ))}
      </section>

      <RegisterForm stores={dataset.stores} records={dataset.records} onSave={addRecord} />

      <section className="workspace">
        <aside className="panel narrow">
          <h2>视图</h2>
          <div className="chips">
            {VIEWS.map((v) => (
              <button key={v.key} className={view === v.key ? "chip-on" : ""} onClick={() => setView(v.key)}>
                {v.label}
              </button>
            ))}
          </div>
          <h2>建档门店</h2>
          <div className="chips muted">
            <button className={store === "all" ? "chip-on" : ""} onClick={() => setStore("all")}>全部门店</button>
            {STORES.map((s) => (
              <button key={s} className={store === s ? "chip-on" : ""} onClick={() => setStore(s)}>{s}</button>
            ))}
          </div>
          <h2>复筛室排班</h2>
          <p className="side-note">同一门店同一时段全系统只接一名婴儿；改期先释放、冲突则回滚。</p>
          <button
            className="ghost-btn"
            onClick={() => {
              if (confirm("恢复为演示纸单数据？当前改动将被覆盖。")) {
                setDataset(resetDataset());
                flash("已恢复演示数据", true);
              }
            }}
          >
            恢复演示数据
          </button>
        </aside>

        <section className="panel list-panel">
          <div className="section-heading">
            <div>
              <p>追踪档案（{filtered.length}）</p>
              <h2>复筛任务一览</h2>
            </div>
          </div>
          <div className="record-list">
            {filtered.length === 0 && <p className="empty">当前筛选下暂无档案。</p>}
            {filtered.map((r) => (
              <RecordRow
                key={r.id}
                record={r}
                open={openId === r.id}
                onToggle={() => setOpenId((id) => (id === r.id ? null : r.id))}
              >
                <BabyDetail
                  record={r}
                  today={today}
                  occupancy={occupancy}
                  actions={detailActions}
                  onMessage={flash}
                />
              </RecordRow>
            ))}
          </div>
        </section>
      </section>

      {toast && (
        <div className={"toast " + (toast.ok ? "ok" : "err")} key={toast.n}>
          {toast.ok ? "✓ " : "⚠ "}{toast.msg}
        </div>
      )}
    </main>
  );
}

function RecordRow({
  record,
  open,
  onToggle,
  children,
}: {
  record: BabyRecord;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const t = openTask(record);
  const u = t ? taskUrgency(t, today) : "none";
  const statusClass =
    record.status === "closed-pass"
      ? "st-pass"
      : record.status === "transfer-pending"
        ? "st-transfer"
        : record.status === "transferred"
          ? "st-moved"
          : "st-active";

  return (
    <div className={"record-wrap " + (open ? "is-open" : "")}>
      <button className={"record-card row-btn " + statusClass} onClick={onToggle}>
        <div className={"record-index idx-" + u}>{open ? "−" : "+"}</div>
        <div className="row-main">
          <h3>
            {record.name}
            <span className="row-code">{record.code}</span>
          </h3>
          <p>
            <span className={"ear-mini " + (record.initial.left === "pass" ? "m-pass" : "m-refer")}>
              左{record.initial.left === "pass" ? "✓" : "✗"}
            </span>
            <span className={"ear-mini " + (record.initial.right === "pass" ? "m-pass" : "m-refer")}>
              右{record.initial.right === "pass" ? "✓" : "✗"}
            </span>
            {t ? (
              <>
                {" "}第 {t.round} 轮 · 应到 {t.dueDate}
                {t.slot && <> · {t.slot.period}</>}
                {u === "overdue" && <b className="tag-danger"> 已逾期</b>}
                {u === "due" && <b className="tag-warn"> 今日到期</b>}
                {u === "scheduled" && <b className="tag-info"> 已预约</b>}
              </>
            ) : (
              <> {FOLLOW_LABEL[record.status]}</>
            )}
          </p>
        </div>
        <span className={"row-status " + statusClass}>{FOLLOW_LABEL[record.status]}</span>
      </button>
      {open && children}
    </div>
  );
}

export default App;
