import { useState } from "react";
import { ageDays, weekdayCN } from "../screening/date";
import {
  EAR_LABEL,
  FOLLOW_LABEL,
  METHOD_LABEL,
  bothPass,
  latestScreening,
  openTask,
} from "../screening/rules";
import type { BabyRecord, SlotHolder, TransferInput } from "../screening/types";
import type { ActionResult } from "../screening/rules";
import TaskCard, { type TaskActions } from "./TaskCard";

interface Props {
  record: BabyRecord;
  today: string;
  occupancy: Map<string, SlotHolder>;
  actions: TaskActions & {
    closeFollow(recordId: string): ActionResult;
    requestTransfer(recordId: string, input: TransferInput): ActionResult;
    confirmTransfer(recordId: string): ActionResult;
    rejectTransfer(recordId: string, note?: string): ActionResult;
  };
  onMessage: (msg: string, ok: boolean) => void;
}

function EarLine({ label, value }: { label: string; value: "pass" | "refer" }) {
  return <span className={"ear-line " + (value === "pass" ? "is-pass" : "is-refer")}>{label} {EAR_LABEL[value]}</span>;
}

export default function BabyDetail({ record, today, occupancy, actions, onMessage }: Props) {
  const latest = latestScreening(record);
  const current = openTask(record);
  const [target, setTarget] = useState("");
  const [tNote, setTNote] = useState("");
  const [rejectNote, setRejectNote] = useState("");

  const statusClass =
    record.status === "closed-pass"
      ? "st-pass"
      : record.status === "transfer-pending"
        ? "st-transfer"
        : record.status === "transferred"
          ? "st-moved"
          : "st-active";

  const canClose = record.status === "active" && latest && bothPass(latest);

  return (
    <article className={"baby-detail panel " + statusClass}>
      <header className="baby-head">
        <div>
          <div className="baby-title">
            <h3>{record.name}</h3>
            <span className="baby-code">{record.code}</span>
          </div>
          <p className="baby-meta">
            出生 {record.birthDate}（{weekdayCN(record.birthDate)}）· 日龄 {ageDays(record.birthDate, today)} 天 · 建档门店 {record.store}
          </p>
        </div>
        <span className={"follow-badge " + statusClass}>{FOLLOW_LABEL[record.status]}</span>
      </header>

      <section className="initial-box">
        <div className="box-title">
          <h4>初筛资料</h4>
          <span>{record.initial.date} · {METHOD_LABEL[record.initial.method]}</span>
        </div>
        <div className="ear-row">
          <EarLine label="左耳" value={record.initial.left} />
          <EarLine label="右耳" value={record.initial.right} />
        </div>
        <div className={"verdict-sm " + (bothPass(record.initial) ? "is-pass" : "is-refer")}>
          {bothPass(record.initial) ? "初筛双耳通过 → 结束随访" : "任一侧未过 → 出生第 42 天复筛任务"}
        </div>
      </section>

      {record.tasks.length > 0 && (
        <section className="tasks-box">
          <h4>复筛任务</h4>
          <div className="task-stack">
            {record.tasks.map((t) => (
              <TaskCard key={t.id} record={record} task={t} occupancy={occupancy} actions={actions} onMessage={onMessage} />
            ))}
          </div>
        </section>
      )}

      <section className="transfer-box">
        <h4>外地转档</h4>
        {record.status === "active" && (
          <div className="sub-form inline">
            <div className="sub-grid">
              <label>
                <span>转入门店</span>
                <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="如：杭州西湖门店" />
              </label>
              <label>
                <span>说明（选填）</span>
                <input value={tNote} onChange={(e) => setTNote(e.target.value)} placeholder="转档原因" />
              </label>
            </div>
            <div className="sub-actions">
              <button
                className="ghost-btn"
                disabled={!current}
                title={current ? "" : "无进行中任务，无需转档"}
                onClick={() => {
                  const res = actions.requestTransfer(record.id, { targetStore: target, note: tNote });
                  onMessage(res.message, res.ok);
                  if (res.ok) {
                    setTarget("");
                    setTNote("");
                  }
                }}
              >
                申请转档（确认前任务不关闭）
              </button>
            </div>
            <p className="rule-hint">申请后原门店任务锁定、已预约时段保留，防止两地重复安排。</p>
          </div>
        )}

        {record.status === "transfer-pending" && record.transfer && (
          <div className="transfer-pending">
            <p>
              <b>{record.transfer.targetStore}</b> 待确认 ·
              申请于 {record.transfer.requestedAt.slice(0, 16).replace("T", " ")}
            </p>
            {record.transfer.note && <p className="t-note">{record.transfer.note}</p>}
            <div className="confirm-row">
              <button
                className="primary-action"
                onClick={() => {
                  const res = actions.confirmTransfer(record.id);
                  onMessage(res.message, res.ok);
                }}
              >
                对方已接收 · 确认转档
              </button>
              <input
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                placeholder="驳回原因（选填）"
              />
              <button
                onClick={() => {
                  const res = actions.rejectTransfer(record.id, rejectNote);
                  onMessage(res.message, res.ok);
                  if (res.ok) setRejectNote("");
                }}
              >
                驳回（恢复随访）
              </button>
            </div>
            <p className="rule-hint">确认后才关闭原门店任务并释放复筛室时段；驳回则预约原样保留。</p>
          </div>
        )}

        {record.status === "transferred" && record.transfer && (
          <p className="t-done">
            已转至 <b>{record.transfer.targetStore}</b>
            {record.transfer.confirmedAt && <> · 确认于 {record.transfer.confirmedAt.slice(0, 16).replace("T", " ")}</>}
            ，原门店任务已关闭。
          </p>
        )}

        {record.status === "closed-pass" && <p className="t-done">双耳通过，随访已结束，无需转档。</p>}
      </section>

      {record.status === "active" && (
        <section className="close-row">
          <button
            className="primary-action"
            disabled={!canClose}
            title={canClose ? "" : "双耳通过才能结束随访"}
            onClick={() => {
              const res = actions.closeFollow(record.id);
              onMessage(res.message, res.ok);
            }}
          >
            结束随访
          </button>
          {!canClose && <span className="rule-hint">最新一次筛查仍有耳未过，不能结束随访。</span>}
        </section>
      )}
    </article>
  );
}
