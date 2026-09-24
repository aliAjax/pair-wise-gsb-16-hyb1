import { useState } from "react";
import { nowLocal, todayISO, weekdayCN } from "../screening/date";
import {
  EAR_LABEL,
  METHOD_LABEL,
  PERIODS,
  isUnsuccessful,
  slotKey,
  taskUrgency,
} from "../screening/rules";
import type {
  BabyRecord,
  ContactChannel,
  ContactInput,
  ContactOutcome,
  EarResult,
  RescreenTask,
  ScreenMethod,
  Screening,
  Slot,
  SlotHolder,
} from "../screening/types";
import type { ActionResult } from "../screening/rules";

export interface TaskActions {
  book(recordId: string, taskId: string, slot: Slot): ActionResult;
  reschedule(recordId: string, taskId: string, slot: Slot, reason?: string): ActionResult;
  release(recordId: string, taskId: string, reason?: string): ActionResult;
  submitResult(recordId: string, taskId: string, result: Screening): ActionResult;
  logContact(recordId: string, taskId: string, input: ContactInput): ActionResult;
}

const TASK_LABEL: Record<RescreenTask["status"], string> = {
  pending: "待预约",
  booked: "已预约",
  passed: "复筛通过",
  refer: "复筛仍未过",
  moved: "随转档关闭",
};

const URGENCY_LABEL = {
  overdue: "已逾期",
  due: "今日到期",
  upcoming: "未到期",
  scheduled: "已排期",
  none: "",
} as const;

const OUTCOME_LABEL: Record<ContactOutcome, string> = {
  connected: "已接通·按时到筛",
  reschedule: "已接通·要求改期",
  noanswer: "未接通",
  pending: "稍后再定",
  refused: "拒绝/暂缓",
};

function EarMarks({ s }: { s: Screening }) {
  return (
    <span className="ear-marks">
      <span className={"mark " + (s.left === "pass" ? "m-pass" : "m-refer")}>左 {EAR_LABEL[s.left]}</span>
      <span className={"mark " + (s.right === "pass" ? "m-pass" : "m-refer")}>右 {EAR_LABEL[s.right]}</span>
    </span>
  );
}

interface Props {
  record: BabyRecord;
  task: RescreenTask;
  occupancy: Map<string, SlotHolder>;
  actions: TaskActions;
  onMessage: (msg: string, ok: boolean) => void;
}

