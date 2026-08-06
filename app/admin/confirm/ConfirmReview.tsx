"use client";

import { Fragment, useState } from "react";
import {
  TARGETS,
  TargetKey,
  sumTargets,
  fractionToPercentInput,
  percentInputToFraction,
  getPreviousPeriod,
} from "@/lib/targets";
import { sortQuarters } from "@/lib/quarter";

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
      headcount: Number(p.headcount) || 1,
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

function averageFromPersons(persons: PersonEditRow[]): RateMap {
  const named = persons.filter((p) => p.name.trim());
  const r = emptyRates();
  if (named.length === 0) return r;
  const totalHc = named.reduce((sum, p) => sum + (Number(p.headcount) || 1), 0) || named.length;
  TARGETS.forEach((t) => {
    const weighted = named.reduce((sum, p) => {
      const hc = Number(p.headcount) || 1;
      return sum + (Number(p.rates[t.key]) || 0) * hc;
    }, 0);
    r[t.key] = String(totalHc > 0 ? weighted / totalHc : 0);
  });
  return r;
}

// 가중평균에 쓰는 조직 가중치(실제 인원수, 없으면 1로 간주).
function orgWeight(c: OrgReviewData): number {
  const hc = c.currentPersons.reduce((s, p) => s + (Number(p.headcount) || 1), 0);
  return hc > 0 ? hc : 1;
}

function sumOrgWeights(items: OrgReviewData[]): number {
  return items.reduce((s, c) => s + orgWeight(c), 0);
}

// 표시용 인원수(실제로 인원수가 조사된 조직만 숫자를 보여주고, 없으면 "-").
function orgHeadcountDisplay(c: OrgReviewData): number | null {
  if (c.currentPersons.length === 0) return null;
  return c.currentPersons.reduce((s, p) => s + (Number(p.headcount) || 1), 0);
}

// 개인별 이력(personHistory)에서 특정 분기의 인원수 합계 (legalOnly=true면 법인분, false면 주재원분).
function personHeadcountForQuarter(history: PersonHistoryEntry[], quarter: string, legalOnly: boolean): number | null {
  const rows = history.filter((h) => h.period === quarter && (legalOnly ? h.role !== "주재원" : h.role === "주재원"));
  if (rows.length === 0) return null;
  return rows.reduce((s, h) => s + (h.headcount ?? 1), 0);
}

// 상위 집계 조직(예: 경영지원실)의 값 = 하위 조직들(예: 재무팀, Staff(경영지원))의 인원수 가중평균.
function weightedAvgFromChildren(children: OrgReviewData[]): RateMap {
  const r = emptyRates();
  if (children.length === 0) return r;
  const weights = children.map(orgWeight);
  const totalW = weights.reduce((a, b) => a + b, 0) || children.length;
  TARGETS.forEach((t) => {
    const weighted = children.reduce((sum, c, i) => {
      const rate = c.hasSubmission ? c.rollup[t.key] : c.currentRate ? c.currentRate[t.key] : 0;
      return sum + (Number(rate) || 0) * weights[i];
    }, 0);
    r[t.key] = String(totalW > 0 ? weighted / totalW : 0);
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
            <button className="av-note-btn" type="button">
              i<span className="tip">{note}</span>
            </button>
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
            style={{ width: 120 }}
          />
        </td>
      )}
    </tr>
  );
}

const PERSON_COLS = TARGETS.length + 5; // 이름/인원수/구분/TOTAL/코멘트

