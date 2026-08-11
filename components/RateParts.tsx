"use client";

/**
 * 배부율 입력 표의 공용 조각.
 *
 * 관리자 '검토 및 확정 > 리소스배부율'(ConfirmReview)과 담당자에게 보내는 조사 링크(/submit/[token])가
 * **같은 화면 구성**을 쓰도록 표·행 컴포넌트를 여기 모아둔다. 한쪽만 고쳐 두 화면이 어긋나는 일을 막는다.
 *
 * 조직 목록·조직명 상수(ORG_ORDER, MIRROR_RULES 등)는 여기에 두지 않는다 —
 * 이 모듈은 공개 링크 화면의 번들에도 들어가므로, 담당자에게 다른 조직명이 노출되면 안 된다.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  TARGETS,
  TargetKey,
  sumTargets,
  normalizeTargets,
  RATE_TOTAL_TOLERANCE,
  fractionToPercentInput,
  percentInputToFraction,
} from "@/lib/targets";
import { sortQuarters } from "@/lib/quarter";
import { readPasteGrid, shouldHandlePaste } from "@/lib/paste";

export type PersonRole = "법인" | "주재원";

export type RateMap = Record<TargetKey, string>;

export interface PersonHistoryEntry {
  name: string;
  period: string;
  headcount: number | null;
  rates: Record<TargetKey, number>;
  total: number;
  submittedAt: string;
  note: string | null;
  role: PersonRole;
}

export interface RateHistoryEntry {
  quarter: string;
  rates: Record<TargetKey, number>;
  total: number;
  headcount?: number | null;
  note?: string | null;
}

export interface CurrentPerson {
  name: string;
  headcount: number | null;
  rates: Record<TargetKey, number>;
  note: string | null;
  role: PersonRole;
}

export interface PersonHistoryRow {
  name: string;
  period: string;
  headcount: number | null;
  rates: Record<TargetKey, number>;
  total: number;
  note: string | null;
  role: PersonRole;
}

export interface PersonEditRow {
  key: string;
  name: string;
  headcount: string;
  note: string;
  role: PersonRole;
  rates: RateMap;
}

/**
 * 코멘트 말풍선.
 * 표가 overflow:auto 스크롤 컨테이너라 말풍선을 표 안에 그리면 잘려서 안 보인다.
 * 그래서 body에 portal로 띄우고 위치를 직접 계산한다(잘림 없음).
 * 커서를 떼도 2초는 남겨두고, 그 사이 말풍선 위로 커서를 옮기면 계속 유지된다.
 */
const NOTE_TIP_LINGER_MS = 2000; // 커서를 뗀 뒤 남아 있는 시간
const NOTE_TIP_FADE_MS = 450; // 그 뒤 서서히 사라지는 시간 (globals.css의 transition과 맞춰둔다)
const NOTE_TIP_WIDTH = 320;
const NOTE_TIP_SHIFT_LEFT = 140; // 아이콘보다 왼쪽으로 당겨 코멘트가 왼쪽에 치우쳐 보이게 한다

// 코멘트는 표 어디서나 같은 방식으로 보여준다 — 원 안의 i에 커서를 대면 말풍선이 뜬다.
export function NoteTip({ text }: { text: string }) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [fading, setFading] = useState(false);
  const linger = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fade = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (linger.current) clearTimeout(linger.current);
      if (fade.current) clearTimeout(fade.current);
    },
    []
  );

  function clearTimers() {
    if (linger.current) { clearTimeout(linger.current); linger.current = null; }
    if (fade.current) { clearTimeout(fade.current); fade.current = null; }
  }
  function show(e: React.MouseEvent | React.FocusEvent) {
    clearTimers();
    setFading(false);
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // 아이콘 기준 왼쪽으로 당기되, 화면 밖으로는 나가지 않게 가둔다.
    const left = Math.max(8, Math.min(r.left - NOTE_TIP_SHIFT_LEFT, window.innerWidth - NOTE_TIP_WIDTH - 12));
    setPos({ left, top: r.bottom + 6 });
  }
  function scheduleHide() {
    clearTimers();
    linger.current = setTimeout(() => {
      setFading(true); // 여기서부터 CSS transition으로 서서히 흐려진다
      fade.current = setTimeout(() => { setPos(null); setFading(false); }, NOTE_TIP_FADE_MS);
    }, NOTE_TIP_LINGER_MS);
  }

  return (
    <>
      <button
        className="av-note-btn"
        type="button"
        onMouseEnter={show}
        onMouseLeave={scheduleHide}
        onFocus={show}
        onBlur={scheduleHide}
      >
        i
      </button>
      {pos !== null &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className={`av-note-tip${fading ? " is-fading" : ""}`}
            style={{ left: pos.left, top: pos.top }}
            onMouseEnter={() => { clearTimers(); setFading(false); }}
            onMouseLeave={scheduleHide}
          >
            {text}
          </div>,
          document.body
        )}
    </>
  );
}

