"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { TARGETS, TargetKey, getPreviousPeriod, normalizeTargets, RATE_TOTAL_TOLERANCE } from "@/lib/targets";
import { HIDDEN_IN_CONFIRM, MIRROR_HEADCOUNT, mirrorSourceOf } from "@/lib/autoAggregate";
import { isOrgActiveIn } from "@/lib/orgLifespan";
// 조사 현황과 같은 단위·순서로 보여야 해서 정렬 규칙을 함께 쓴다.
import { leaderFirst, sortForOrgPicker } from "@/lib/orgOrder";
// 표·행 컴포넌트는 조사 링크 화면(/submit/[token])과 함께 쓴다 — 두 화면이 어긋나지 않도록 한 곳에 둔다.
import {
  NoteTip,
  RateTableHead,
  ReadOnlyRateRow,
  EditableRateRow,
  PersonEditTable,
  PersonReadOnlyTable,
  PersonHistoryBlocks,
  emptyRates,
  toRateMap,
  totalOf,
  totalIsValid,
  orderedQuarters,
  recTotal,
  toNumRec,
  averageFromPersons,
  namedHeadcountSum,
  isExpatOnly,
  personHeadcountForQuarter,
  personRowFromCurrent,
  toPersonPayload,
} from "@/components/RateParts";
import type {
  PersonRole,
  PersonHistoryEntry,
  PersonHistoryRow,
  RateHistoryEntry,
  CurrentPerson,
  PersonEditRow,
  RateMap,
} from "@/components/RateParts";

export { NoteTip, RateTableHead, ReadOnlyRateRow, isExpatOnly } from "@/components/RateParts";
export type { PersonRole, PersonHistoryEntry, RateHistoryEntry, CurrentPerson } from "@/components/RateParts";

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
  /** 링크가 영어로 나가는 조직(HUK 등)에서 한국어 코멘트 대신 내보낼 영문 코멘트. */
  submittedNoteEn: string | null;
  /** 이 조직은 '코멘트(영문)' 칸을 함께 받아야 하는가 (서버에서 판단해 내려준다). */
  needsEnglishNote: boolean;
  currentPersons: CurrentPerson[];
  currentRate: Record<TargetKey, number> | null;
  currentQuarter: string | null;
  personHistory: PersonHistoryEntry[];
  rateHistory: RateHistoryEntry[];
  expat: OrgReviewData | null;
  children: OrgReviewData[];
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

/**
 * 조직의 이번 분기 인원수. 집계 조직(개발 그룹 등)은 자기 인원을 따로 갖지 않으므로
 * 하위 조직 인원수를 합쳐 센다 — 안 그러면 인원수 0으로 잡혀 상위 평균에서 통째로 빠진다.
 */
function headcountForOrg(c: OrgReviewData): number {
  if (mirrorSourceOf(c.org.basis)) return MIRROR_HEADCOUNT;
  if (c.children.length > 0) return c.children.reduce((s, ch) => s + headcountForOrg(ch), 0);
  return orgWeight(c);
}

/**
 * 상위 조직 평균에 참여할 때의 하위 조직 값과 인원수.
 *
 * **그 분기 값만 쓴다.** 예전에는 이번 분기 입력이 없으면 지난 분기 확정값을 끌어다 썼는데,
 * 그러면 화면의 분기별 표와 자동계산 값이 서로 맞지 않는다(1Q 계산에 2Q 값이 섞여 들어감).
 * 사업총괄대표처럼 다른 조직 값을 따라가는 자리는 배부율을 원본 조직(사업그룹장)에서 가져오고
 * 인원수는 1명으로 센다 — 실제로 한 사람이 앉는 자리라 평균에서 빠지면 안 된다.
 */
function effectiveChild(
  c: OrgReviewData,
  siblings: OrgReviewData[],
  period: string
): { rec: Record<TargetKey, number>; weight: number } {
  const srcBasis = mirrorSourceOf(c.org.basis);
  const from = srcBasis ? siblings.find((s) => s.org.basis === srcBasis) ?? c : c;
  const rec = from.hasSubmission
    ? from.rollup
    : from.rateHistory.find((h) => h.quarter === period)?.rates ?? toNumRec(emptyRates());
  return { rec, weight: headcountForOrg(c) };
}

function sumOrgWeights(items: OrgReviewData[], period: string): number {
  return items.reduce((s, c) => s + effectiveChild(c, items, period).weight, 0);
}