export default function TaskCard({ record, task, occupancy, actions, onMessage }: Props) {
  const urgency = taskUrgency(task);
  const locked = record.status === "transfer-pending";

  const [slotDate, setSlotDate] = useState(task.dueDate);
  const [period, setPeriod] = useState(PERIODS[3]);
  const [moveReason, setMoveReason] = useState("");

  const [showResult, setShowResult] = useState(false);
  const [rDate, setRDate] = useState(task.slot?.date ?? todayISO());
  const [rMethod, setRMethod] = useState<ScreenMethod>("OAE");
  const [rLeft, setRLeft] = useState<EarResult>("pass");
  const [rRight, setRRight] = useState<EarResult>("pass");

  const [showContact, setShowContact] = useState(false);
  const [cAt, setCAt] = useState(nowLocal());
  const [cChannel, setCChannel] = useState<ContactChannel>("电话");
  const [cOutcome, setCOutcome] = useState<ContactOutcome>("noanswer");
  const [cNote, setCNote] = useState("");
  const [cReason, setCReason] = useState("");

  const run = (res: ActionResult) => {
    onMessage(res.message, res.ok);
    setShowResult(false);
    setShowContact(false);
    setMoveReason("");
    setCReason("");
  };

  const doBook = () => run(actions.book(record.id, task.id, { date: slotDate, period }));
  const doMove = () => run(actions.reschedule(record.id, task.id, { date: slotDate, period }, moveReason || undefined));
  const doRelease = () => run(actions.release(record.id, task.id, "家长取消，手动释放"));
  const doResult = () =>
    run(actions.submitResult(record.id, task.id, { date: rDate, method: rMethod, left: rLeft, right: rRight }));
  const doContact = () =>
    run(actions.logContact(record.id, task.id, {
      at: cAt,
      channel: cChannel,
      outcome: cOutcome,
      note: cNote || undefined,
      postponementReason: isUnsuccessful(cOutcome) ? cReason : undefined,
    }));

  const holderFor = (p: string) => occupancy.get(slotKey(record.store, { date: slotDate, period: p }));

  return (
    <article className={"task-card tc-" + urgency}>
      <header className="task-head">
        <div>
          <strong>第 {task.round} 轮复筛</strong>
          <span className="due-line">
            应到 {task.dueDate}（{weekdayCN(task.dueDate)}）·
            {task.round === 1 ? " 出生第 42 天" : ` 距上轮复筛 +7 天（第 ${task.round} 轮）`}
          </span>
        </div>
        <span className={"badge b-" + urgency}>
          {TASK_LABEL[task.status]}{urgency !== "none" && task.status !== "booked" ? ` · ${URGENCY_LABEL[urgency]}` : ""}
        </span>
      </header>

      {task.slot && (
        <div className="slot-line">
          <span className="slot-room">复筛室 {record.store}</span>
          <b>{task.slot.date} {weekdayCN(task.slot.date)} {task.slot.period}</b>
          <span className="slot-cap">该时段仅此一名婴儿</span>
        </div>
      )}

      {task.result && (
        <div className="result-line">
          <span>{task.result.date} · {METHOD_LABEL[task.result.method]}</span>
          <EarMarks s={task.result} />
        </div>
      )}

      {locked && <p className="lock-note">🔒 转档待对方确认：时段保留、任务锁定，不能预约 / 改期 / 关闭</p>}

      {/* 预约 / 改期 */}
      {!isClosed(task) && !locked && (
        <div className="booking">
          <div className="slot-picker">
            <label>
              <span>日期</span>
              <input type="date" value={slotDate} min={todayISO()} onChange={(e) => setSlotDate(e.target.value)} />
            </label>
            <div className="periods">
              {PERIODS.map((p) => {
                const holder = holderFor(p);
                const mine = task.slot?.date === slotDate && task.slot.period === p;
                return (
                  <button
                    key={p}
                    type="button"
                    disabled={!!holder && !mine}
                    className={"period " + (period === p ? "sel" : "") + (holder && !mine ? " busy" : "") + (mine ? " mine" : "")}
                    onClick={() => setPeriod(p)}
                    title={holder && !mine ? `已被 ${holder.babyCode} 占用` : p}
                  >
                    {p}
                    {holder && !mine && <i>占用</i>}
                    {mine && <i>当前</i>}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="task-actions">
            {task.status === "pending" ? (
              <button className="primary-action" onClick={doBook}>预约此时段</button>
            ) : (
              <>
                <label className="move-reason">
                  <span>改期 / 释放原因（改期先释放原位置）</span>
                  <input value={moveReason} onChange={(e) => setMoveReason(e.target.value)} placeholder="如：家长出差，要求顺延一周" />
                </label>
                <button onClick={doMove}>改期（先释放原位置）</button>
                <button className="danger-btn" onClick={doRelease}>仅释放原位置</button>
              </>
            )}
            <button onClick={() => setShowContact((v) => !v)}>登记联系尝试</button>
            {task.status === "booked" && <button onClick={() => setShowResult((v) => !v)}>到筛 · 录入结果</button>}
          </div>
        </div>
      )}

      {/* 联系登记表单 */}
      {showContact && !isClosed(task) && !locked && (
        <div className="sub-form">
          <h4>联系尝试{isUnsuccessful(cOutcome) ? "（联系未果，须留延期原因）" : ""}</h4>
          <div className="sub-grid">
            <label>
              <span>联系时间</span>
              <input type="datetime-local" value={cAt} onChange={(e) => setCAt(e.target.value)} />
            </label>
            <label>
              <span>方式</span>
              <select value={cChannel} onChange={(e) => setCChannel(e.target.value as ContactChannel)}>
                <option>电话</option>
                <option>短信</option>
                <option>微信</option>
              </select>
            </label>
            <label>
              <span>结果</span>
              <select value={cOutcome} onChange={(e) => setCOutcome(e.target.value as ContactOutcome)}>
                {(Object.keys(OUTCOME_LABEL) as ContactOutcome[]).map((o) => (
                  <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>
                ))}
              </select>
            </label>
            <label>
              <span>备注</span>
              <input value={cNote} onChange={(e) => setCNote(e.target.value)} placeholder="通话情况（选填）" />
            </label>
          </div>
          {isUnsuccessful(cOutcome) && (
            <label className="reason-required">
              <span>延期原因（必填）</span>
              <textarea value={cReason} onChange={(e) => setCReason(e.target.value)} rows={2}
                placeholder="联系未果必须留下延期原因，便于下一位同事跟进" />
            </label>
          )}
          <div className="sub-actions">
            <button className="primary-action" onClick={doContact}>保存联系记录</button>
          </div>
        </div>
      )}

      {/* 复筛结果表单 */}
      {showResult && task.status === "booked" && (
        <div className="sub-form">
          <h4>复筛结果登记</h4>
          <div className="sub-grid">
            <label>
              <span>检测日期</span>
              <input type="date" value={rDate} max={todayISO()} onChange={(e) => setRDate(e.target.value)} />
            </label>
            <label>
              <span>检测方式</span>
              <select value={rMethod} onChange={(e) => setRMethod(e.target.value as ScreenMethod)}>
                <option value="OAE">{METHOD_LABEL.OAE}</option>
                <option value="AABR">{METHOD_LABEL.AABR}</option>
              </select>
            </label>
            <ResultEar label="左耳" value={rLeft} onChange={setRLeft} />
            <ResultEar label="右耳" value={rRight} onChange={setRRight} />
          </div>
          <p className="rule-hint">双耳通过则结束随访并释放时段；任一侧未过将按 7 天后生成下一轮复筛。</p>
          <div className="sub-actions">
            <button className="primary-action" onClick={doResult}>提交结果</button>
          </div>
        </div>
      )}

      {/* 尝试与延期流水 */}
      {(task.attempts.length > 0 || task.postponements.length > 0) && (
        <ul className="timeline">
          {mergeTimeline(task).map((x) => (
            <li key={x.kind + x.at} className={"tl " + x.kind}>
              <span className="tl-tag">{x.kind === "attempt" ? "联系" : "延期"}</span>
              <span className="tl-at">{x.at.replace("T", " ")}</span>
              <span className="tl-text">{x.text}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function ResultEar({ label, value, onChange }: { label: string; value: EarResult; onChange: (v: EarResult) => void }) {
  return (
    <label>
      <span>{label}结果</span>
      <select value={value} onChange={(e) => onChange(e.target.value as EarResult)}>
        <option value="pass">{EAR_LABEL.pass}</option>
        <option value="refer">{EAR_LABEL.refer}</option>
      </select>
    </label>
  );
}

function isClosed(t: RescreenTask): boolean {
  return t.status === "passed" || t.status === "refer" || t.status === "moved";
}

function mergeTimeline(t: RescreenTask): Array<{ kind: "attempt" | "postpone"; at: string; text: string }> {
  const items: Array<{ kind: "attempt" | "postpone"; at: string; text: string }> = [];
  for (const a of t.attempts) {
    items.push({
      kind: "attempt",
      at: a.at,
      text: `${a.channel} · ${OUTCOME_LABEL[a.outcome]}${a.note ? ` · ${a.note}` : ""}`,
    });
  }
  for (const p of t.postponements) {
    items.push({ kind: "postpone", at: p.at, text: p.reason });
  }
  return items.sort((a, b) => (a.at < b.at ? 1 : -1));
}