export function emptyRates(): RateMap {
  const r = {} as RateMap;
  TARGETS.forEach((t) => (r[t.key] = "0"));
  return r;
}

export function toRateMap(rec: Record<TargetKey, number> | null): RateMap {
  const r = emptyRates();
  if (!rec) return r;
  TARGETS.forEach((t) => (r[t.key] = String(rec[t.key] ?? 0)));
  return r;
}

export function totalOf(rates: RateMap): number {
  const parsed = {} as Record<TargetKey, number>;
  TARGETS.forEach((t) => (parsed[t.key] = Number(rates[t.key]) || 0));
  return sumTargets(parsed);
}

// 합계가 0(미입력)이거나 100%에 근접해야 통과. "값은 있는데 100%가 아닌" 경우만 오류로 취급.
export function totalIsValid(rates: RateMap): boolean {
  const total = totalOf(rates);
  return total === 0 || Math.abs(total - 1) < RATE_TOTAL_TOLERANCE;
}

export function recTotal(rec: Record<TargetKey, number>): number {
  return TARGETS.reduce((sum, t) => sum + (rec[t.key] || 0), 0);
}

export function toNumRec(rates: RateMap): Record<TargetKey, number> {
  const r = {} as Record<TargetKey, number>;
  TARGETS.forEach((t) => (r[t.key] = Number(rates[t.key]) || 0));
  return r;
}

// 과거 이력 분기 + 현재 입력/조회 중인 분기를 합쳐 항상 연도->분기 순으로 정렬한다.
// 현재 분기가 과거 데이터보다 이전 분기일 수도 있으므로(예: 2Q까지 입력된 상태에서 1Q를 다시 열람),
// 단순히 표 맨 아래에 이어붙이면 순서가 뒤집혀 보인다.
export function orderedQuarters(pastQuarters: string[], current: string): string[] {
  return sortQuarters(Array.from(new Set([...pastQuarters, current])));
}

/**
 * 개인별 표에서 '한 명'으로 세는 행 = 이름이 있고 배부율이 0%가 아닌 행.
 * 개인별 입력은 한 행이 곧 한 명이라 인원수를 따로 받지 않으므로, 인원수는 이 행 수로 센다.
 */
export function countedPersons(persons: PersonEditRow[]): PersonEditRow[] {
  return persons.filter((p) => p.name.trim() && totalOf(p.rates) > 0);
}

// 개인별 입력은 한 행이 한 명이므로 모두 같은 가중치(1명)로 단순 평균한다.
// 개인 합계는 100%에서 ±0.5%p까지 허용되므로(totalIsValid), 평균낸 조직 값은 100%로 맞춘다 —
// 서버 저장값(lib/rollup의 computeRollup)과 같은 값이 화면에 보여야 한다.
export function averageFromPersons(persons: PersonEditRow[]): RateMap {
  const counted = countedPersons(persons);
  const r = emptyRates();
  if (counted.length === 0) return r;
  const avg = {} as Record<TargetKey, number>;
  TARGETS.forEach((t) => {
    const sum = counted.reduce((acc, p) => acc + (Number(p.rates[t.key]) || 0), 0);
    avg[t.key] = sum / counted.length;
  });
  return toRateMap(normalizeTargets(avg));
}

// 개인별 입력은 한 행 = 한 명이므로, 이름이 있고 배부율이 0%가 아닌 행 수가 곧 인원수다.
export function namedHeadcountSum(list: PersonEditRow[]): number | null {
  const counted = countedPersons(list);
  return counted.length === 0 ? null : counted.length;
}

/**
 * 주재원 전용 조직인지 (basis가 '_주재원'으로 끝나는 조직). 이런 조직은 소속 인원이 전원 '주재원'으로 저장되므로
 * 법인분/주재원분으로 나누면 안 된다 — 나누면 아무도 안 남는다.
 */