function personRowFromCurrent(p: CurrentPerson, i: number): PersonEditRow {
  return {
    key: `${i}-${p.name}`,
    name: p.name,
    headcount: p.headcount != null ? String(p.headcount) : "1",
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
                <ReadOnlyRateRow key={q} label={q} rec={pastRateHistory.find((h) => h.quarter === q)!.rates} />
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

      {error && <div className="callout alert" style={{ marginBottom: 12 }}>{error}</div>}
      <button className="btn btn-primary btn-sm" disabled={confirming} onClick={handleConfirm}>
        {confirming ? "저장 중..." : "저장 (allocation_rate 반영)"}
      </button>

      <div className="panel-sub" style={{ fontWeight: 700, color: "#1a202c", margin: "20px 0 12px" }}>
        ■ 하위 조직 개별 입력 ({item.children.length}개)
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {item.children.map((c) => (
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
                <ReadOnlyRateRow key={q} label={q} rec={pastHistory.find((h) => h.quarter === q)!.rates} />
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
            {honsaOrgs.map((c) => (
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

      {error && <div className="callout alert" style={{ marginBottom: 12 }}>{error}</div>}
      <button className="btn btn-primary btn-sm" disabled={confirming} onClick={handleConfirm}>
        {confirming ? "저장 중..." : "저장 (allocation_rate 반영)"}
      </button>
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
  const [orgHeadcountInput, setOrgHeadcountInput] = useState(() => (item.submittedHeadcount != null ? String(item.submittedHeadcount) : ""));
  const [orgNoteInput, setOrgNoteInput] = useState(() => item.submittedNote ?? "");
  const [persons, setPersons] = useState<PersonEditRow[]>(() => initialPersons(item));
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(item.confirmedThisPeriod && (!item.expat || item.expat.confirmedThisPeriod));
  const [error, setError] = useState("");

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
                  <th style={{ textAlign: "left" }}>이름</th>
                  <th>인원수</th>
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
                    <td style={{ textAlign: "left" }}>{p.name}</td>
                    <td>{p.headcount ?? "-"}</td>
                    {hasExpat && <td>{p.role}</td>}
                    {TARGETS.map((t) => (
                      <td key={t.key}>{((p.rates[t.key] || 0) * 100).toFixed(1)}%</td>
                    ))}
                    <td className="total-col">{(p.total * 100).toFixed(1)}%</td>
                    <td>
                      {p.note && (
                        <button className="av-note-btn" type="button">
                          i<span className="tip">{p.note}</span>
                        </button>
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
        headcount: p.headcount != null ? String(p.headcount) : "1",
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

  function namedHeadcountSum(list: PersonEditRow[]): number | null {
    const named = list.filter((p) => p.name.trim());
    if (named.length === 0) return null;
    return named.reduce((s, p) => s + (Number(p.headcount) || 1), 0);
  }
  const currentOrgHeadcount = usesPersonTable
    ? namedHeadcountSum(legalPersons)
    : orgHeadcountInput.trim() !== ""
    ? Number(orgHeadcountInput)
    : null;
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
  // 개인별 표 붙여넣기: 열 순서를 [이름, 인원수, ...13개 배부대상]으로 보고, 시작 셀부터 채운다.
  // 여러 행(사람)에 걸쳐 붙여넣으면 아래 행이 부족한 경우 자동으로 행을 추가한다.
  function applyPasteToken(person: PersonEditRow, colIdx: number, token: string): PersonEditRow {
    if (colIdx === 0) return { ...person, name: token };
    if (colIdx === 1) return { ...person, headcount: token || "1" };
    const target = TARGETS[colIdx - 2];
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
          orgHeadcount: usesPersonTable ? undefined : orgHeadcountInput.trim() ? Number(orgHeadcountInput) : null,
          orgNote: usesPersonTable ? undefined : orgNoteInput || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "확정 처리 중 오류가 발생했습니다.");

      if (hasExpat && computedExpatRates && totalOf(computedExpatRates) > 0) {
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

      setConfirmed(true);
      setOrgUnlocked(false);
      setPersonsUnlocked(false);
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
                      <th style={{ textAlign: "left" }}>이름</th>
                      <th>인원수</th>
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
                          <td style={{ textAlign: "left" }}>
                            <input
                              value={p.name}
                              onChange={(e) => updatePerson(p.key, { name: e.target.value })}
                              placeholder="이름"
                              style={{ width: 100 }}
                              onPaste={(e) => {
                                const text = e.clipboardData.getData("text");
                                if (!isMultiCellPaste(text)) return;
                                e.preventDefault();
                                handlePersonCellPaste(pIdx, 0, text);
                              }}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              min="0"
                              value={p.headcount}
                              onChange={(e) => updatePerson(p.key, { headcount: e.target.value })}
                              style={{ width: 44 }}
                              onPaste={(e) => {
                                const text = e.clipboardData.getData("text");
                                if (!isMultiCellPaste(text)) return;
                                e.preventDefault();
                                handlePersonCellPaste(pIdx, 1, text);
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
                                    handlePersonCellPaste(pIdx, 2 + tIdx, text);
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
                              style={{ width: 120 }}
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
                    <th style={{ textAlign: "left" }}>이름</th>
                    <th>인원수</th>
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
                      <td style={{ textAlign: "left" }}>{p.name}</td>
                      <td>{p.headcount ?? "-"}</td>
                      {hasExpat && <td>{p.role}</td>}
                      {TARGETS.map((t) => (
                        <td key={t.key}>{(Number(p.rates[t.key] || 0) * 100).toFixed(1)}%</td>
                      ))}
                      <td className="total-col">{(totalOf(p.rates) * 100).toFixed(1)}%</td>
                      <td>
                        {p.note && (
                          <button className="av-note-btn" type="button">
                            i<span className="tip">{p.note}</span>
                          </button>
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
    .filter((item) => !item.org.parent_basis)
    .sort((a, b) => orgOrderIndex(a.org.basis) - orgOrderIndex(b.org.basis));
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
