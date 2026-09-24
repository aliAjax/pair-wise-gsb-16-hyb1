import type { EarResult, EarSide, ScreeningStore, TestMethod } from "../screening/types";
import {
  SLOT_TIMES,
  addDays,
  formatCN,
  isSlotBookable,
  resultLabel,
  slotId,
  todayISO,
} from "../screening/rules";

/* ---------------- 单耳结果 + 检测方式 ---------------- */

export interface EarValue {
  result: EarResult;
  method: TestMethod;
}

export function EarPicker({
  side,
  value,
  onChange,
  showMethod = true,
  namePrefix,
}: {
  side: EarSide;
  value: EarValue;
  onChange: (value: EarValue) => void;
  showMethod?: boolean;
  namePrefix?: string;
}) {
  const group = `${namePrefix ?? "ear"}-${side}-result`;
  const results: EarResult[] = ["pass", "refer", "untested"];
  const methods: TestMethod[] = ["OAE", "AABR"];
  return (
    <div className="ear-block">
      <h4>{side === "left" ? "左耳" : "右耳"}</h4>
      <div className="radio-row">
        {results.map((result) => (
          <label key={result}>
            <input
              type="radio"
              name={group}
              checked={value.result === result}
              onChange={() => onChange({ ...value, result })}
            />
            {resultLabel(result)}
          </label>
        ))}
      </div>
      {showMethod && (
        <label>
          <span>检测方式</span>
          <select
            value={value.method}
            onChange={(event) => onChange({ ...value, method: event.target.value as TestMethod })}
          >
            {methods.map((method) => (
              <option key={method} value={method}>
                {method === "OAE" ? "OAE 耳声发射" : "AABR 自动脑干反应"}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

/* ---------------- 号源格子：同一时段全科室只接一名婴儿 ---------------- */

export function SlotPicker({
  store,
  excludeTaskId,
  value,
  onChange,
  days = 21,
  notBefore,
  groupName = "slot-pick",
}: {
  store: ScreeningStore;
  excludeTaskId?: string;
  value?: string;
  onChange: (slot: string) => void;
  days?: number;
  notBefore?: string;
  groupName?: string;
}) {
  const start = notBefore && notBefore > todayISO() ? notBefore : todayISO();
  const dates = Array.from({ length: days }, (_, index) => addDays(start, index));

  return (
    <div className="slot-select-grid">
      {dates.flatMap((date) =>
        SLOT_TIMES.map((time) => {
          const id = slotId({ date, time });
          const bookable = isSlotBookable(store, id, excludeTaskId);
          const occupant = !bookable;
          return (
            <div className="slot-cell" key={id} title={bookable ? "" : "该时段已有婴儿预约"}>
              <label className={occupant ? "occupied" : ""}>
                <input
                  type="radio"
                  name={groupName}
                  disabled={!bookable}
                  checked={value === id}
                  onChange={() => onChange(id)}
                />
                <strong>{time}</strong>
                <span>{date.slice(5).replace("-", "/")}</span>
              </label>
            </div>
          );
        }),
      )}
    </div>
  );
}

export function SlotCaption() {
  return <p className="hint">灰色划掉的时段已被占用（复筛室同一时段只接一名婴儿）；{formatCN(todayISO())}起 21 天内可选。</p>;
}