export function isExpatOnly(division: string, basis: string): boolean {
  return division === "주재원" || String(basis).endsWith("_주재원");
}

// 개인별 이력(personHistory)에서 특정 분기의 인원수. 한 행이 한 명이므로 값이 채워진 행 수를 센다.
//   "legal"  = 법인분만 · "expat" = 주재원분만 · "all" = 구분 없이 전부(주재원 전용 조직용)
export type HeadcountScope = "legal" | "expat" | "all";
export function personHeadcountForQuarter(
  history: PersonHistoryEntry[],
  quarter: string,
  scope: HeadcountScope
): number | null {
  const rows = history.filter(
    (h) =>
      h.period === quarter &&
      h.total > 0 &&
      (scope === "all" ? true : scope === "legal" ? h.role !== "주재원" : h.role === "주재원")
  );
  return rows.length > 0 ? rows.length : null;
}

export function personRowFromCurrent(p: CurrentPerson, i: number): PersonEditRow {
  return {
    key: `${i}-${p.name}`,
    name: p.name,
    headcount: "1",
    note: p.note ?? "",
    role: p.role,
    rates: toRateMap(p.rates),
  };
}

// 저장 API로 보낼 개인별 페이로드: 이름이 있는 행만, DB의 sub_team 컬럼 형태(주재원/null)로 변환.
export function toPersonPayload(list: PersonEditRow[]) {
  return list
    .filter((p) => p.name.trim())
    .map((p) => ({
      name: p.name,
      // 개인별 입력은 한 행 = 한 명이므로 항상 1로 저장한다.
      headcount: 1,
      note: p.note || null,
      subTeam: p.role === "주재원" ? "주재원" : null,
      rates: p.rates,
    }));
}

export function RateTableHead({ withClear, withNote }: { withClear?: boolean; withNote?: boolean } = {}) {
  return (
    <thead>
      <tr>
        {withClear && <th></th>}
        <th></th>
        <th>인원수</th>
        {TARGETS.map((t) => (
          <th key={t.key} className={t.group === "humax" ? "grp-humax" : "grp-affiliate"}>
            {t.label}
          </th>
        ))}
        <th>TOTAL</th>
        {withNote && <th>코멘트</th>}
      </tr>
    </thead>
  );
}

export function ReadOnlyRateRow({
  label,
  rec,
  headcount,
  showClearSlot,
  withNote,
  note,
  noteEditable,
  noteValue,
  onNoteChange,
  onNoteCommit,
  noteSaveState,
  noteDirty,
}: {
  label: string;
  rec: Record<TargetKey, number>;
  headcount?: number | null;
  showClearSlot?: boolean;
  withNote?: boolean;
  note?: string | null;
  /** 배부율은 자동계산이라 못 고치지만 코멘트만은 적을 수 있게 한다. */
  noteEditable?: boolean;
  noteValue?: string;
  onNoteChange?: (v: string) => void;
  onNoteCommit?: () => void;
  noteSaveState?: "idle" | "saving" | "saved" | "error";
  /** 저장하지 않은 변경이 있으면 버튼을 짙게 칠해 눈에 띄게 한다. */
  noteDirty?: boolean;
}) {
  const total = recTotal(rec);
  return (
    <tr className="ro-row">
      {showClearSlot && <td></td>}
      <td>{label}</td>
      <td>{headcount != null ? `${headcount}명` : "-"}</td>
      {TARGETS.map((t) => (
        <td key={t.key}>{((rec[t.key] || 0) * 100).toFixed(1)}%</td>
      ))}
      <td className="total-col">{(total * 100).toFixed(1)}%</td>
      {withNote && (
        <td>
          {noteEditable ? (
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <input
                value={noteValue ?? ""}
                onChange={(e) => onNoteChange?.(e.target.value)}
                onBlur={() => onNoteCommit?.()}
                // 엔터로도 저장되게 한다 (표 안이라 폼 제출이 없다).
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onNoteCommit?.();
                  }
                }}
                placeholder="코멘트"
                // 숫자 칸은 오른쪽 정렬이 기본이지만 코멘트는 글이라 왼쪽부터 읽는다.
                style={{ width: 120, textAlign: "left" }}
              />
              {/* 커서를 옮겨야 저장되는 게 불편해 눌러서 저장하는 버튼을 둔다. */}
              <button
                type="button"
                className={`note-save-btn${noteDirty ? " is-dirty" : ""}`}
                title={noteDirty ? "저장하지 않은 변경이 있습니다 — 눌러서 저장" : "코멘트 저장"}
                aria-label="코멘트 저장"
                disabled={noteSaveState === "saving"}
                onClick={() => onNoteCommit?.()}
              >
                ✓
              </button>
              <span style={{ fontSize: 11, color: noteSaveState === "error" ? "#dc2626" : "#94a3b8", whiteSpace: "nowrap" }}>
                {noteSaveState === "saving" ? "저장중" : noteSaveState === "saved" ? "저장됨" : noteSaveState === "error" ? "실패" : ""}
              </span>
            </div>
          ) : (
            note && <NoteTip text={note} />
          )}
        </td>
      )}
    </tr>
  );
}