/**
 * 특정 분기의 조직 인원수 — 과거 분기 행 표시용.
 * 상위 집계 조직은 자기 인원수를 따로 갖지 않아 하위 조직 인원수를 합쳐야 하는데,
 * 과거 분기 행은 지금 화면의 입력값(현재 분기)이 아니라 그 분기 이력에서 세야 한다.
 */
function orgWeightForQuarter(c: OrgReviewData, quarter: string): number {
  const fromPersons = personHeadcountForQuarter(
    c.personHistory,
    quarter,
    isExpatOnly(c.org.division, c.org.basis) ? "all" : "legal"
  );
  if (fromPersons && fromPersons > 0) return fromPersons;
  return Number(c.rateHistory.find((h) => h.quarter === quarter)?.headcount) || 0;
}

// 특정 분기 기준 조직 인원수. 집계 조직은 하위 조직 인원수를 합쳐 센다 (headcountForOrg의 과거분기판).
function headcountForOrgIn(c: OrgReviewData, quarter: string): number {
  if (mirrorSourceOf(c.org.basis)) return MIRROR_HEADCOUNT;
  if (c.children.length > 0) return c.children.reduce((s, ch) => s + headcountForOrgIn(ch, quarter), 0);
  return orgWeightForQuarter(c, quarter);
}

function sumOrgWeightsForQuarter(items: OrgReviewData[], quarter: string): number | null {
  const sum = items.reduce((s, c) => s + headcountForOrgIn(c, quarter), 0);
  return sum > 0 ? sum : null;
}

// 상위 집계 조직(예: 경영지원실)의 값 = 하위 조직들(예: 재무팀, Staff(경영지원))의 인원수 가중평균.
// 하위 값이 100%에서 미세하게 벗어나 있으면 평균도 벗어나므로 100%로 맞춰서 돌려준다
// (서버의 lib/autoAggregate weightedAvg와 같은 값이어야 화면과 저장값이 어긋나지 않는다).
function weightedAvgFromChildren(children: OrgReviewData[], period: string): RateMap {
  const r = emptyRates();
  if (children.length === 0) return r;
  const eff = children.map((c) => effectiveChild(c, children, period));
  const totalW = eff.reduce((a, e) => a + e.weight, 0);
  // 아무 조직도 인원수를 적지 않았으면 가중치를 못 쓰므로 균등 평균으로 물러난다.
  const useWeights = totalW > 0;
  const divisor = useWeights ? totalW : children.length;
  const avg = {} as Record<TargetKey, number>;
  TARGETS.forEach((t) => {
    const weighted = eff.reduce((sum, e) => sum + (Number(e.rec[t.key]) || 0) * (useWeights ? e.weight : 1), 0);
    avg[t.key] = divisor > 0 ? weighted / divisor : 0;
  });
  return toRateMap(normalizeTargets(avg));
}

const AFFILIATE_KEYS: TargetKey[] = ["h_mobility", "h_ev", "hiparking", "peoplecar", "winercom", "holdings", "h_networks"];

