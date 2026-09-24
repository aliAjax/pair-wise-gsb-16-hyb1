import { useMemo, useState } from "react";
import { todayISO } from "../screening/date";
import { suggestCode } from "../screening/data";
import {
  EAR_LABEL,
  FIRST_RESCREEN_DAY,
  METHOD_LABEL,
  judgeInitial,
  registerBaby,
} from "../screening/rules";
import type {
  BabyRecord,
  EarResult,
  RegisterInput,
  ScreenMethod,
  Screening,
} from "../screening/types";
import type { ActionResult } from "../screening/rules";

interface Props {
  stores: string[];
  records: BabyRecord[];
  onSave: (input: RegisterInput) => ActionResult;
}

interface FormState {
  code: string;
  name: string;
  birthDate: string;
  store: string;
  screenDate: string;
  method: ScreenMethod;
  left: EarResult;
  right: EarResult;
}

function EarPick({ value, onChange }: { value: EarResult; onChange: (v: EarResult) => void }) {
  return (
    <div className="seg" role="radiogroup">
      {(["pass", "refer"] as const).map((v) => (
        <button
          type="button"
          key={v}
          role="radio"
          aria-checked={value === v}
          className={"seg-btn " + (value === v ? (v === "pass" ? "is-pass" : "is-refer") : "")}
          onClick={() => onChange(v)}
        >
          {EAR_LABEL[v]}
        </button>
      ))}
    </div>
  );
}

export default function RegisterForm({ stores, records, onSave }: Props) {
  const [form, setForm] = useState<FormState>({
    code: suggestCode(records),
    name: "",
    birthDate: todayISO(),
    store: stores[0] ?? "",
    screenDate: todayISO(),
    method: "OAE",
    left: "pass",
    right: "pass",
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setSaved(false);
  };

  // 判定预览：资料（form）变化时由纯规则推导，不触发保存
  const draft: RegisterInput = useMemo(() => ({
    code: form.code,
    name: form.name,
    birthDate: form.birthDate,
    store: form.store,
    screening: { date: form.screenDate, method: form.method, left: form.left, right: form.right } as Screening,
  }), [form]);
  const verdict = judgeInitial(draft);

  const submit = () => {
    setError(null);
    const res = onSave(draft);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setSaved(true);
    setForm((f) => ({
      ...f,
      code: suggestCode([...records, res.record!]),
      name: "",
      screenDate: todayISO(),
      left: "pass",
      right: "pass",
    }));
  };

  return (
    <section className="panel register-panel" id="register">
      <div className="section-heading">
        <div>
          <p>初筛登记</p>
          <h2>纸单数字化建档</h2>
        </div>
        <span className="rule-tag">资料 · 判定 · 保存 分离</span>
      </div>

      <div className="field-grid">
        <label>
          <span>建档编号</span>
          <input value={form.code} onChange={(e) => set("code", e.target.value)} placeholder="NB-1046" />
        </label>
        <label>
          <span>婴儿姓名</span>
          <input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="如：李一禾" />
        </label>
        <label>
          <span>出生日期</span>
          <input type="date" value={form.birthDate} max={todayISO()} onChange={(e) => set("birthDate", e.target.value)} />
        </label>
        <label>
          <span>建档门店</span>
          <select value={form.store} onChange={(e) => set("store", e.target.value)}>
            {stores.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          <span>初筛日期</span>
          <input type="date" value={form.screenDate} min={form.birthDate} max={todayISO()} onChange={(e) => set("screenDate", e.target.value)} />
        </label>
        <label>
          <span>检测方式（左右耳同次）</span>
          <select value={form.method} onChange={(e) => set("method", e.target.value as ScreenMethod)}>
            <option value="OAE">{METHOD_LABEL.OAE}</option>
            <option value="AABR">{METHOD_LABEL.AABR}</option>
          </select>
        </label>
      </div>

      <div className="ear-grid">
        <div className={"ear-card " + (form.left === "refer" ? "is-refer" : "is-pass")}>
          <span>左耳结果</span>
          <EarPick value={form.left} onChange={(v) => set("left", v)} />
        </div>
        <div className={"ear-card " + (form.right === "refer" ? "is-refer" : "is-pass")}>
          <span>右耳结果</span>
          <EarPick value={form.right} onChange={(v) => set("right", v)} />
        </div>
      </div>

      <div className={"verdict " + (verdict.bothPass ? "is-pass" : "is-refer")}>
        <strong>判定预览</strong>
        {verdict.bothPass ? (
          <p>双耳通过 · 保存后直接结束随访，不生成复筛任务</p>
        ) : (
          <p>
            {verdict.failedEars.map((e) => (e === "left" ? "左耳" : "右耳")).join("、")}未过 ·
            将生成 <b>出生第 {FIRST_RESCREEN_DAY} 天</b>复筛任务，应到日 <b>{verdict.firstDueDate}</b>
          </p>
        )}
      </div>

      {error && <p className="form-error">⚠ {error}</p>}
      {saved && <p className="form-ok">✓ 档案已保存</p>}

      <div className="form-actions">
        <button className="primary-action" onClick={submit}>保存档案</button>
      </div>
    </section>
  );
}