export function EditableRateRow({
  label,
  rates,
  onChange,
  headcount,
  onClear,
  headcountEditable,
  headcountValue,
  onHeadcountChange,
  withNote,
  noteValue,
  onNoteChange,
}: {
  label: string;
  rates: RateMap;
  onChange: (key: TargetKey, value: string) => void;
  headcount?: number | null;
  onClear?: () => void;
  headcountEditable?: boolean;
  headcountValue?: string;
  onHeadcountChange?: (value: string) => void;
  withNote?: boolean;
  noteValue?: string;
  onNoteChange?: (value: string) => void;
}) {
  const total = totalOf(rates);
  const ok = Math.abs(total - 1) < 0.005 || total === 0;
  return (
    <tr>
      {onClear && (
        <td>
          <button type="button" className="row-clear-btn" title="입력값 지우기" onClick={onClear}>
            ✕
          </button>
        </td>
      )}
      <td>{label}</td>
      <td>
        {headcountEditable ? (
          <input
            type="number"
            min="0"
            value={headcountValue ?? ""}
            onChange={(e) => onHeadcountChange?.(e.target.value)}
            style={{ width: 48 }}
          />
        ) : headcount != null ? (
          `${headcount}명`
        ) : (
          "-"
        )}
      </td>
      {TARGETS.map((t, i) => (
        <td key={t.key}>
          <div className="pct-input">
            <input
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={fractionToPercentInput(rates[t.key])}
              onChange={(e) => onChange(t.key, percentInputToFraction(e.target.value))}
              onPaste={(e) => {
                if (!shouldHandlePaste(e.clipboardData)) return;
                e.preventDefault();
                const row = readPasteGrid(e.clipboardData)[0] ?? [];
                row.forEach((tok, offset) => {
                  const target = TARGETS[i + offset];
                  // 빈 칸은 건너뛰지 않고 0%로 채운다 — 건너뛰면 예전 값이 그대로 남는다.
                  if (target) onChange(target.key, tok === "" ? "0" : percentInputToFraction(tok));
                });
              }}
            />
            <span>%</span>
          </div>
        </td>
      ))}
      <td className={`total-col ${ok ? "total-ok" : "total-bad"}`}>{(total * 100).toFixed(1)}%</td>
      {withNote && (
        <td>
          <input
            value={noteValue ?? ""}
            onChange={(e) => onNoteChange?.(e.target.value)}
            placeholder="코멘트"
            // 숫자 칸은 오른쪽 정렬이 기본이지만 코멘트는 글이라 왼쪽부터 읽는다.
            style={{ width: 120, textAlign: "left" }}
          />
        </td>
      )}
    </tr>
  );
}

// 개인별 표 붙여넣기: 열 순서를 [이름, ...13개 배부대상, 코멘트]로 보고, 시작 셀부터 채운다.
// (인원수 열은 화면에 없다 — 한 행이 곧 한 명이다.)
const PASTE_NOTE_COL = TARGETS.length + 1;
function applyPasteToken(person: PersonEditRow, colIdx: number, token: string): PersonEditRow {
  if (colIdx === 0) return { ...person, name: token };
  if (colIdx === PASTE_NOTE_COL) return { ...person, note: token };
  const target = TARGETS[colIdx - 1];
  if (!target) return person;
  // 빈 칸은 건너뛰지 않고 0%로 채운다 — 건너뛰면 그 사람 값이 예전 값 그대로 남아버린다.
  return {
    ...person,
    rates: { ...person.rates, [target.key]: token === "" ? "0" : percentInputToFraction(token) },
  };
}