// HKR(관계사 제외) = 본사 조직들의 인원수 가중평균(weightedAvgFromChildren과 동일 로직) 이후,
// 계열사 배부분을 제외하고 나머지(Humax 내부) 컬럼만으로 재정규화한 값.
function computeHkr(honsaOrgs: OrgReviewData[], period: string): RateMap {
  const avg = toNumRec(weightedAvgFromChildren(honsaOrgs, period));
  const humaxOnly = {} as Record<TargetKey, number>;
  TARGETS.forEach((t) => {
    humaxOnly[t.key] = AFFILIATE_KEYS.includes(t.key) ? 0 : avg[t.key] || 0;
  });
  // 계열사 몫을 0으로 두고 남은 항목만 100%로 다시 맞추는 것이 곧 '계열사 제외 재정규화'다.
  return toRateMap(normalizeTargets(humaxOnly));
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

/**
 * 자동계산 표의 코멘트 입력 상태 + 자동저장.
 * 배부율은 못 고치는 표라 별도 저장 버튼을 두지 않고, 입력칸에서 포커스가 빠질 때 저장한다.
 */
function useOrgNote(args: {
  orgId: number;
  period: string;
  version: string;
  initial: string | null;
  /** 링크가 영어로 나가는 조직에서만 쓰는 영문 코멘트 — 한국어 코멘트와 같은 요청으로 함께 저장한다. */
  initialEn: string | null;
  rates: () => RateMap;
  headcount: () => number | null;
}) {
  const { orgId, period, version, initial, initialEn } = args;
  const [value, setValue] = useState(initial ?? "");
  const [valueEn, setValueEn] = useState(initialEn ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const savedRef = useRef(initial ?? "");
  const savedEnRef = useRef(initialEn ?? "");
  const router = useRouter();

  async function commit() {
    if (value === savedRef.current && valueEn === savedEnRef.current) return;
    setState("saving");
    try {
      const res = await fetch("/api/admin/org-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId,
          period,
          version,
          note: value,
          noteEn: valueEn,
          rates: toNumRec(args.rates()),
          headcount: args.headcount(),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "저장 실패");
      savedRef.current = value;
      savedEnRef.current = valueEn;
      setState("saved");
      // 서버 컴포넌트는 페이지 진입 시 한 번만 조회한다. 새로고침하지 않으면 다른 조직으로 옮겼다
      // 돌아왔을 때 낡은 초기값(코멘트 저장 전 상태)으로 다시 그려져 방금 쓴 코멘트가 사라져 보인다.
      router.refresh();
    } catch {
      setState("error");
    }
  }

  // 저장 버튼을 눈에 띄게 할지 판단할 값 — 마지막으로 저장한 것과 다르면 아직 저장 전이다.
  const dirty = value !== savedRef.current || valueEn !== savedEnRef.current;

  return { value, setValue, valueEn, setValueEn, state, commit, dirty };
}

// 이번 분기 조직 단위 코멘트(자동계산 조직도 여기에 저장된다).
function currentNoteOf(item: OrgReviewData, period: string): string | null {
  return item.rateHistory.find((h) => h.quarter === period)?.note ?? item.submittedNote ?? null;
}

function currentNoteEnOf(item: OrgReviewData, period: string): string | null {
  return item.rateHistory.find((h) => h.quarter === period)?.noteEn ?? item.submittedNoteEn ?? null;
}

// ---------- 상위 집계 조직 (경영지원실 등) : 하위 조직 인원수 가중평균, 읽기 전용 + 확정 스냅샷 ----------
function ParentOrgDetail({ item, period, version }: { item: OrgReviewData; period: string; version: string }) {
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(item.confirmedThisPeriod);
  const [error, setError] = useState("");
  const router = useRouter();

  const pastRateHistory = item.rateHistory.filter((h) => h.quarter !== period);
  const computed = weightedAvgFromChildren(item.children, period);
  const computedHeadcount = sumOrgWeights(item.children, period);
  const total = totalOf(computed);
  const totalOk = Math.abs(total - 1) < RATE_TOTAL_TOLERANCE || total === 0;

  // 입력란은 감추지만 가중평균에는 들어가는 자리(사업총괄대표)는 각주로만 알린다.
  const mirroredChildren = item.children.filter((c) => mirrorSourceOf(c.org.basis));
  const editableChildren = item.children.filter((c) => !mirrorSourceOf(c.org.basis));

  const note = useOrgNote({
    orgId: item.org.id,
    period,
    version,
    initial: currentNoteOf(item, period),
    initialEn: currentNoteEnOf(item, period),
    rates: () => computed,
    headcount: () => computedHeadcount || null,
  });

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
      if (!res.ok) throw new Error(json.error || "저장 중 오류가 발생했습니다.");
      setConfirmed(true);
      // 서버 컴포넌트가 페이지 진입 시 한 번만 조회하므로, 새로고침하지 않으면 다른 조직으로 옮겼다 돌아왔을 때
      // 방금 저장한 내용이 미반영으로 보인다.
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
            <span className="status-badge status-confirmed">반영됨 ({period})</span>
          ) : (
            <span className="status-badge" style={{ background: "#f1f5f9", color: "#64748b" }}>
              미반영
            </span>
          )}
        </div>
        <div className="panel-sub">
          {item.org.division} · 하위 조직({item.children.map((c) => c.org.basis).join(" + ")})의 인원수 가중평균으로 자동 계산됩니다. 하위 조직에서 직접 입력해주세요.
        </div>
      </div>

      <div className="tbl-scroll" style={{ marginBottom: 12 }}>
        <table className="rate-tbl">
          <RateTableHead withNote withNoteEn={item.needsEnglishNote} />
          <tbody>
            {orderedQuarters(pastRateHistory.map((h) => h.quarter), period).map((q) =>
              q === period ? (
                <ReadOnlyRateRow
                  key={q}
                  label={`${period} (자동계산)`}
                  rec={toNumRec(computed)}
                  headcount={computedHeadcount}
                  withNote
                  noteEditable
                  noteValue={note.value}
                  onNoteChange={note.setValue}
                  onNoteCommit={note.commit}
                  noteSaveState={note.state}
                  noteDirty={note.dirty}
                  withNoteEn={item.needsEnglishNote}
                  noteEnValue={note.valueEn}
                  onNoteEnChange={note.setValueEn}
                />
              ) : (
                <ReadOnlyRateRow
                  key={q}
                  label={q}
                  rec={pastRateHistory.find((h) => h.quarter === q)!.rates}
                  headcount={sumOrgWeightsForQuarter(item.children, q)}
                  withNote
                  note={pastRateHistory.find((h) => h.quarter === q)!.note}
                  withNoteEn={item.needsEnglishNote}
                  noteEn={pastRateHistory.find((h) => h.quarter === q)!.noteEn}
                />
              )
            )}
          </tbody>
        </table>
      </div>
      {mirroredChildren.map((c) => (
        <div key={c.org.id} className="field-hint" style={{ marginBottom: 6 }}>
          ※ {c.org.basis}은(는) {mirrorSourceOf(c.org.basis)}과(와) 동일한 배부율을 적용하며, 인원수 {MIRROR_HEADCOUNT}명으로
          위 가중평균에 포함됩니다. 별도 입력란은 두지 않습니다 (View에서 조회 가능).
        </div>
      ))}
      {!totalOk && (
        <div className="field-hint" style={{ color: "#dc2626", marginBottom: 12 }}>
          ⚠ {period} 합계가 100%가 아닙니다 — 하위 조직 입력을 확인해주세요.
        </div>
      )}

      <div className="field-hint" style={{ marginBottom: 12 }}>
        {period}에 제출한 하위 조직은 그 값을, 아직 제출하지 않은 조직은 마지막 확정값을 대신 넣어 계산합니다.
        아래 하위 조직을 저장하면 이 값도 자동으로 다시 계산되어 반영됩니다. (코멘트는 입력칸에서 벗어나면 자동 저장됩니다.)
      </div>

      <div className="panel-sub" style={{ fontWeight: 700, color: "#1a202c", margin: "20px 0 12px" }}>
        ■ 하위 조직 개별 입력 ({editableChildren.length}개)
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {leaderFirst(editableChildren).map((c) => (
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
  const computed = computeHkr(honsaOrgs, period);
  const computedHeadcount = sumOrgWeights(honsaOrgs, period);

  /**
   * 특정 분기의 '본사 조직 현황' 행. 그 분기 값만 쓴다 — 다른 분기 값을 끌어오지 않는다.
   * 이번 분기는 아직 확정 전일 수 있으므로 제출 롤업을 먼저 본다.
   */
  function honsaRowsFor(quarter: string) {
    const isCurrent = quarter === period;
    // 그 분기에 없던 조직은 그 분기 표에 나오면 안 된다
    // (예: 사업협력팀은 2026-Q2에만 있으므로 1Q 표에는 빠진다).
    return leaderFirst(honsaOrgs.filter((c) => isOrgActiveIn(c.org.basis, quarter))).map((c) => {
      const rec =
        isCurrent && c.hasSubmission
          ? c.rollup
          : c.rateHistory.find((h) => h.quarter === quarter)?.rates ?? toNumRec(emptyRates());
      const weight = isCurrent ? headcountForOrg(c) : headcountForOrgIn(c, quarter);
      return { c, rec, weight, empty: recTotal(rec) <= 0 };
    });
  }
  const total = totalOf(computed);
  const totalOk = Math.abs(total - 1) < RATE_TOTAL_TOLERANCE || total === 0;

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
      if (!res.ok) throw new Error(json.error || "저장 중 오류가 발생했습니다.");
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
            <span className="status-badge status-confirmed">반영됨 ({period})</span>
          ) : (
            <span className="status-badge" style={{ background: "#f1f5f9", color: "#64748b" }}>
              미반영
            </span>
          )}
        </div>
        <div className="panel-sub">
          본사 · 본사 조직 {honsaOrgs.length}개의 인원수 가중평균 배부율에서 계열사(H.Mobility~H.Networks) 배부분을 제외하고 나머지를 재정규화해 자동 계산됩니다.
          저장하면 운영 allocation_rate에 곧바로 반영됩니다.
        </div>
      </div>

      <div className="panel-sub" style={{ fontWeight: 700, color: "#1a202c", margin: "0 0 8px" }}>
        ■ 분기별 HKR 배부율
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

      {/* 분기마다 별도 표로 나눈다 — 한 표에 여러 분기 값이 섞이면 무엇으로 계산됐는지 알 수 없다. */}
      {orderedQuarters(pastHistory.map((h) => h.quarter), period).map((q) => {
        const rows = honsaRowsFor(q);
        return (
          <div key={q}>
            <div className="panel-sub" style={{ fontWeight: 700, color: "#1a202c", margin: "0 0 4px" }}>
              ■ {q} 본사 조직 현황 (가중치 산정 대상)
            </div>
            {/* 계산 근거만 한 줄로 남긴다 — 과거 분기 표는 제목만으로 충분하다. */}
            {q === period && (
              <div className="field-hint" style={{ marginBottom: 8 }}>
                위 {period} (자동계산) 값은 이 표의 행들만으로 계산됩니다. 값이 없는 조직은 계산에서 빠집니다.
              </div>
            )}
            <div className="tbl-scroll" style={{ marginBottom: 12 }}>
              <table className="rate-tbl">
                <RateTableHead />
                <tbody>
                  {rows.map(({ c, rec, weight, empty }) => (
                    <ReadOnlyRateRow
                      key={c.org.id}
                      // 어떻게 만들어진 값인지는 인원수·합계로 이미 드러나므로 조직명만 적는다.
                      label={c.org.basis}
                      rec={rec}
                      headcount={weight > 0 ? weight : null}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

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
  // 링크가 영어로 나가는 조직에서만 쓰는 영문 코멘트 (한국어 코멘트와 함께 확정 시 저장된다).
  const [orgNoteEnInput, setOrgNoteEnInput] = useState(() => item.submittedNoteEn ?? "");
  const [persons, setPersons] = useState<PersonEditRow[]>(() => initialPersons(item));
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(item.confirmedThisPeriod && (!item.expat || item.expat.confirmedThisPeriod));
  const [error, setError] = useState("");
  // 저장은 됐지만 합계를 100%로 맞춰야 했던 경우의 안내 (오류가 아니므로 error와 따로 둔다).
  const [notice, setNotice] = useState("");
  const router = useRouter();

  const hasExpat = !!item.expat;
  const usesPersonTable = item.org.requires_person_detail || hasExpat;
  // 주재원 전용 조직(HSZ_주재원 등) — 소속 인원이 전원 주재원으로 저장되는 조직.
  const isExpatOnlyOrg = isExpatOnly(item.org.division, item.org.basis);
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
  // 분기 순으로만 묶는다. 같은 분기 안에서는 저장한 순서를 그대로 둔다
  // (서버에서 이미 저장 순서(id)로 정렬해 내려준다 — 여기서 이름순으로 다시 정렬하면 안 된다).
  // Array.prototype.sort는 안정 정렬이라 분기가 같으면 원래 순서가 유지된다.
  const personRowSort = (a: PersonHistoryRow, b: PersonHistoryRow) =>
    personQuarterOrder.indexOf(a.period) - personQuarterOrder.indexOf(b.period);
  const beforePersonRows = personCombinedHistory.filter((r) => beforeQuarterSet.has(r.period)).sort(personRowSort);
  const afterPersonRows = personCombinedHistory.filter((r) => afterQuarterSet.has(r.period)).sort(personRowSort);


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
    setOrgNoteEnInput(previousOrgRate.noteEn ?? "");
  }

  const orgEditable = usesPersonTable ? false : confirmed ? orgUnlocked : true;
  const personsEditable = usesPersonTable ? (confirmed ? personsUnlocked : true) : false;

  // 법인+주재원을 한 표에서 받는 조직은 '구분' 열로 나누지만,
  // 주재원 전용 조직(HSZ_주재원 등)은 소속 인원이 전원 주재원으로 저장된다.
  // 이 조직에서까지 주재원을 걸러내면 아무도 안 남아 인원수·자동계산이 0이 되고,
  // 그 상태로 저장하면 명단이 통째로 지워진다 — 전체 인원을 그대로 쓴다.
  const legalPersons = isExpatOnlyOrg ? persons : persons.filter((p) => p.role !== "주재원");
  const expatPersons = isExpatOnlyOrg ? [] : persons.filter((p) => p.role === "주재원");
  const computedOrgRates = usesPersonTable ? averageFromPersons(legalPersons) : orgRates;
  const computedExpatRates = hasExpat ? averageFromPersons(expatPersons) : null;
  const displayOrgRates = computedOrgRates;

  const currentOrgHeadcount = usesPersonTable ? namedHeadcountSum(legalPersons) : Number(orgHeadcountInput) || 0;
  const currentExpatHeadcount = hasExpat ? namedHeadcountSum(expatPersons) : null;

  // 개인별 조직은 조직 단위 표가 자동계산이라 값을 못 고친다 — 코멘트만 따로 적고 자동 저장한다.
  // (조직 단위 입력 조직은 아래 EditableRateRow의 코멘트 칸을 그대로 쓰고 확정할 때 함께 저장된다.)
  const autoNote = useOrgNote({
    orgId: item.org.id,
    period,
    version,
    initial: currentNoteOf(item, period),
    initialEn: currentNoteEnOf(item, period),
    rates: () => displayOrgRates,
    headcount: () => currentOrgHeadcount,
  });

  function updateOrgRate(key: TargetKey, value: string) {
    setOrgRates((r) => ({ ...r, [key]: value }));
  }

  async function handleConfirm() {
    setError("");
    setNotice("");
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
          orgNoteEn: usesPersonTable ? undefined : orgNoteEnInput || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "저장 중 오류가 발생했습니다.");
      const corrected: { basis: string; from: number }[] = [];
      if (json.correctedFrom != null) corrected.push({ basis: json.basis, from: json.correctedFrom });

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
        if (!res2.ok) throw new Error(json2.error || "주재원 저장 중 오류가 발생했습니다.");
        if (json2.correctedFrom != null) corrected.push({ basis: json2.basis, from: json2.correctedFrom });
      }

      // 화면 검증은 ±0.5%p까지 통과시키므로 100.01% 같은 입력이 그대로 저장될 뻔했다.
      // 저장은 100%로 맞춰 끝났지만, 원본 입력을 다시 보도록 어떤 값이었는지 알려준다.
      if (corrected.length > 0) {
        setNotice(
          corrected.map((c) => `${c.basis} 합계가 ${(c.from * 100).toFixed(3)}%였습니다`).join(", ") +
            " — 100%로 맞춰 저장했습니다. 개인별 입력값을 확인해 주세요."
        );
      }

      // 값이 없는 저장(행을 전부 지웠거나 배부율이 0%)은 반영으로 보지 않는다 — 화면 배지도 그대로 둔다.
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
  const totalOk = Math.abs(total - 1) < RATE_TOTAL_TOLERANCE || total === 0;
  const expatTotal = computedExpatRates ? totalOf(computedExpatRates) : 0;
  const expatTotalOk = !computedExpatRates || expatTotal === 0 || Math.abs(expatTotal - 1) < RATE_TOTAL_TOLERANCE;

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
          {confirming ? "저장 중..." : "저장"}
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
              <span className="status-badge status-confirmed">반영됨 ({period})</span>
            ) : (
              <span className="status-badge" style={{ background: "#f1f5f9", color: "#64748b" }}>
                미반영
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
          <RateTableHead withClear={orgEditable} withNote withNoteEn={item.needsEnglishNote} />
          <tbody>
            {orderedQuarters(pastRateHistory.map((h) => h.quarter), period).map((q) => {
              if (q !== period) {
                const h = pastRateHistory.find((x) => x.quarter === q)!;
                return (
                  <ReadOnlyRateRow
                    key={q}
                    label={h.quarter}
                    rec={h.rates}
                    headcount={
                      usesPersonTable
                        ? personHeadcountForQuarter(item.personHistory, h.quarter, isExpatOnlyOrg ? "all" : "legal")
                        : h.headcount
                    }
                    showClearSlot={orgEditable}
                    withNote
                    note={h.note}
                    withNoteEn={item.needsEnglishNote}
                    noteEn={h.noteEn}
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
                  withNote
                  noteValue={orgNoteInput}
                  onNoteChange={setOrgNoteInput}
                  withNoteEn={item.needsEnglishNote}
                  noteEnValue={orgNoteEnInput}
                  onNoteEnChange={setOrgNoteEnInput}
                />
              ) : (
                <ReadOnlyRateRow
                  key={q}
                  label={`${period}${usesPersonTable ? " (자동계산)" : ""}`}
                  rec={toNumRec(displayOrgRates)}
                  headcount={currentOrgHeadcount}
                  withNote
                  // 자동계산 조직은 배부율은 못 고쳐도 코멘트는 적을 수 있게 한다.
                  noteEditable={usesPersonTable}
                  noteValue={autoNote.value}
                  onNoteChange={autoNote.setValue}
                  onNoteCommit={autoNote.commit}
                  noteSaveState={autoNote.state}
                  noteDirty={autoNote.dirty}
                  note={orgNoteInput || null}
                  withNoteEn={item.needsEnglishNote}
                  noteEnValue={autoNote.valueEn}
                  onNoteEnChange={autoNote.setValueEn}
                  noteEn={orgNoteEnInput || null}
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
                      headcount={personHeadcountForQuarter(item.personHistory, q, "expat")}
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

          <PersonHistoryBlocks rows={beforePersonRows} quarterOrder={personQuarterOrder} hasExpat={hasExpat} />

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
            <div className="field-hint" style={{ fontWeight: 700, color: personsEditable ? "#2563eb" : "#1a202c", margin: 0 }}>
              {period} {personsEditable ? "(입력중)" : "(반영됨)"}
            </div>
            {personsEditable && previousPersonsForOrg.length > 0 && (
              <button className="btn btn-secondary btn-sm" onClick={loadPreviousPersons}>
                전분기 데이터 끌고오기 ({previousPersonsForOrg.length}명)
              </button>
            )}
          </div>
          {personsEditable ? (
            <PersonEditTable
              persons={persons}
              setPersons={setPersons}
              hasExpat={hasExpat}
              withNoteEn={item.needsEnglishNote}
            />
          ) : (
            <PersonReadOnlyTable persons={persons} hasExpat={hasExpat} />
          )}
          {error && <div className="callout alert" style={{ marginTop: 12, marginBottom: 12 }}>{error}</div>}
          {notice && <div className="callout info" style={{ marginTop: 12, marginBottom: 12 }}>{notice}</div>}
          {actionButton}
          <PersonHistoryBlocks rows={afterPersonRows} quarterOrder={personQuarterOrder} hasExpat={hasExpat} />
        </>
      )}

      {!usesPersonTable && (
        <>
          {error && <div className="callout alert" style={{ marginTop: 12, marginBottom: 12 }}>{error}</div>}
          {notice && <div className="callout info" style={{ marginTop: 12, marginBottom: 12 }}>{notice}</div>}
          {actionButton}
        </>
      )}
    </div>
  );
}

const HKR_ID = -1;

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
  const topLevel = sortForOrgPicker(
    data
      // 사업총괄대표처럼 값이 자동으로 채워지는 조직은 검토 화면에서 감춘다 (View에서는 그대로 보인다).
      .filter((item) => !item.org.parent_basis && !HIDDEN_IN_CONFIRM.includes(item.org.basis))
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
          조직을 선택하면 아래에서 분기별 이력과 이번 라운드 값을 검토·수정할 수 있습니다. 파란 배지가 붙은 조직은 하위 조직 값을 자동 집계하는 조직입니다.
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
                // 배부율이 반영된 조직은 체크표시 대신 연한 초록 배경으로 알아본다 (제출하면 곧바로 반영된다).
                className={`av-chip ${item.confirmedThisPeriod ? "submitted" : ""} ${selectedId === item.org.id ? "active" : ""}`}
                style={{ marginRight: 6, marginBottom: 6 }}
                onClick={() => setSelectedId(item.org.id)}
              >
                {item.org.basis}
                {item.children.length > 0 ? " 📊" : ""}
                {item.expat ? " 🌐" : ""}
              </button>
            ))}
            {division === "본사" && (
              <button
                type="button"
                className={`av-chip ${hkrConfirmedThisPeriod ? "submitted" : ""} ${selectedId === HKR_ID ? "active" : ""}`}
                style={{ marginRight: 6, marginBottom: 6 }}
                onClick={() => setSelectedId(HKR_ID)}
              >
                HKR(관계사제외) 🧮
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
