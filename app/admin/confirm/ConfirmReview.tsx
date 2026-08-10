"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  TARGETS,
  TargetKey,
  sumTargets,
  fractionToPercentInput,
  percentInputToFraction,
  getPreviousPeriod,
} from "@/lib/targets";
import { sortQuarters } from "@/lib/quarter";
import { HIDDEN_IN_CONFIRM } from "@/lib/autoAggregate";

export type PersonRole = "법인" | "주재원";

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

export interface OrgReviewData {
  org: {
    id: number;
    basis: string;
    division: string;
    type: string;
    requires_person_detail: boolean;
    access_token: string;
    parent_basis: string | null;
  };
  hasSubmission: boolean;
  submittedBy: string | null;
  latestSubmittedAt: string | null;
  confirmedThisPeriod: boolean;
  rollup: Record<TargetKey, number>;
  currentOrgSubmission: Record<TargetKey, number> | null;
  submittedHeadcount: number | null;
  submittedNote: string | null;
  currentPersons: CurrentPerson[];
  currentRate: Record<TargetKey, number> | null;
  currentQuarter: string | null;
  personHistory: PersonHistoryEntry[];
  rateHistory: RateHistoryEntry[];
  expat: OrgReviewData | null;
  children: OrgReviewData[];
}

type RateMap = Record<TargetKey, string>;

interface PersonHistoryRow {
  name: string;
  period: string;
  headcount: number | null;
  rates: Record<TargetKey, number>;
  total: number;
  note: string | null;
  role: PersonRole;
}

