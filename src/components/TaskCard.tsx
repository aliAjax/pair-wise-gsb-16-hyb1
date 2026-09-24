import { useMemo, useState } from "react";
import type { EarResult, FollowUpTask, PostponeReason, ScreeningStore, TestMethod } from "../screening/types";
import {
  STAGE_LABELS,
  addDays,
  bookSlot,
  bothEarsPass,
  cancelTransfer,
  confirmTransfer,
  daysBetween,
  daysUntil,
  formatCN,
  judgeRescreen,
  logContact,
  methodLabel,
  requestTransfer,
  rescheduleSlot,
  resultLabel,
  submitRescreen,
  taskStage,
  todayISO,
} from "../screening/rules";
import type { RescreenInput } from "../screening/rules";
import { EarPicker, SlotCaption, SlotPicker } from "./forms";

type ActionKind = "book" | "reschedule" | "contact" | "rescreen" | "transfer" | null;

const POSTPONE_REASONS: PostponeReason[] = [
  "联系未果",
  "家长申请改期",
  "婴儿身体不适",
  "天气/交通",
  "号源已满",
  "其他",
];

function dueText(task: FollowUpTask): { text: string; overdue: boolean } {
  if (task.status === "closed") return { text: "随访已结束", overdue: false };
  const left = daysUntil(task.dueDate);
  if (left < 0) return { text: `已逾期 ${-left} 天（应于 ${formatCN(task.dueDate)} 前复筛）`, overdue: true };
  if (left === 0) return { text: "今天为复筛到期日", overdue: true };
  return { text: `距复筛到期 ${left} 天 · ${formatCN(task.dueDate)}`, overdue: false };
}

interface TimelineEntry {
  key: string;
  at: string;
  cls: string;
  html: React.ReactNode;
}

function buildTimeline(task: FollowUpTask): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  const initialPass = bothEarsPass(task.initial);
  entries.push({
    key: "initial",
    at: `${task.initial.date}T00:00:00`,
    cls: "",
    html: (
      <>
        <strong>初筛（{formatCN(task.initial.date)}）</strong>
        <div>
          左耳：{resultLabel(task.initial.left.result)}（{methodLabel(task.initial.left.method)}）·
          右耳：{resultLabel(task.initial.right.result)}（{methodLabel(task.initial.right.method)}）
        </div>
        <div>{initialPass ? "双耳通过，结束随访" : "任一侧未通过，按出生第 42 天生成复筛任务"}</div>
      </>
    ),
  });

  for (const contact of task.contacts) {
    const linked = task.postponements.find((p) => p.at === contact.at);
    entries.push({
      key: contact.id,
      at: contact.at,
      cls: contact.reached ? "" : "miss",
      html: (
        <>
          <strong>{contact.reached ? "已联系上家长" : "联系未果"}</strong>
          <div>{contact.note}</div>
          {linked && (
            <div>
              延期原因：{linked.reason}，应到日顺延至 {formatCN(linked.nextDue)}
              {linked.detail ? `（${linked.detail}）` : ""}
            </div>
          )}
        </>
      ),
    });
  }

  for (const postponement of task.postponements) {
    if (task.contacts.some((c) => c.at === postponement.at)) continue;
    entries.push({
      key: postponement.id,
      at: postponement.at,
      cls: "miss",
      html: (
        <>
          <strong>改期延期：{postponement.reason}</strong>
          {postponement.releasedSlot && <div>原时段 {postponement.releasedSlot} 已先释放</div>}
          <div>
            {postponement.detail}；新应到日 {formatCN(postponement.nextDue)}
          </div>
        </>
      ),
    });
  }

  for (const record of task.rescreens) {
    entries.push({
      key: record.id,
      at: `${record.date}T12:00:00`,
      cls: record.outcome === "passed" ? "" : "miss",
      html: (
        <>
          <strong>
            复筛（{formatCN(record.date)} {record.slot}）· {methodLabel(record.method)}
          </strong>
          <div>
            左耳：{resultLabel(record.left.result)} · 右耳：{resultLabel(record.right.result)}
          </div>
          <div>{judgeRescreen({ left: record.left, right: record.right }).text}</div>
          {record.note && <div>备注：{record.note}</div>}
        </>
      ),
    });
  }

  if (task.transfer.status !== "none") {
    const t = task.transfer;
    entries.push({
      key: "transfer",
      at: t.confirmedAt ?? t.requestedAt,
      cls: "transfer",
      html: (
        <>
          <strong>
            转档{t.status === "pending" ? "申请（待接收门店确认）" : t.status === "confirmed" ? "已确认接收" : "已取消"}
          </strong>
          <div>
            接收门店：{t.targetStore}
            {t.targetContact ? `（${t.targetContact}）` : ""}
          </div>
          {t.status === "pending" && <div>确认前原门店任务不关闭、号源继续占用，避免重复安排</div>}
          {t.note && <div>{t.note}</div>}
        </>
      ),
    });
  }

  return entries.sort((a, b) => (a.at < b.at ? 1 : -1));
}

