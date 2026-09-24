import { useEffect, useMemo, useState } from "react";
import "./styles.css";
import type { ScreeningStore } from "./screening/types";
import {
  RuleError,
  judgeInitial,
  registerTask,
  taskStage,
  todayISO,
} from "./screening/rules";
import { clearStore, loadStore, saveStore } from "./screening/storage";
import { buildSampleStore } from "./screening/sampleData";
import { EarPicker, type EarValue } from "./components/forms";
import { TaskCard } from "./components/TaskCard";

type FilterKey =
  | "all"
  | "active"
  | "overdue"
  | "due-soon"
  | "unreached"
  | "booked"
  | "transfer-pending"
  | "diagnosis"
  | "closed";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "全部任务" },
  { key: "active", label: "随访中" },
  { key: "overdue", label: "逾期未筛" },
  { key: "due-soon", label: "14 天内到期" },
  { key: "unreached", label: "联系未果" },
  { key: "booked", label: "已约复筛" },
  { key: "transfer-pending", label: "转档待确认" },
  { key: "diagnosis", label: "转诊断" },
  { key: "closed", label: "双耳通过/已结束" },
];

interface Toast {
  type: "ok" | "error";
  text: string;
}

function RegisterPanel({ currentStore, onSaved }: { currentStore: ScreeningStore; onSaved: (store: ScreeningStore) => void }) {
  const [name, setName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [screenDate, setScreenDate] = useState(todayISO());
  const [store, setStoreName] = useState("朝阳门店");
  const [phone, setPhone] = useState("");
  const [left, setLeft] = useState<EarValue>({ result: "pass", method: "OAE" });
  const [right, setRight] = useState<EarValue>({ result: "pass", method: "OAE" });
  const [error, setError] = useState("");

  const verdict = birthDate ? judgeInitial({ left, right }, birthDate) : null;

  return (
    <form
      className="panel"
      onSubmit={(event) => {
        event.preventDefault();
        try {
          const result = registerTask(currentStore, {
            babyName: name,
            birthDate,
            store,
            guardianPhone: phone,
            screenDate,
            left,
            right,
          });
          onSaved(result.store);
          setName("");
          setBirthDate("");
          setPhone("");
          setLeft({ result: "pass", method: "OAE" });
          setRight({ result: "pass", method: "OAE" });
          setError("");
        } catch (err) {
          setError(err instanceof RuleError ? err.message : "登记失败");
        }
      }}
    >
      <div className="section-heading">
        <div>
          <p>初筛登记</p>
          <h2>新生儿听力筛查资料</h2>
        </div>
      </div>

      <div className="form-grid">
        <label>
          <span>婴儿姓名</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="如：李朵朵" />
        </label>
        <label>
          <span>出生日期</span>
          <input type="date" max={todayISO()} value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
        </label>
        <label>
          <span>初筛日期</span>
          <input type="date" max={todayISO()} value={screenDate} onChange={(e) => setScreenDate(e.target.value)} />
        </label>
        <label>
          <span>登记门店</span>
          <input value={store} onChange={(e) => setStoreName(e.target.value)} />
        </label>
        <label className="span-2">
          <span>监护人联系电话</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="复筛联系用，务必可接通" />
        </label>
        <EarPicker side="left" namePrefix="reg" value={left} onChange={setLeft} />
        <EarPicker side="right" namePrefix="reg" value={right} onChange={setRight} />
      </div>

      {verdict && (
        <div className={`verdict ${verdict.kind === "passed" ? "pass" : "refer"}`}>
          {verdict.text}
          {verdict.kind === "passed" && "——保存后任务直接结束随访。"}
        </div>
      )}
      {error && <div className="verdict refer">{error}</div>}

      <div className="form-actions">
        <button type="submit" className="primary-action">
          保存登记
        </button>
      </div>
    </form>
  );
}

export default function App() {
  const [store, setStore] = useState<ScreeningStore>(() => loadStore());
  const [filter, setFilter] = useState<FilterKey>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showRegister, setShowRegister] = useState(true);
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    saveStore(store);
  }, [store]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function run(fn: () => ScreeningStore): boolean {
    try {
      setStore(fn());
      setToast({ type: "ok", text: "已保存" });
      return true;
    } catch (err) {
      setToast({ type: "error", text: err instanceof RuleError ? err.message : "操作失败" });
      return false;
    }
  }

  const metrics = useMemo(() => {
    const active = store.tasks.filter((t) => t.status === "active");
    const stages = active.map(taskStage);
    return {
      active: active.length,
      overdue: stages.filter((s) => s === "overdue").length,
      dueSoon: stages.filter((s) => s === "due-soon").length,
      transfer: stages.filter((s) => s === "transfer-pending").length,
    };
  }, [store]);

  const counts = useMemo(() => {
    const map = new Map<FilterKey, number>();
    for (const task of store.tasks) {
      const stage = taskStage(task);
      const key: FilterKey = task.status === "closed" ? "closed" : stage;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [store.tasks]);

  const visible = useMemo(() => {
    const sorted = store.tasks.slice().sort((a, b) => {
      if (a.status !== b.status) return a.status === "active" ? -1 : 1;
      return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0;
    });
    if (filter === "all") return sorted;
    if (filter === "closed") return sorted.filter((t) => t.status === "closed");
    return sorted.filter((t) => t.status === "active" && taskStage(t) === filter);
  }, [store.tasks, filter]);

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-01 · 新生儿听力筛查追踪台 · port 5101</p>
          <h1>新生儿听力筛查追踪台</h1>
          <p className="subtitle">
            登记出生日期与左右耳检测结果：双耳通过即结束随访；任一侧未通过按出生第 42 天生成复筛任务。
            联系尝试、延期原因、号源改期释放与跨店转档全程留痕。
          </p>
        </div>
        <div className="stack-card">
          <span>分层结构（不增加依赖）</span>
          <strong>资料 types · 判定 rules · 保存 storage</strong>
          <small>React + Vite + TypeScript，数据存浏览器 localStorage</small>
        </div>
      </section>

      <section className="metrics-grid">
        <article className="metric-card">
          <span>随访中</span>
          <strong>{metrics.active}</strong>
          <i className="dot-info" />
        </article>
        <article className="metric-card">
          <span>逾期未筛</span>
          <strong>{metrics.overdue}</strong>
          <i className="dot-danger" />
        </article>
        <article className="metric-card">
          <span>14 天内到期</span>
          <strong>{metrics.dueSoon}</strong>
          <i className="dot-warn" />
        </article>
        <article className="metric-card">
          <span>转档待确认</span>
          <strong>{metrics.transfer}</strong>
          <i className="dot-warn" />
        </article>
      </section>

      <section className="workspace">
        <aside className="panel narrow">
          <h2>任务筛选</h2>
          <div className="filter-list">
            {FILTERS.map((item) => (
              <button
                key={item.key}
                className={filter === item.key ? "active" : ""}
                onClick={() => setFilter(item.key)}
              >
                {item.label}
                <span className="count">
                  {item.key === "all" ? store.tasks.length : (counts.get(item.key) ?? 0)}
                </span>
              </button>
            ))}
          </div>
          <h2>数据</h2>
          <div className="action-row" style={{ flexDirection: "column" }}>
            <button onClick={() => setShowRegister((v) => !v)}>
              {showRegister ? "收起登记表" : "展开初筛登记"}
            </button>
            <button onClick={() => setStore(buildSampleStore())}>载入演示数据</button>
            <button
              className="ghost-danger"
              onClick={() => {
                clearStore();
                setStore({ version: 1, tasks: [] });
                setExpanded(null);
              }}
            >
              清空全部数据
            </button>
          </div>
        </aside>

        <section>
          {showRegister && (
            <RegisterPanel
              currentStore={store}
              onSaved={(next) => {
                setStore(next);
                setToast({ type: "ok", text: "初筛登记已保存" });
              }}
            />
          )}

          <section className="panel">
            <div className="section-heading">
              <div>
                <p>随访任务</p>
                <h2>{FILTERS.find((f) => f.key === filter)?.label}</h2>
              </div>
            </div>
            {visible.length === 0 ? (
              <div className="empty-state">
                当前没有任务。可在上方登记初筛，或点击左侧「载入演示数据」。
              </div>
            ) : (
              <div className="record-list">
                {visible.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    store={store}
                    expanded={expanded === task.id}
                    onToggle={() => setExpanded(expanded === task.id ? null : task.id)}
                    run={run}
                  />
                ))}
              </div>
            )}
          </section>
        </section>
      </section>

      {toast && <div className={`toast ${toast.type}`}>{toast.text}</div>}
    </main>
  );
}