interface PersonEditRow {
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

function NoteTip({ text }: { text: string }) {
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

function emptyRates(): RateMap {
  const r = {} as RateMap;
  TARGETS.forEach((t) => (r[t.key] = "0"));
  return r;
}

function toRateMap(rec: Record<TargetKey, number> | null): RateMap {
  const r = emptyRates();
  if (!rec) return r;
  TARGETS.forEach((t) => (r[t.key] = String(rec[t.key] ?? 0)));
  return r;
}

function totalOf(rates: RateMap): number {
  const parsed = {} as Record<TargetKey, number>;
  TARGETS.forEach((t) => (parsed[t.key] = Number(rates[t.key]) || 0));
  return sumTargets(parsed);
}

// 엑셀에서 여러 셀을 복사해 붙여넣었을 때 탭(열)/줄바꿈(행) 기준으로 표로 분리한다.
// %, 콤마, 공백은 제거해 "30%"·"1,234" 같은 엑셀 표시 형식도 그대로 받아들인다.
function parsePasteGrid(text: string): string[][] {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => line.split("\t").map((cell) => cell.trim().replace(/%$/, "").replace(/,/g, "")));
}

function isMultiCellPaste(text: string): boolean {
  return text.includes("\t") || text.includes("\n");
}

function totalIsValid(rates: RateMap): boolean {
  const total = totalOf(rates);
  return total === 0 || Math.abs(total - 1) < 0.005;
}

// 과거 이력 분기 + 현재 입력/조회 중인 분기를 합쳐 항상 연도->분기 순으로 정렬한다.
// 현재 분기가 과거 데이터보다 이전 분기일 수도 있으므로(예: 2Q까지 입력된 상태에서 1Q를 다시 열람),
// 단순히 표 맨 아래에 이어붙이면 순서가 뒤집혀 보인다.
function orderedQuarters(pastQuarters: string[], current: string): string[] {
  return sortQuarters(Array.from(new Set([...pastQuarters, current])));
}

// 확정 API로 보낼 개인별 페이로드: 이름이 있는 행만, DB의 sub_team 컬럼 형태(주재원/null)로 변환.
function toPersonPayload(list: PersonEditRow[]) {
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

function recTotal(rec: Record<TargetKey, number>): number {
  return TARGETS.reduce((sum, t) => sum + (rec[t.key] || 0), 0);
}

function toNumRec(rates: RateMap): Record<TargetKey, number> {
  const r = {} as Record<TargetKey, number>;
  TARGETS.forEach((t) => (r[t.key] = Number(rates[t.key]) || 0));
  return r;
}

/**
 * 개인별 표에서 '한 명'으로 세는 행 = 이름이 있고 배부율이 0%가 아닌 행.
 * 개인별 입력은 한 행이 곧 한 명이라 인원수를 따로 받지 않으므로, 인원수는 이 행 수로 센다.
 */
function countedPersons(persons: PersonEditRow[]): PersonEditRow[] {
  return persons.filter((p) => p.name.trim() && totalOf(p.rates) > 0);
}

// 개인별 입력은 한 행이 한 명이므로 모두 같은 가중치(1명)로 단순 평균한다.
function averageFromPersons(persons: PersonEditRow[]): RateMap {
  const counted = countedPersons(persons);
  const r = emptyRates();
  if (counted.length === 0) return r;
  TARGETS.forEach((t) => {
    const sum = counted.reduce((acc, p) => acc + (Number(p.rates[t.key]) || 0), 0);
    r[t.key] = String(sum / counted.length);
  });
  return r;
}

/**
 * 조직 가중치 = 그 조직에 실제로 입력된 인원수.
 * 개인별로 입력한 조직은 값이 채워진 개인 행 수(한 행 = 한 명), 조직 단위로 입력한 조직은 조직 인원수 값을 쓴다.
 * (예전에는 인원수가 없으면 1로 세서 'HW팀 6명 : SW팀 2명'이 1:1로 잡혔다 — 팀 수가 아니라
 *  실제 인원 비율로 가중해야 한다.)
 */
function orgWeight(c: OrgReviewData): number {
  const fromPersons = c.currentPersons.filter((p) => recTotal(p.rates) > 0).length;
  if (fromPersons > 0) return fromPersons;
  return Number(c.submittedHeadcount) || 0;
}

function sumOrgWeights(items: OrgReviewData[]): number {
  return items.reduce((s, c) => s + orgWeight(c), 0);
}

// 표시용 인원수(인원수가 입력된 조직만 숫자를 보여주고, 없으면 "-").
function orgHeadcountDisplay(c: OrgReviewData): number | null {
  const w = orgWeight(c);
  return w > 0 ? w : null;
}

// 개인별 이력(personHistory)에서 특정 분기의 인원수 (legalOnly=true면 법인분, false면 주재원분).
// 한 행이 한 명이므로 값이 채워진 행 수를 센다.
function personHeadcountForQuarter(history: PersonHistoryEntry[], quarter: string, legalOnly: boolean): number | null {
  const rows = history.filter(
    (h) => h.period === quarter && h.total > 0 && (legalOnly ? h.role !== "주재원" : h.role === "주재원")
  );
  return rows.length > 0 ? rows.length : null;
}

/**
 * 특정 분기의 조직 인원수 — 과거 분기 행 표시용.
 * 상위 집계 조직은 자기 인원수를 따로 갖지 않아 하위 조직 인원수를 합쳐야 하는데,
 * 과거 분기 행은 지금 화면의 입력값(현재 분기)이 아니라 그 분기 이력에서 세야 한다.
 */
function orgWeightForQuarter(c: OrgReviewData, quarter: string): number {
  const fromPersons = personHeadcountForQuarter(c.personHistory, quarter, true);
  if (fromPersons && fromPersons > 0) return fromPersons;
  return Number(c.rateHistory.find((h) => h.quarter === quarter)?.headcount) || 0;
}

function sumOrgWeightsForQuarter(items: OrgReviewData[], quarter: string): number | null {
  const sum = items.reduce((s, c) => s + orgWeightForQuarter(c, quarter), 0);
  return sum > 0 ? sum : null;
}

// 상위 집계 조직(예: 경영지원실)의 값 = 하위 조직들(예: 재무팀, Staff(경영지원))의 인원수 가중평균.
function weightedAvgFromChildren(children: OrgReviewData[]): RateMap {
  const r = emptyRates();
  if (children.length === 0) return r;
  const weights = children.map(orgWeight);
  const totalW = weights.reduce((a, b) => a + b, 0);
  // 아무 조직도 인원수를 적지 않았으면 가중치를 못 쓰므로 균등 평균으로 물러난다.
  const useWeights = totalW > 0;
  const divisor = useWeights ? totalW : children.length;
  TARGETS.forEach((t) => {
    const weighted = children.reduce((sum, c, i) => {
      const rate = c.hasSubmission ? c.rollup[t.key] : c.currentRate ? c.currentRate[t.key] : 0;
      return sum + (Number(rate) || 0) * (useWeights ? weights[i] : 1);
    }, 0);
    r[t.key] = String(divisor > 0 ? weighted / divisor : 0);
  });
  return r;
}

const AFFILIATE_KEYS: TargetKey[] = ["h_mobility", "h_ev", "hiparking", "peoplecar", "winercom", "holdings", "h_networks"];

// HKR(관계사 제외) = 본사 조직들의 인원수 가중평균(weightedAvgFromChildren과 동일 로직) 이후,
// 계열사 배부분을 제외하고 나머지(Humax 내부) 컬럼만으로 재정규화한 값.
function computeHkr(honsaOrgs: OrgReviewData[]): RateMap {
  const avg = toNumRec(weightedAvgFromChildren(honsaOrgs));
  const humaxSum = TARGETS.reduce((sum, t) => (AFFILIATE_KEYS.includes(t.key) ? sum : sum + (avg[t.key] || 0)), 0);
  const r = emptyRates();
  TARGETS.forEach((t) => {
    if (AFFILIATE_KEYS.includes(t.key)) {
      r[t.key] = "0";
    } else {
      r[t.key] = String(humaxSum > 0 ? (avg[t.key] || 0) / humaxSum : 0);
    }
  });
  return r;
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
}: {
  label: string;
  rec: Record<TargetKey, number>;
  headcount?: number | null;
  showClearSlot?: boolean;
  withNote?: boolean;
  note?: string | null;
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
          {note && (
            <NoteTip text={note} />
          )}
        </td>
      )}
    </tr>
  );
}