export function TaskCard({
  task,
  store,
  expanded,
  onToggle,
  run,
}: {
  task: FollowUpTask;
  store: ScreeningStore;
  expanded: boolean;
  onToggle: () => void;
  run: (fn: () => ScreeningStore) => boolean;
}) {
  // 以 store 中的最新数据为准（props.task 在展开期间可能已过期）
  const currentTask = store.tasks.find((t) => t.id === task.id) ?? task;
  const stage = taskStage(currentTask);
  const due = dueText(currentTask);
  const ageDays = daysBetween(currentTask.birthDate, todayISO());
  const [action, setAction] = useState<ActionKind>(null);
  const [slot, setSlot] = useState<string>("");
  const [reason, setReason] = useState<PostponeReason>("家长申请改期");
  const [detail, setDetail] = useState("");
  const [reached, setReached] = useState(true);
  const [contactNote, setContactNote] = useState("");
  const [missReason, setMissReason] = useState<PostponeReason>("联系未果");
  const [missDetail, setMissDetail] = useState("");
  const [missDays, setMissDays] = useState(7);
  const [leftResult, setLeftResult] = useState<EarResult>("pass");
  const [rightResult, setRightResult] = useState<EarResult>("pass");
  const [rescreenMethod, setRescreenMethod] = useState<TestMethod>("OAE");
  const [rescreenDate, setRescreenDate] = useState(todayISO());
  const [rescreenNote, setRescreenNote] = useState("");
  const [targetStore, setTargetStore] = useState("");
  const [targetContact, setTargetContact] = useState("");
  const [transferNote, setTransferNote] = useState("");

  const timeline = useMemo(() => buildTimeline(currentTask), [currentTask]);
  const closed = currentTask.status === "closed";
  const transferPending = currentTask.transfer.status === "pending";

  function reset() {
    setAction(null);
    setSlot("");
    setDetail("");
    setContactNote("");
    setMissDetail("");
    setRescreenNote("");
    setTargetStore("");
    setTargetContact("");
    setTransferNote("");
  }

  function submit(fn: () => ScreeningStore) {
    if (run(fn)) reset();
  }

  const readingPreview = judgeRescreen({
    left: { result: leftResult, method: rescreenMethod },
    right: { result: rightResult, method: rescreenMethod },
  });

  return (
    <article className={`task-card ${closed ? "closed" : ""}`}>
      <div className="task-main">
        <div className="task-index">{currentTask.babyName.slice(0, 1)}</div>
        <div>
          <div className="task-title">
            <h3>{currentTask.babyName}</h3>
            <span className={`badge ${stage}`}>{STAGE_LABELS[stage]}</span>
            <span className="ear-result">
              <span>
                初筛 左
                <span className={`pill ${currentTask.initial.left.result}`}>{resultLabel(currentTask.initial.left.result)}</span>
              </span>
              <span>
                右
                <span className={`pill ${currentTask.initial.right.result}`}>{resultLabel(currentTask.initial.right.result)}</span>
              </span>
            </span>
          </div>
          <div className="task-meta">
            <span>{currentTask.store}</span>
            <span>出生 {formatCN(currentTask.birthDate)}（{ageDays} 天）</span>
            <span>监护人 {currentTask.guardianPhone}</span>
            {currentTask.slot && <span>已约 {currentTask.slot}</span>}
            {currentTask.rescreens.length > 0 && <span>已复筛 {currentTask.rescreens.length} 次</span>}
          </div>
        </div>
        <div className="task-side">
          <span className={`due-line ${due.overdue ? "overdue" : ""}`}>{due.text}</span>
          <button className="task-toggle" onClick={onToggle}>
            {expanded ? "收起 ▲" : "跟进详情 ▼"}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="task-detail">
          <div className="detail-block">
            <h4>随访记录</h4>
            <div className="timeline">
              {timeline.map((entry) => (
                <div key={entry.key} className={`timeline-item ${entry.cls}`}>
                  <div className="time">{entry.at.replace("T", " ").slice(0, 16)}</div>
                  {entry.html}
                </div>
              ))}
            </div>
          </div>

          <div className="detail-block">
            <h4>操作</h4>
            <div className="action-stack">
              {closed && (
                <p className="hint">
                  该婴儿双耳已通过，随访结束。
                  {currentTask.transfer.status === "confirmed" && "档案已随转档移交接收门店。"}
                </p>
              )}

              {!closed && (
                <div className="action-row">
                  {!currentTask.slot && !transferPending && (
                    <button className="primary-action" onClick={() => setAction(action === "book" ? null : "book")}>
                      预约复筛
                    </button>
                  )}
                  {currentTask.slot && !transferPending && (
                    <button onClick={() => setAction(action === "reschedule" ? null : "reschedule")}>改期</button>
                  )}
                  {!transferPending && (
                    <button onClick={() => setAction(action === "contact" ? null : "contact")}>登记联系</button>
                  )}
                  {currentTask.slot && !transferPending && (
                    <button onClick={() => setAction(action === "rescreen" ? null : "rescreen")}>登记复筛结果</button>
                  )}
                  {!transferPending && (
                    <button onClick={() => setAction(action === "transfer" ? null : "transfer")}>申请转档</button>
                  )}
                </div>
              )}

              {transferPending && (
                <div className="action-form">
                  <div className="rule-note">
                    转档至 {currentTask.transfer.targetStore} 待确认。确认接收前，原门店任务保持开放
                    {currentTask.slot ? `，号源 ${currentTask.slot} 继续占用` : ""}；驳回后继续在本店随访。
                  </div>
                  <div className="action-row">
                    <button className="primary-action" onClick={() => run(() => confirmTransfer(store, task.id))}>
                      模拟接收门店确认
                    </button>
                    <button className="ghost-danger" onClick={() => run(() => cancelTransfer(store, task.id))}>
                      驳回转档
                    </button>
                  </div>
                </div>
              )}

              {action === "book" && (
                <form
                  className="action-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submit(() => bookSlot(store, task.id, slot));
                  }}
                >
                  <SlotPicker
                    store={store}
                    excludeTaskId={task.id}
                    value={slot}
                    onChange={setSlot}
                    groupName={`book-${task.id}`}
                    notBefore={currentTask.dueDate > todayISO() ? addDays(currentTask.dueDate, -7) : todayISO()}
                  />
                  <SlotCaption />
                  <div className="action-row">
                    <button type="submit" className="primary-action" disabled={!slot}>
                      确认预约
                    </button>
                    <button type="button" onClick={() => setAction(null)}>
                      取消
                    </button>
                  </div>
                </form>
              )}

              {action === "reschedule" && (
                <form
                  className="action-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submit(() => rescheduleSlot(store, task.id, slot, reason, detail));
                  }}
                >
                  <div className="rule-note">
                    改期将先释放原时段 {currentTask.slot}，再占用新时段；释放与占用均在延期记录中留痕。
                  </div>
                  <SlotPicker store={store} excludeTaskId={task.id} value={slot} onChange={setSlot} groupName={`resched-${task.id}`} />
                  <SlotCaption />
                  <label>
                    <span>延期原因</span>
                    <select value={reason} onChange={(e) => setReason(e.target.value as PostponeReason)}>
                      {POSTPONE_REASONS.filter((r) => r !== "联系未果").map((r) => (
                        <option key={r}>{r}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>情况说明</span>
                    <textarea value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="如：接种疫苗当日无法前来" />
                  </label>
                  <div className="action-row">
                    <button type="submit" className="primary-action" disabled={!slot || !detail.trim()}>
                      确认改期
                    </button>
                    <button type="button" onClick={() => setAction(null)}>
                      取消
                    </button>
                  </div>
                </form>
              )}

              {action === "contact" && (
                <form
                  className="action-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submit(() =>
                      logContact(
                        store,
                        task.id,
                        reached,
                        contactNote,
                        reached ? undefined : { reason: missReason, detail: missDetail, days: missDays },
                      ),
                    );
                  }}
                >
                  <div className="radio-row">
                    <label>
                      <input type="radio" name={`contact-${task.id}`} checked={reached} onChange={() => setReached(true)} />
                      已联系上
                    </label>
                    <label>
                      <input type="radio" name={`contact-${task.id}`} checked={!reached} onChange={() => setReached(false)} />
                      联系未果
                    </label>
                  </div>
                  <label>
                    <span>联系情况（每次尝试都留痕）</span>
                    <textarea
                      value={contactNote}
                      onChange={(e) => setContactNote(e.target.value)}
                      placeholder="如：10:02 拨打，家长接听，约定本周五复筛"
                    />
                  </label>
                  {!reached && (
                    <>
                      <label>
                        <span>延期原因（联系未果必填）</span>
                        <select value={missReason} onChange={(e) => setMissReason(e.target.value as PostponeReason)}>
                          {POSTPONE_REASONS.map((r) => (
                            <option key={r}>{r}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>延期说明</span>
                        <textarea
                          value={missDetail}
                          onChange={(e) => setMissDetail(e.target.value)}
                          placeholder="如：两次拨打无人接听，已发短信，三日后再拨"
                        />
                      </label>
                      <label>
                        <span>顺延天数（应到日从今天起顺延）</span>
                        <input
                          type="number"
                          min={1}
                          max={60}
                          value={missDays}
                          onChange={(e) => setMissDays(Number(e.target.value))}
                        />
                      </label>
                    </>
                  )}
                  <div className="action-row">
                    <button
                      type="submit"
                      className="primary-action"
                      disabled={!contactNote.trim() || (!reached && !missDetail.trim())}
                    >
                      保存联系记录
                    </button>
                    <button type="button" onClick={() => setAction(null)}>
                      取消
                    </button>
                  </div>
                </form>
              )}

              {action === "rescreen" && (
                <form
                  className="action-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const payload: RescreenInput = {
                      date: rescreenDate,
                      method: rescreenMethod,
                      leftResult,
                      rightResult,
                      note: rescreenNote,
                    };
                    submit(() => submitRescreen(store, task.id, payload));
                  }}
                >
                  <div className="form-grid">
                    <label>
                      <span>复筛日期</span>
                      <input type="date" value={rescreenDate} onChange={(e) => setRescreenDate(e.target.value)} />
                    </label>
                    <label>
                      <span>检测方式（双耳一致）</span>
                      <select value={rescreenMethod} onChange={(e) => setRescreenMethod(e.target.value as TestMethod)}>
                        <option value="OAE">OAE 耳声发射</option>
                        <option value="AABR">AABR 自动脑干反应</option>
                      </select>
                    </label>
                    <EarPicker
                      side="left"
                      showMethod={false}
                      namePrefix={`rs-${task.id}`}
                      value={{ result: leftResult, method: rescreenMethod }}
                      onChange={(v) => setLeftResult(v.result)}
                    />
                    <EarPicker
                      side="right"
                      showMethod={false}
                      namePrefix={`rs-${task.id}`}
                      value={{ result: rightResult, method: rescreenMethod }}
                      onChange={(v) => setRightResult(v.result)}
                    />
                  </div>
                  <p className="hint" style={{ margin: 0 }}>
                    当前号源 {currentTask.slot}，提交后自动释放。
                  </p>
                  <div className={`verdict ${readingPreview.outcome === "passed" ? "pass" : "refer"}`}>
                    判定预览：{readingPreview.text}
                  </div>
                  <label>
                    <span>备注</span>
                    <textarea value={rescreenNote} onChange={(e) => setRescreenNote(e.target.value)} />
                  </label>
                  <div className="action-row">
                    <button type="submit" className="primary-action">
                      提交复筛
                    </button>
                    <button type="button" onClick={() => setAction(null)}>
                      取消
                    </button>
                  </div>
                </form>
              )}

              {action === "transfer" && (
                <form
                  className="action-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submit(() => requestTransfer(store, task.id, targetStore, targetContact, transferNote));
                  }}
                >
                  <div className="rule-note">
                    发起后原门店任务不关闭、号源不释放；接收门店确认前，本店仍可继续联系，两地不会重复安排。
                  </div>
                  <div className="form-grid">
                    <label>
                      <span>接收门店</span>
                      <input value={targetStore} onChange={(e) => setTargetStore(e.target.value)} placeholder="如：天津滨海门店" />
                    </label>
                    <label>
                      <span>门店联系方式</span>
                      <input value={targetContact} onChange={(e) => setTargetContact(e.target.value)} placeholder="电话 / 对接人" />
                    </label>
                    <label className="span-2">
                      <span>转档说明</span>
                      <textarea
                        value={transferNote}
                        onChange={(e) => setTransferNote(e.target.value)}
                        placeholder="迁居原因、已完成筛查情况等"
                      />
                    </label>
                  </div>
                  <div className="action-row">
                    <button type="submit" className="primary-action" disabled={!targetStore.trim()}>
                      发起转档
                    </button>
                    <button type="button" onClick={() => setAction(null)}>
                      取消
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </article>
  );
}