/** 개인별 입력 표 (현재 분기). 이름·구분·배부율·코멘트를 한 행에서 받고, 엑셀 붙여넣기를 지원한다. */
export function PersonEditTable({
  persons,
  setPersons,
  hasExpat,
}: {
  persons: PersonEditRow[];
  setPersons: (updater: (list: PersonEditRow[]) => PersonEditRow[]) => void;
  hasExpat: boolean;
}) {
  function updatePerson(key: string, patch: Partial<PersonEditRow>) {
    setPersons((list) => list.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  }
  function updatePersonRate(key: string, target: TargetKey, value: string) {
    setPersons((list) => list.map((p) => (p.key === key ? { ...p, rates: { ...p.rates, [target]: value } } : p)));
  }
  function addPerson() {
    setPersons((list) => [
      ...list,
      { key: `${Date.now()}`, name: "", headcount: "1", note: "", role: "법인", rates: emptyRates() },
    ]);
  }
  function removePerson(key: string) {
    setPersons((list) => list.filter((p) => p.key !== key));
  }
  // 여러 행(사람)에 걸쳐 붙여넣으면 아래 행이 부족한 경우 자동으로 행을 추가한다.
  function handlePersonCellPaste(personIdx: number, startColIdx: number, clipboard: DataTransfer) {
    const grid = readPasteGrid(clipboard);
    setPersons((list) => {
      const next = [...list];
      grid.forEach((rowTokens, ri) => {
        const idx = personIdx + ri;
        while (next.length <= idx) {
          next.push({ key: `paste-${Date.now()}-${next.length}`, name: "", headcount: "1", note: "", role: "법인", rates: emptyRates() });
        }
        let person = next[idx];
        rowTokens.forEach((tok, ci) => {
          person = applyPasteToken(person, startColIdx + ci, tok);
        });
        next[idx] = person;
      });
      return next;
    });
  }

  return (
    <>
      <div className="tbl-scroll" style={{ marginBottom: 12 }}>
        <table className="rate-tbl">
          <thead>
            <tr>
              <th></th>
              {/* 개인별 입력은 한 행 = 한 명이라 인원수 열을 두지 않는다 (이름+배부율이 있으면 1명으로 센다). */}
              <th>이름</th>
              {hasExpat && <th>구분</th>}
              {TARGETS.map((t) => (
                <th key={t.key} className={t.group === "humax" ? "grp-humax" : "grp-affiliate"}>
                  {t.label}
                </th>
              ))}
              <th>TOTAL</th>
              <th>코멘트</th>
            </tr>
          </thead>
          <tbody>
            {persons.map((p, pIdx) => {
              const pTotal = totalOf(p.rates);
              const pOk = Math.abs(pTotal - 1) < 0.005 || pTotal === 0;
              return (
                <tr key={p.key}>
                  <td>
                    <button type="button" className="row-clear-btn" title="행 삭제" onClick={() => removePerson(p.key)}>
                      ✕
                    </button>
                  </td>
                  <td>
                    <input
                      value={p.name}
                      onChange={(e) => updatePerson(p.key, { name: e.target.value })}
                      placeholder="이름"
                      style={{ width: 100, textAlign: "center" }}
                      onPaste={(e) => {
                        if (!shouldHandlePaste(e.clipboardData)) return;
                        e.preventDefault();
                        handlePersonCellPaste(pIdx, 0, e.clipboardData);
                      }}
                    />
                  </td>
                  {hasExpat && (
                    <td>
                      <select value={p.role} onChange={(e) => updatePerson(p.key, { role: e.target.value as PersonRole })}>
                        <option value="법인">법인</option>
                        <option value="주재원">주재원</option>
                      </select>
                    </td>
                  )}
                  {TARGETS.map((t, tIdx) => (
                    <td key={t.key}>
                      <div className="pct-input">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max="100"
                          value={fractionToPercentInput(p.rates[t.key])}
                          onChange={(e) => updatePersonRate(p.key, t.key, percentInputToFraction(e.target.value))}
                          onPaste={(e) => {
                            if (!shouldHandlePaste(e.clipboardData)) return;
                            e.preventDefault();
                            handlePersonCellPaste(pIdx, 1 + tIdx, e.clipboardData);
                          }}
                        />
                        <span>%</span>
                      </div>
                    </td>
                  ))}
                  <td className={`total-col ${pOk ? "total-ok" : "total-bad"}`}>{(pTotal * 100).toFixed(1)}%</td>
                  <td>
                    <input
                      value={p.note}
                      onChange={(e) => updatePerson(p.key, { note: e.target.value })}
                      placeholder="코멘트"
                      // 숫자 칸은 오른쪽 정렬이 기본이지만 코멘트는 글이라 왼쪽부터 읽는다.
                      style={{ width: 120, textAlign: "left" }}
                      onPaste={(e) => {
                        if (!shouldHandlePaste(e.clipboardData)) return;
                        e.preventDefault();
                        handlePersonCellPaste(pIdx, PASTE_NOTE_COL, e.clipboardData);
                      }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="person-row-actions">
        <button className="btn btn-secondary btn-sm" onClick={addPerson}>
          + {hasExpat ? "인원" : "팀원"} 추가
        </button>
      </div>
    </>
  );
}

/** 개인별 표 (읽기 전용) — 확정/제출이 끝나 잠긴 분기. */
export function PersonReadOnlyTable({ persons, hasExpat }: { persons: PersonEditRow[]; hasExpat: boolean }) {
  return (
    <div className="tbl-scroll" style={{ marginBottom: 12 }}>
      <table className="rate-tbl">
        <thead>
          <tr>
            <th>이름</th>
            {hasExpat && <th>구분</th>}
            {TARGETS.map((t) => (
              <th key={t.key} className={t.group === "humax" ? "grp-humax" : "grp-affiliate"}>
                {t.label}
              </th>
            ))}
            <th>TOTAL</th>
            <th>코멘트</th>
          </tr>
        </thead>
        <tbody>
          {persons.map((p) => (
            <tr key={p.key} className="ro-row">
              <td>{p.name}</td>
              {hasExpat && <td>{p.role}</td>}
              {TARGETS.map((t) => (
                <td key={t.key}>{(Number(p.rates[t.key] || 0) * 100).toFixed(1)}%</td>
              ))}
              <td className="total-col">{(totalOf(p.rates) * 100).toFixed(1)}%</td>
              <td>
                {p.note && (
                  <NoteTip text={p.note} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 분기별로 하나씩 "{분기} (확정됨)" 헤더 + 표를 렌더링한다.
 * (예전에는 여러 분기를 표 하나에 몰아넣고 분기 라벨을 표 안의 행으로 넣었는데,
 * 현재 분기 섹션만 표 위에 별도 텍스트가 있어서 스타일이 서로 달라 보였다.)
 */
export function PersonHistoryBlocks({
  rows,
  quarterOrder,
  hasExpat,
}: {
  rows: PersonHistoryRow[];
  quarterOrder: string[];
  hasExpat: boolean;
}) {
  const byQuarter = new Map<string, PersonHistoryRow[]>();
  rows.forEach((p) => {
    const list = byQuarter.get(p.period) ?? [];
    list.push(p);
    byQuarter.set(p.period, list);
  });
  const quarters = quarterOrder.filter((q) => byQuarter.has(q));
  return (
    <>
      {quarters.map((q) => (
        <div key={q}>
          <div className="field-hint" style={{ fontWeight: 700, color: "#1a202c", margin: "0 0 8px" }}>
            {q} (확정됨)
          </div>
          <div className="tbl-scroll" style={{ marginBottom: 12 }}>
            <table className="rate-tbl">
              <thead>
                <tr>
                  <th>이름</th>
                  {hasExpat && <th>구분</th>}
                  {TARGETS.map((t) => (
                    <th key={t.key} className={t.group === "humax" ? "grp-humax" : "grp-affiliate"}>
                      {t.label}
                    </th>
                  ))}
                  <th>TOTAL</th>
                  <th>코멘트</th>
                </tr>
              </thead>
              <tbody>
                {byQuarter.get(q)!.map((p) => (
                  <tr key={`${p.name}-${p.role}`} className="ro-row">
                    <td>{p.name}</td>
                    {hasExpat && <td>{p.role}</td>}
                    {TARGETS.map((t) => (
                      <td key={t.key}>{((p.rates[t.key] || 0) * 100).toFixed(1)}%</td>
                    ))}
                    <td className="total-col">{(p.total * 100).toFixed(1)}%</td>
                    <td>
                      {p.note && (
                        <NoteTip text={p.note} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </>
  );
}