function EditableRateRow({
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
                const text = e.clipboardData.getData("text");
                if (!isMultiCellPaste(text)) return;
                e.preventDefault();
                const row = parsePasteGrid(text)[0] ?? [];
                row.forEach((tok, offset) => {
                  const target = TARGETS[i + offset];
                  if (target && tok !== "") onChange(target.key, percentInputToFraction(tok));
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

function personRowFromCurrent(p: CurrentPerson, i: number): PersonEditRow {
  return {
    key: `${i}-${p.name}`,
    name: p.name,
    headcount: "1",
    note: p.note ?? "",
    role: p.role,
    rates: toRateMap(p.rates),
  };
}

// 개인별 추적을 안 하지만 주재원과 하나로 관리되는 조직(HBR/HDG/HUK 등)은
// '법인 전체'를 나타내는 행 하나로 시작해서 주재원 행을 추가할 수 있게 한다.
function initialPersons(item: OrgReviewData): PersonEditRow[] {
  if (item.currentPersons.length > 0) {
    return item.currentPersons.map(personRowFromCurrent);
  }
  if (item.expat && !item.org.requires_person_detail) {
    return [
      {
        key: "seed-org",
        name: item.submittedBy ?? "법인 전체",
        headcount: "1",
        note: "",
        role: "법인",
        rates: toRateMap(item.currentOrgSubmission ?? item.currentRate),
      },
    ];
  }
  return [];
}

// ---------- 상위 집계 조직 (경영지원실 등) : 하위 조직 인원수 가중평균, 읽기 전용 + 확정 스냅샷 ----------
function ParentOrgDetail({ item, period, version }: { item: OrgReviewData; period: string; version: string }) {
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(item.confirmedThisPeriod);
  const [error, setError] = useState("");
  const router = useRouter();

  const pastRateHistory = item.rateHistory.filter((h) => h.quarter !== period);
  const computed = weightedAvgFromChildren(item.children);
  const computedHeadcount = sumOrgWeights(item.children);
  const total = totalOf(computed);
  const totalOk = Math.abs(total - 1) < 0.005 || total === 0;

  async function handleConfirm() {
    setError("");
    if (!totalIsValid(computed)) {
      setError("하위 조직 값이 아직 충분히 입력되지 않아 합계가 100%가 아닙니다.");
      return;
    }
    setConfirming(true);
    try {
      const res = await fetch("/api/admin/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId: item.org.id, period, version, rates: computed }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "확정 처리 중 오류가 발생했습니다.");
      setConfirmed(true);
      // 서버 컴포넌트가 페이지 진입 시 한 번만 조회하므로, 새로고침하지 않으면 다른 조직으로 옮겼다 돌아왔을 때
      // 방금 저장한 내용이 미확정으로 보인다.
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="panel">
      <div style={{ marginBottom: 14 }}>
        <div className="panel-title">
          {item.org.basis}{" "}
          <span className="status-badge" style={{ background: "#eff6ff", color: "#2563eb" }}>
            집계 조직
          </span>{" "}
          {confirmed ? (
            <span className="status-badge status-confirmed">확정됨 ({period})</span>
          ) : (
            <span className="status-badge" style={{ background: "#f1f5f9", color: "#64748b" }}>
              미확정
            </span>
          )}
        </div>
        <div className="panel-sub">
          {item.org.division} · 하위 조직({item.children.map((c) => c.org.basis).join(" + ")})의 인원수 가중평균으로 자동 계산됩니다. 하위 조직에서 직접 입력해주세요.
        </div>
      </div>

      <div className="tbl-scroll" style={{ marginBottom: 12 }}>
        <table className="rate-tbl">
          <RateTableHead />
          <tbody>
            {orderedQuarters(pastRateHistory.map((h) => h.quarter), period).map((q) =>
              q === period ? (
                <ReadOnlyRateRow key={q} label={`${period} (자동계산)`} rec={toNumRec(computed)} headcount={computedHeadcount} />
              ) : (
                <ReadOnlyRateRow
                  key={q}
                  label={q}
                  rec={pastRateHistory.find((h) => h.quarter === q)!.rates}
                  headcount={sumOrgWeightsForQuarter(item.children, q)}
                />
              )
            )}
          </tbody>
        </table>
      </div>
      {!totalOk && (
        <div className="field-hint" style={{ color: "#dc2626", marginBottom: 12 }}>
          ⚠ {period} 합계가 100%가 아닙니다 — 하위 조직 입력을 확인해주세요.
        </div>
      )}

      <div className="field-hint" style={{ marginBottom: 12 }}>
        아래 하위 조직을 저장하면 이 값도 자동으로 다시 계산되어 반영됩니다.
      </div>

      <div className="panel-sub" style={{ fontWeight: 700, color: "#1a202c", margin: "20px 0 12px" }}>
        ■ 하위 조직 개별 입력 ({item.children.length}개)
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {leaderFirst(item.children).map((c) => (
          <OrgDetail key={`${c.org.id}-${period}`} item={c} period={period} version={version} />
        ))}
      </div>
    </div>
  );
}

// ---------- HKR(관계사 제외) : 본사 조직 전체의 인원수 가중평균 → 계열사 제외 재정규화, 읽기 전용 + 확정 스냅샷 ----------
function HkrAutoPanel({
  honsaOrgs,
  period,
  version,
  history,
  confirmedThisPeriod,
}: {
  honsaOrgs: OrgReviewData[];
  period: string;
  version: string;
  history: RateHistoryEntry[];
  confirmedThisPeriod: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(confirmedThisPeriod);
  const [error, setError] = useState("");
  const router = useRouter();

  const pastHistory = history.filter((h) => h.quarter !== period);
  const computed = computeHkr(honsaOrgs);
  const computedHeadcount = sumOrgWeights(honsaOrgs);
  const total = totalOf(computed);
  const totalOk = Math.abs(total - 1) < 0.005 || total === 0;

  async function handleConfirm() {
    setError("");
    if (!totalIsValid(computed)) {
      setError("본사 조직 값이 아직 충분히 입력되지 않아 합계가 100%가 아닙니다.");
      return;
    }
    setConfirming(true);
    try {
      const res = await fetch("/api/admin/confirm-basis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quarter: period,
          type: "리소스배부율",
          division: "본사",
          basis: "HKR(관계사제외)",
          version,
          rates: computed,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "확정 처리 중 오류가 발생했습니다.");
      setConfirmed(true);
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="panel">
      <div style={{ marginBottom: 14 }}>
        <div className="panel-title">
          HKR(관계사제외){" "}
          <span className="status-badge" style={{ background: "#eff6ff", color: "#2563eb" }}>
            자동계산
          </span>{" "}
          {confirmed ? (
            <span className="status-badge status-confirmed">확정됨 ({period})</span>
          ) : (
            <span className="status-badge" style={{ background: "#f1f5f9", color: "#64748b" }}>
              미확정
            </span>
          )}
        </div>
        <div className="panel-sub">
          본사 · 본사 조직 {honsaOrgs.length}개의 인원수 가중평균 배부율에서 계열사(H.Mobility~H.Networks) 배부분을 제외하고 나머지를 재정규화해 자동 계산됩니다.
          확정 시 운영 allocation_rate에 반영됩니다.
        </div>
      </div>

      <div className="tbl-scroll" style={{ marginBottom: 12 }}>
        <table className="rate-tbl">
          <RateTableHead />
          <tbody>
            {orderedQuarters(pastHistory.map((h) => h.quarter), period).map((q) =>
              q === period ? (
                <ReadOnlyRateRow key={q} label={`${period} (자동계산)`} rec={toNumRec(computed)} headcount={computedHeadcount} />
              ) : (
                <ReadOnlyRateRow
                  key={q}
                  label={q}
                  rec={pastHistory.find((h) => h.quarter === q)!.rates}
                  headcount={sumOrgWeightsForQuarter(honsaOrgs, q)}
                />
              )
            )}
          </tbody>
        </table>
      </div>
      {!totalOk && (
        <div className="field-hint" style={{ color: "#dc2626", marginBottom: 12 }}>
          ⚠ {period} 합계가 100%가 아닙니다 — 본사 조직 입력을 확인해주세요.
        </div>
      )}

      <div className="panel-sub" style={{ fontWeight: 700, color: "#1a202c", margin: "0 0 8px" }}>
        ■ 본사 조직 현황 (가중치 산정 대상)
      </div>
      <div className="tbl-scroll" style={{ marginBottom: 12 }}>
        <table className="rate-tbl">
          <RateTableHead />
          <tbody>
            {leaderFirst(honsaOrgs).map((c) => (
              <ReadOnlyRateRow
                key={c.org.id}
                label={`${c.org.basis}${c.hasSubmission ? "" : " (미제출)"}`}
                rec={c.hasSubmission ? c.rollup : c.currentRate ?? toNumRec(emptyRates())}
                headcount={orgHeadcountDisplay(c)}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="field-hint">본사 조직을 저장하면 이 값도 자동으로 다시 계산되어 반영됩니다.</div>
    </div>
  );
}

function OrgDetail({
  item,
  period,
  version,
}: {
  item: OrgReviewData;
  period: string;
  version: string;
}) {
  const [orgUnlocked, setOrgUnlocked] = useState(false);
  const [personsUnlocked, setPersonsUnlocked] = useState(false);
  const [orgRates, setOrgRates] = useState<RateMap>(() => toRateMap(item.currentOrgSubmission ?? item.currentRate));
  // 인원수를 비워두고 저장하면 0명으로 남긴다 (빈칸으로 두지 않는다).
  const [orgHeadcountInput, setOrgHeadcountInput] = useState(() => String(item.submittedHeadcount ?? 0));
  const [orgNoteInput, setOrgNoteInput] = useState(() => item.submittedNote ?? "");
  const [persons, setPersons] = useState<PersonEditRow[]>(() => initialPersons(item));
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(item.confirmedThisPeriod && (!item.expat || item.expat.confirmedThisPeriod));
  const [error, setError] = useState("");
  const router = useRouter();

  const hasExpat = !!item.expat;
  const usesPersonTable = item.org.requires_person_detail || hasExpat;
  const pastRateHistory = item.rateHistory.filter((h) => h.quarter !== period);
  const pastPersonHistory = item.personHistory.filter((h) => h.period !== period);
  const pastExpatHistory = hasExpat ? item.expat!.rateHistory.filter((h) => h.quarter !== period) : [];
  const prevPeriod = getPreviousPeriod(period);
  const previousPersonsForOrg = prevPeriod ? item.personHistory.filter((h) => h.period === prevPeriod) : [];
  const previousOrgRate = prevPeriod ? pastRateHistory.find((h) => h.quarter === prevPeriod) ?? null : null;

  // 개인별 과거 이력(법인+주재원)을 하나로 합쳐, 현재 조회 중인 분기를 기준으로
  // 시간상 이전/이후로 나눈다 — 항상 연도->분기 순으로 표시하기 위해
  // "과거 이력 표" 다음에 "현재 분기"를 무조건 붙이지 않고, 현재 분기보다 나중 분기가
  // 이미 있으면 그 이후 이력은 현재 분기 아래에 별도로 보여준다.
  const personCombinedHistory: PersonHistoryRow[] = [
    ...pastPersonHistory,
    ...pastExpatHistory.map((h) => ({
      name: `(${item.expat!.org.basis})`,
      period: h.quarter,
      headcount: 1,
      rates: h.rates,
      total: h.total,
      note: null as string | null,
      role: "주재원" as PersonRole,
    })),
  ];
  const personQuarterOrder = orderedQuarters(personCombinedHistory.map((h) => h.period), period);
  const currentQuarterIdx = personQuarterOrder.indexOf(period);
  const beforeQuarterSet = new Set(personQuarterOrder.slice(0, currentQuarterIdx));
  const afterQuarterSet = new Set(personQuarterOrder.slice(currentQuarterIdx + 1));
  const personRowSort = (a: PersonHistoryRow, b: PersonHistoryRow) =>
    personQuarterOrder.indexOf(a.period) - personQuarterOrder.indexOf(b.period) || a.name.localeCompare(b.name);
  const beforePersonRows = personCombinedHistory.filter((r) => beforeQuarterSet.has(r.period)).sort(personRowSort);
  const afterPersonRows = personCombinedHistory.filter((r) => afterQuarterSet.has(r.period)).sort(personRowSort);

  // 분기별로 하나씩 "{분기} (확정됨)" 헤더 + 표를 렌더링한다.
  // (예전에는 여러 분기를 표 하나에 몰아넣고 분기 라벨을 표 안의 행으로 넣었는데,
  // 현재 분기 섹션만 표 위에 별도 텍스트가 있어서 스타일이 서로 달라 보였다.)
  function renderPersonHistoryBlocks(rows: PersonHistoryRow[]) {
    const byQuarter = new Map<string, PersonHistoryRow[]>();
    rows.forEach((p) => {
      const list = byQuarter.get(p.period) ?? [];
      list.push(p);
      byQuarter.set(p.period, list);
    });
    const quarters = personQuarterOrder.filter((q) => byQuarter.has(q));
    return quarters.map((q) => {
      const qRows = byQuarter.get(q)!;
      return (
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
                {qRows.map((p) => (
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
      );
    });
  }

  function loadPreviousPersons() {
    setPersons(
      previousPersonsForOrg.map((p, i) => ({
        key: `prev-${i}-${Date.now()}`,
        name: p.name,
        headcount: p.headcount != null ? String(p.headcount) : "0",
        note: p.note ?? "",
        role: p.role,
        rates: toRateMap(p.rates),
      }))
    );
  }

  function loadPreviousOrgRate() {
    if (!previousOrgRate) return;
    setOrgRates(toRateMap(previousOrgRate.rates));
    setOrgHeadcountInput(previousOrgRate.headcount != null ? String(previousOrgRate.headcount) : "");
    setOrgNoteInput(previousOrgRate.note ?? "");
  }

  const orgEditable = usesPersonTable ? false : confirmed ? orgUnlocked : true;
  const personsEditable = usesPersonTable ? (confirmed ? personsUnlocked : true) : false;

  const legalPersons = persons.filter((p) => p.role !== "주재원");
  const expatPersons = persons.filter((p) => p.role === "주재원");
  const computedOrgRates = usesPersonTable ? averageFromPersons(legalPersons) : orgRates;
  const computedExpatRates = hasExpat ? averageFromPersons(expatPersons) : null;
  const displayOrgRates = computedOrgRates;

  // 개인별 입력은 한 행 = 한 명이므로, 이름이 있고 배부율이 0%가 아닌 행 수가 곧 인원수다.
  function namedHeadcountSum(list: PersonEditRow[]): number | null {
    const counted = countedPersons(list);
    return counted.length === 0 ? null : counted.length;
  }
  const currentOrgHeadcount = usesPersonTable ? namedHeadcountSum(legalPersons) : Number(orgHeadcountInput) || 0;
  const currentExpatHeadcount = hasExpat ? namedHeadcountSum(expatPersons) : null;

  function updateOrgRate(key: TargetKey, value: string) {
    setOrgRates((r) => ({ ...r, [key]: value }));
  }
  function updatePersonRate(key: string, target: TargetKey, value: string) {
    setPersons((list) => list.map((p) => (p.key === key ? { ...p, rates: { ...p.rates, [target]: value } } : p)));
  }
  function updatePerson(key: string, patch: Partial<PersonEditRow>) {
    setPersons((list) => list.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  }
  function addPerson() {
    setPersons((list) => [...list, { key: `${Date.now()}`, name: "", headcount: "1", note: "", role: "법인", rates: emptyRates() }]);
  }
  function removePerson(key: string) {
    setPersons((list) => list.filter((p) => p.key !== key));
  }
  // 개인별 표 붙여넣기: 열 순서를 [이름, ...13개 배부대상]으로 보고, 시작 셀부터 채운다.
  // (인원수 열은 화면에 없다 — 한 행이 곧 한 명이다.)
  // 여러 행(사람)에 걸쳐 붙여넣으면 아래 행이 부족한 경우 자동으로 행을 추가한다.
  function applyPasteToken(person: PersonEditRow, colIdx: number, token: string): PersonEditRow {
    if (colIdx === 0) return { ...person, name: token };
    const target = TARGETS[colIdx - 1];
    if (!target) return person;
    return { ...person, rates: { ...person.rates, [target.key]: percentInputToFraction(token) } };
  }
  function handlePersonCellPaste(personIdx: number, startColIdx: number, text: string) {
    const grid = parsePasteGrid(text);
    setPersons((list) => {
      const next = [...list];
      grid.forEach((rowTokens, ri) => {
        const idx = personIdx + ri;
        while (next.length <= idx) {
          next.push({ key: `paste-${Date.now()}-${next.length}`, name: "", headcount: "1", note: "", role: "법인", rates: emptyRates() });
        }
        let person = next[idx];
        rowTokens.forEach((tok, ci) => {
          if (tok === "") return;
          person = applyPasteToken(person, startColIdx + ci, tok);
        });
        next[idx] = person;
      });
      return next;
    });
  }

  async function handleConfirm() {
    setError("");
    if (usesPersonTable) {
      const invalid = persons.find((p) => p.name.trim() && !totalIsValid(p.rates));
      if (invalid) {
        setError(`'${invalid.name}'님의 비율 합계가 100%가 아닙니다.`);
        return;
      }
    } else if (!totalIsValid(orgRates)) {
      setError("조직 단위 배부율 합계가 100%가 아닙니다.");
      return;
    }
    setConfirming(true);
    try {
      const res = await fetch("/api/admin/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId: item.org.id,
          period,
          version,
          rates: computedOrgRates,
          persons: usesPersonTable ? toPersonPayload(legalPersons) : undefined,
          orgHeadcount: usesPersonTable ? undefined : Number(orgHeadcountInput) || 0,
          orgNote: usesPersonTable ? undefined : orgNoteInput || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "확정 처리 중 오류가 발생했습니다.");

      // 주재원 행을 전부 지운 경우에도(합계 0) 예전 주재원 조직 데이터를 지워야 하므로,
      // 값이 0이라도 '전에 주재원 데이터가 있었다면' 호출한다.
      const expatHadData = (item.expat?.currentPersons.length ?? 0) > 0 || (item.expat?.hasSubmission ?? false);
      if (hasExpat && computedExpatRates && (totalOf(computedExpatRates) > 0 || expatHadData)) {
        const res2 = await fetch("/api/admin/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orgId: item.expat!.org.id,
            period,
            version,
            rates: computedExpatRates,
            persons: toPersonPayload(expatPersons),
          }),
        });
        const json2 = await res2.json();
        if (!res2.ok) throw new Error(json2.error || "주재원 확정 처리 중 오류가 발생했습니다.");
      }

      // 값이 없는 저장(행을 전부 지웠거나 배부율이 0%)은 확정으로 보지 않는다 — 화면 배지도 그대로 둔다.
      setConfirmed(totalOf(computedOrgRates) > 0);
      setOrgUnlocked(false);
      setPersonsUnlocked(false);
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setConfirming(false);
    }
  }

  const total = totalOf(computedOrgRates);
  const totalOk = Math.abs(total - 1) < 0.005 || total === 0;
  const expatTotal = computedExpatRates ? totalOf(computedExpatRates) : 0;
  const expatTotalOk = !computedExpatRates || expatTotal === 0 || Math.abs(expatTotal - 1) < 0.005;

  const actionButton = (
    <div style={{ marginTop: 14 }}>
      {confirmed && !(usesPersonTable ? personsUnlocked : orgUnlocked) ? (
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => (usesPersonTable ? setPersonsUnlocked(true) : setOrgUnlocked(true))}
        >
          재수정
        </button>
      ) : (
        <button className="btn btn-primary btn-sm" disabled={confirming} onClick={handleConfirm}>
          {confirming ? "저장 중..." : "저장 (allocation_rate 반영)"}
        </button>
      )}
    </div>
  );

  return (
    <div className="panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
        <div>
          <div className="panel-title">
            {item.org.basis}
            {hasExpat && <span className="status-badge" style={{ background: "#fef3c7", color: "#92400e", marginLeft: 6 }}>법인+주재원</span>}{" "}
            {confirmed ? (
              <span className="status-badge status-confirmed">확정됨 ({period})</span>
            ) : (
              <span className="status-badge" style={{ background: "#f1f5f9", color: "#64748b" }}>
                미확정
              </span>
            )}
          </div>
          <div className="panel-sub">
            {item.org.division} · {usesPersonTable ? "개인별 확인 필요" : "조직 단위"}
            {item.submittedBy ? ` · 제출자: ${item.submittedBy}` : ""}
            {item.latestSubmittedAt ? ` · ${new Date(item.latestSubmittedAt).toLocaleString("ko-KR")}` : ""}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
        <div className="panel-sub" style={{ fontWeight: 700, color: "#1a202c", margin: 0 }}>
          ■ 조직별 리소스 배부율{hasExpat ? " (법인분)" : ""}
        </div>
        {!usesPersonTable && orgEditable && previousOrgRate && (
          <button className="btn btn-secondary btn-sm" onClick={loadPreviousOrgRate}>
            전분기 데이터 끌고오기
          </button>
        )}
      </div>
      <div className="tbl-scroll" style={{ marginBottom: 12 }}>
        <table className="rate-tbl">
          <RateTableHead withClear={orgEditable} withNote={!usesPersonTable} />
          <tbody>
            {orderedQuarters(pastRateHistory.map((h) => h.quarter), period).map((q) => {
              if (q !== period) {
                const h = pastRateHistory.find((x) => x.quarter === q)!;
                return (
                  <ReadOnlyRateRow
                    key={q}
                    label={h.quarter}
                    rec={h.rates}
                    headcount={usesPersonTable ? personHeadcountForQuarter(item.personHistory, h.quarter, true) : h.headcount}
                    showClearSlot={orgEditable}
                    withNote={!usesPersonTable}
                    note={h.note}
                  />
                );
              }
              return orgEditable ? (
                <EditableRateRow
                  key={q}
                  label={`${period} (입력중)`}
                  rates={usesPersonTable ? computedOrgRates : orgRates}
                  onChange={updateOrgRate}
                  headcount={currentOrgHeadcount}
                  onClear={() => setOrgRates(emptyRates())}
                  headcountEditable={!usesPersonTable}
                  headcountValue={orgHeadcountInput}
                  onHeadcountChange={setOrgHeadcountInput}
                  withNote={!usesPersonTable}
                  noteValue={orgNoteInput}
                  onNoteChange={setOrgNoteInput}
                />
              ) : (
                <ReadOnlyRateRow
                  key={q}
                  label={`${period}${usesPersonTable ? " (자동계산)" : ""}`}
                  rec={toNumRec(displayOrgRates)}
                  headcount={currentOrgHeadcount}
                  withNote={!usesPersonTable}
                  note={orgNoteInput || null}
                />
              );
            })}
          </tbody>
        </table>
      </div>
      {!totalOk && (
        <div className="field-hint" style={{ color: "#dc2626", marginBottom: 12 }}>
          ⚠ {period} 합계가 100%가 아닙니다.
        </div>
      )}

      {hasExpat && (
        <>
          <div className="panel-sub" style={{ fontWeight: 700, color: "#1a202c", margin: "0 0 8px" }}>
            ■ 주재원분 ({item.expat!.org.basis})
          </div>
          <div className="tbl-scroll" style={{ marginBottom: 12 }}>
            <table className="rate-tbl">
              <RateTableHead />
              <tbody>
                {orderedQuarters(pastExpatHistory.map((h) => h.quarter), period).map((q) =>
                  q === period ? (
                    <ReadOnlyRateRow
                      key={q}
                      label={`${period} (자동계산)`}
                      rec={toNumRec(computedExpatRates ?? emptyRates())}
                      headcount={currentExpatHeadcount}
                    />
                  ) : (
                    <ReadOnlyRateRow
                      key={q}
                      label={q}
                      rec={pastExpatHistory.find((h) => h.quarter === q)!.rates}
                      headcount={personHeadcountForQuarter(item.personHistory, q, false)}
                    />
                  )
                )}
              </tbody>
            </table>
          </div>
          {!expatTotalOk && (
            <div className="field-hint" style={{ color: "#dc2626", marginBottom: 12 }}>
              ⚠ 주재원 {period} 합계가 100%가 아닙니다 — 아래 표에서 '주재원' 구분 행을 확인해주세요.
            </div>
          )}
        </>
      )}

      {usesPersonTable && (
        <>
          <div className="panel-sub" style={{ fontWeight: 700, color: "#1a202c", margin: "0 0 8px" }}>
            ■ 개인별 리소스 배부율{hasExpat ? " (법인/주재원 함께)" : ""}
          </div>

          {renderPersonHistoryBlocks(beforePersonRows)}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
            <div className="field-hint" style={{ fontWeight: 700, color: personsEditable ? "#2563eb" : "#1a202c", margin: 0 }}>
              {period} {personsEditable ? "(입력중)" : "(확정됨)"}
            </div>
            {personsEditable && previousPersonsForOrg.length > 0 && (
              <button className="btn btn-secondary btn-sm" onClick={loadPreviousPersons}>
                전분기 데이터 끌고오기 ({previousPersonsForOrg.length}명)
              </button>
            )}
          </div>
          {personsEditable ? (
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
                                const text = e.clipboardData.getData("text");
                                if (!isMultiCellPaste(text)) return;
                                e.preventDefault();
                                handlePersonCellPaste(pIdx, 0, text);
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
                                    const text = e.clipboardData.getData("text");
                                    if (!isMultiCellPaste(text)) return;
                                    e.preventDefault();
                                    handlePersonCellPaste(pIdx, 1 + tIdx, text);
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
          ) : (
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
          )}
          {error && <div className="callout alert" style={{ marginTop: 12, marginBottom: 12 }}>{error}</div>}
          {actionButton}
          {renderPersonHistoryBlocks(afterPersonRows)}
        </>
      )}

      {!usesPersonTable && (
        <>
          {error && <div className="callout alert" style={{ marginTop: 12, marginBottom: 12 }}>{error}</div>}
          {actionButton}
        </>
      )}
    </div>
  );
}

const HKR_ID = -1;

// 배부율조사 로직 정의(엑셀 '1차. 조직 표기' 열) 순서 그대로 — 법인(1~12) · 주재원(13~16) · 본사(17~29).
const ORG_ORDER = [
  "HUS", "HMX", "HUK", "HDG", "HUG", "HTR", "HBR", "HJP", "HTH", "HAU", "HID", "HSZ",
  "HBR_주재원", "HDG_주재원", "HSZ_주재원", "HUK_주재원",
  "Staff(휴맥스이브이)", "국내영업팀", "Platform개발팀", "사업협력팀", "사업 그룹", "개발 그룹", "SCM실", "Media그룹", "CEO", "지식재산팀", "Staff(CEO)", "경영지원실", "HR실",
];
function orgOrderIndex(basis: string): number {
  const i = ORG_ORDER.indexOf(basis);
  return i === -1 ? ORG_ORDER.length : i;
}

// 조직장(그룹장·실장)은 목록에서 항상 맨 위에 보여준다. 표기에 띄어쓰기가 섞여 있어 공백은 무시하고 비교한다.
const LEADER_FIRST = ["개발그룹장", "사업그룹장", "경영지원실장"];
function isLeaderOrg(basis: string): boolean {
  return LEADER_FIRST.includes(String(basis).replace(/\s/g, ""));
}
/** 조직장을 맨 위로 올리되, 나머지는 원래 순서를 유지한다. */
function leaderFirst<T extends { org: { basis: string } }>(items: T[]): T[] {
  return [...items].sort((a, b) => Number(isLeaderOrg(b.org.basis)) - Number(isLeaderOrg(a.org.basis)));
}

export default function ConfirmReview({
  period,
  version,
  data,
  hkrHistory,
  hkrConfirmedThisPeriod,
}: {
  period: string;
  version: string;
  data: OrgReviewData[];
  hkrHistory: RateHistoryEntry[];
  hkrConfirmedThisPeriod: boolean;
}) {
  // parent_basis가 있는 조직(예: HW팀, 재무팀)은 상위 조직(개발 그룹, 경영지원실)을 선택했을 때만
  // 그 안에서 개별 입력/확정하도록 하고, 상단 선택 카테고리에는 상위 조직만 노출한다.
  // 법인/주재원은 엑셀 '1차. 조직 표기'에서 별도 행으로 독립된 조직이므로 구분(division) 그대로 유지하고
  // 순서도 그 표의 No. 순서(ORG_ORDER)를 그대로 따른다.
  const topLevel = data
    // 사업총괄대표처럼 값이 자동으로 채워지는 조직은 검토·확정 화면에서 감춘다 (View에서는 그대로 보인다).
    .filter((item) => !item.org.parent_basis && !HIDDEN_IN_CONFIRM.includes(item.org.basis))
    .sort(
      (a, b) =>
        Number(isLeaderOrg(b.org.basis)) - Number(isLeaderOrg(a.org.basis)) ||
        orgOrderIndex(a.org.basis) - orgOrderIndex(b.org.basis)
    );
  const [selectedId, setSelectedId] = useState<number | null>(topLevel[0]?.org.id ?? null);

  const grouped = topLevel.reduce<Record<string, OrgReviewData[]>>((acc, item) => {
    (acc[item.org.division] ??= []).push(item);
    return acc;
  }, {});
  const honsaOrgs = topLevel.filter((item) => item.org.division === "본사");

  const selected = data.find((d) => d.org.id === selectedId) ?? null;

  return (
    <>
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-title">조직/팀 선택 ({period})</div>
        <div className="panel-sub" style={{ marginBottom: 10 }}>
          조직을 선택하면 아래에서 분기별 이력과 이번 라운드 값을 검토·확정할 수 있습니다. 파란 배지가 붙은 조직은 하위 조직 값을 자동 집계하는 조직입니다.
        </div>
        {Object.entries(grouped).map(([division, items]) => (
          <div key={division} style={{ marginBottom: 10 }}>
            <span className="field-hint" style={{ marginRight: 8 }}>
              {division}
            </span>
            {items.map((item) => (
              <button
                key={item.org.id}
                type="button"
                className={`av-chip ${selectedId === item.org.id ? "active" : ""}`}
                style={{ marginRight: 6, marginBottom: 6 }}
                onClick={() => setSelectedId(item.org.id)}
              >
                {item.org.basis}
                {item.children.length > 0 ? " 📊" : ""}
                {item.expat ? " 🌐" : ""}
                {item.confirmedThisPeriod ? " ✓" : ""}
              </button>
            ))}
            {division === "본사" && (
              <button
                type="button"
                className={`av-chip ${selectedId === HKR_ID ? "active" : ""}`}
                style={{ marginRight: 6, marginBottom: 6 }}
                onClick={() => setSelectedId(HKR_ID)}
              >
                HKR(관계사제외) 🧮{hkrConfirmedThisPeriod ? " ✓" : ""}
              </button>
            )}
          </div>
        ))}
      </div>

      {selectedId === HKR_ID && (
        <HkrAutoPanel
          key={period}
          honsaOrgs={honsaOrgs}
          period={period}
          version={version}
          history={hkrHistory}
          confirmedThisPeriod={hkrConfirmedThisPeriod}
        />
      )}
      {selected && selected.children.length > 0 && (
        <ParentOrgDetail key={`${selected.org.id}-${period}`} item={selected} period={period} version={version} />
      )}
      {selected && selected.children.length === 0 && (
        <OrgDetail key={`${selected.org.id}-${period}`} item={selected} period={period} version={version} />
      )}
    </>
  );
}
