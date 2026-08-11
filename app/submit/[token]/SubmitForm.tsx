"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { TargetKey, getPreviousPeriod } from "@/lib/targets";
import {
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
  toNumRec,
  orderedQuarters,
  averageFromPersons,
  namedHeadcountSum,
  isExpatOnly,
  personHeadcountForQuarter,
  personRowFromCurrent,
  toPersonPayload,
} from "@/components/RateParts";
import type {
  CurrentPerson,
  PersonEditRow,
  PersonHistoryEntry,
  PersonHistoryRow,
  RateHistoryEntry,
  RateMap,
} from "@/components/RateParts";

/** 자동 임시저장에 담는 값 — 화면을 다시 열었을 때 그대로 이어서 입력할 수 있게 한다. */
export interface SubmitDraft {
  submittedBy?: string;
  orgRates?: Record<string, string>;
  orgHeadcount?: string;
  orgNote?: string;
  persons?: PersonEditRow[];
}

export interface SubmitOrgData {
  orgBasis: string;
  division: string;
  requiresPersonDetail: boolean;
  managerName: string | null;
  submittedThisPeriod: boolean;
  submittedBy: string | null;
  latestSubmittedAt: string | null;
  rollup: Record<TargetKey, number>;
  currentOrgSubmission: Record<TargetKey, number> | null;
  submittedHeadcount: number | null;
  submittedNote: string | null;
  currentPersons: CurrentPerson[];
  currentRate: Record<TargetKey, number> | null;
  rateHistory: RateHistoryEntry[];
  personHistory: PersonHistoryEntry[];
  draft: SubmitDraft | null;
  draftSavedAt: string | null;
}

const DRAFT_DEBOUNCE_MS = 1500;

function fmtTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("ko-KR");
}

/**
 * 조사 링크 화면.
 *
 * 관리자 '검토 및 확정 > 리소스배부율'에서 조직을 선택했을 때와 **같은 구성**으로 보여준다
 * (같은 표 컴포넌트를 @/components/RateParts에서 함께 쓴다).
 * 다만 이 화면은 담당자에게 나가므로 자기 조직 것만 보여주고, 다른 조직명은 어디에도 넣지 않는다.
 * 하단 버튼은 관리자 화면의 '저장'이 아니라 '제출하기'다.
 */
export default function SubmitForm({
  token,
  period,
  version,
  data,
}: {
  token: string;
  period: string;
  version: string;
  data: SubmitOrgData;
}) {
  const draft = data.draft;
  const router = useRouter();

  const [submittedBy, setSubmittedBy] = useState(draft?.submittedBy ?? data.submittedBy ?? data.managerName ?? "");
  const [orgRates, setOrgRates] = useState<RateMap>(() =>
    draft?.orgRates
      ? ({ ...emptyRates(), ...draft.orgRates } as RateMap)
      : toRateMap(data.currentOrgSubmission ?? data.currentRate)
  );
  // 인원수를 비워두고 제출하면 0명으로 남긴다 (빈칸으로 두지 않는다).
  const [orgHeadcountInput, setOrgHeadcountInput] = useState(
    () => draft?.orgHeadcount ?? String(data.submittedHeadcount ?? 0)
  );
  const [orgNoteInput, setOrgNoteInput] = useState(() => draft?.orgNote ?? data.submittedNote ?? "");
  const [persons, setPersons] = useState<PersonEditRow[]>(() => draft?.persons ?? data.currentPersons.map(personRowFromCurrent));

  const [submitted, setSubmitted] = useState(data.submittedThisPeriod);
  // 임시저장본이 남아 있으면 아직 제출 전 작업이 있는 것이므로 잠그지 않고 이어서 입력하게 한다.
  const [unlocked, setUnlocked] = useState(!!draft);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [justSubmitted, setJustSubmitted] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(data.draftSavedAt);
  const [draftState, setDraftState] = useState<"idle" | "saving" | "error">("idle");

  const usesPersonTable = data.requiresPersonDetail;
  const isExpatOnlyOrg = isExpatOnly(data.division, data.orgBasis);
  const editable = !submitted || unlocked;
  const orgEditable = usesPersonTable ? false : editable;
  const personsEditable = usesPersonTable ? editable : false;

  const pastRateHistory = data.rateHistory.filter((h) => h.quarter !== period);
  const pastPersonHistory = data.personHistory.filter((h) => h.period !== period);
  const prevPeriod = getPreviousPeriod(period);
  const previousPersonsForOrg = prevPeriod ? data.personHistory.filter((h) => h.period === prevPeriod) : [];
  const previousOrgRate = prevPeriod ? pastRateHistory.find((h) => h.quarter === prevPeriod) ?? null : null;

  // 개인별 과거 이력을 현재 분기 기준으로 이전/이후로 나눈다 — 항상 연도->분기 순으로 보이게 하기 위해,
  // 현재 분기보다 나중 분기가 이미 있으면 그 이력은 현재 분기 아래에 따로 보여준다.
  const personCombinedHistory: PersonHistoryRow[] = pastPersonHistory;
  const personQuarterOrder = orderedQuarters(personCombinedHistory.map((h) => h.period), period);
  const currentQuarterIdx = personQuarterOrder.indexOf(period);
  const beforeQuarterSet = new Set(personQuarterOrder.slice(0, currentQuarterIdx));
  const afterQuarterSet = new Set(personQuarterOrder.slice(currentQuarterIdx + 1));
  const personRowSort = (a: PersonHistoryRow, b: PersonHistoryRow) =>
    personQuarterOrder.indexOf(a.period) - personQuarterOrder.indexOf(b.period);
  const beforePersonRows = personCombinedHistory.filter((r) => beforeQuarterSet.has(r.period)).sort(personRowSort);
  const afterPersonRows = personCombinedHistory.filter((r) => afterQuarterSet.has(r.period)).sort(personRowSort);

  const legalPersons = isExpatOnlyOrg ? persons : persons.filter((p) => p.role !== "주재원");
  const computedOrgRates = usesPersonTable ? averageFromPersons(legalPersons) : orgRates;
  const currentOrgHeadcount = usesPersonTable ? namedHeadcountSum(legalPersons) : Number(orgHeadcountInput) || 0;

  const total = totalOf(computedOrgRates);
  const totalOk = Math.abs(total - 1) < 0.005 || total === 0;

  function updateOrgRate(key: TargetKey, value: string) {
    setOrgRates((r) => ({ ...r, [key]: value }));
  }

  function loadPreviousOrgRate() {
    if (!previousOrgRate) return;
    setOrgRates(toRateMap(previousOrgRate.rates));
    setOrgHeadcountInput(previousOrgRate.headcount != null ? String(previousOrgRate.headcount) : "");
    setOrgNoteInput(previousOrgRate.note ?? "");
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

  function draftPayload(): SubmitDraft {
    return { submittedBy, orgRates, orgHeadcount: orgHeadcountInput, orgNote: orgNoteInput, persons };
  }

  // 제출 전에도 입력한 값이 남도록 편집이 멈추면 자동으로 임시저장한다.
  // 임시저장은 미제출 상태라 관리자 화면에는 보이지 않는다 (별도 테이블).
  const skipFirstAutosave = useRef(true);
  useEffect(() => {
    if (skipFirstAutosave.current) {
      skipFirstAutosave.current = false;
      return;
    }
    if (!editable) return;
    const timer = setTimeout(async () => {
      setDraftState("saving");
      try {
        const res = await fetch("/api/submissions/draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, payload: draftPayload() }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "임시저장 실패");
        setDraftSavedAt(json.savedAt ?? new Date().toISOString());
        setDraftState("idle");
      } catch {
        setDraftState("error");
      }
    }, DRAFT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submittedBy, orgRates, orgHeadcountInput, orgNoteInput, persons, editable]);

  // 자동 임시저장(1.5초)이 돌기 전에 창을 닫아도 마지막 입력이 남도록 한 번 더 보낸다.
  const draftPayloadRef = useRef(draftPayload);
  draftPayloadRef.current = draftPayload;
  useEffect(() => {
    function flush() {
      if (!navigator.sendBeacon) return;
      const blob = new Blob([JSON.stringify({ token, payload: draftPayloadRef.current() })], {
        type: "application/json",
      });
      navigator.sendBeacon("/api/submissions/draft", blob);
    }
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [token]);

  async function handleSubmit() {
    setError("");
    if (!submittedBy.trim()) {
      setError("입력자 이름을 적어주세요.");
      return;
    }
    if (usesPersonTable) {
      const invalid = persons.find((p) => p.name.trim() && !totalIsValid(p.rates));
      if (invalid) {
        setError(`'${invalid.name}'님의 비율 합계가 100%가 아닙니다. 확인 후 다시 제출해주세요.`);
        return;
      }
    } else if (!totalIsValid(orgRates)) {
      setError("조직 단위 배부율 합계가 100%가 아닙니다. 확인 후 다시 제출해주세요.");
      return;
    }

    setSending(true);
    try {
      const res = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          submittedBy,
          headcount: currentOrgHeadcount,
          // 개인별 조직은 조직 단위 코멘트를 이 화면에서 고치지 않는다 —
          // 그래도 기존 값을 그대로 돌려보내야 재제출할 때마다 코멘트가 지워지지 않는다.
          note: orgNoteInput || null,
          orgRates: computedOrgRates,
          persons: usesPersonTable ? toPersonPayload(persons) : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "제출 중 오류가 발생했습니다.");
      setSubmitted(true);
      setUnlocked(false);
      setJustSubmitted(true);
      setDraftSavedAt(null);
      router.refresh();
    } catch (e: any) {
      setError(e.message || "제출 중 오류가 발생했습니다.");
    } finally {
      setSending(false);
    }
  }

  const actionButton = (
    <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      {submitted && !unlocked ? (
        <button className="btn btn-secondary btn-sm" onClick={() => setUnlocked(true)}>
          수정하기
        </button>
      ) : (
        <button className="btn btn-primary" disabled={sending} onClick={handleSubmit}>
          {sending ? "제출 중..." : "제출하기"}
        </button>
      )}
      {editable && (
        <span className="field-hint" style={{ margin: 0, color: draftState === "error" ? "#dc2626" : undefined }}>
          {draftState === "saving"
            ? "임시저장 중..."
            : draftState === "error"
            ? "임시저장 실패 — 네트워크를 확인해주세요"
            : draftSavedAt
            ? `임시저장됨 ${fmtTime(draftSavedAt)} (제출 전까지 담당자에게 보이지 않습니다)`
            : "입력하면 자동으로 임시저장됩니다 (제출 전까지 담당자에게 보이지 않습니다)"}
        </span>
      )}
    </div>
  );

  return (
    <div className="page">
      <div className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
          <div>
            <div className="panel-title">
              {data.orgBasis} <span className="tag">{period} · {version}</span>{" "}
              {submitted ? (
                <span className="status-badge status-confirmed">제출됨 ({period})</span>
              ) : (
                <span className="status-badge" style={{ background: "#f1f5f9", color: "#64748b" }}>
                  미제출
                </span>
              )}
            </div>
            <div className="panel-sub">
              {data.division} · {usesPersonTable ? "개인별 확인 필요" : "조직 단위"}
              {data.submittedBy ? ` · 제출자: ${data.submittedBy}` : ""}
              {data.latestSubmittedAt ? ` · ${new Date(data.latestSubmittedAt).toLocaleString("ko-KR")}` : ""}
            </div>
          </div>
          <div className="field" style={{ minWidth: 200 }}>
            <label>입력자 (책임자/담당자 이름) *</label>
            <input
              value={submittedBy}
              onChange={(e) => setSubmittedBy(e.target.value)}
              placeholder="이름"
              disabled={!editable}
            />
          </div>
        </div>

        {justSubmitted && (
          <div className="callout success" style={{ marginBottom: 12 }}>
            <b>제출이 완료되었습니다.</b> 담당자 검토 후 최종 반영됩니다. 수정이 필요하면 아래 '수정하기'를 눌러 다시 제출하실 수 있습니다.
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
          <div className="panel-sub" style={{ fontWeight: 700, color: "#1a202c", margin: 0 }}>
            ■ 조직별 리소스 배부율
          </div>
          {!usesPersonTable && orgEditable && previousOrgRate && (
            <button className="btn btn-secondary btn-sm" onClick={loadPreviousOrgRate}>
              전분기 데이터 끌고오기
            </button>
          )}
        </div>
        <div className="tbl-scroll" style={{ marginBottom: 12 }}>
          <table className="rate-tbl">
            <RateTableHead withClear={orgEditable} withNote />
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
                          ? personHeadcountForQuarter(data.personHistory, h.quarter, isExpatOnlyOrg ? "all" : "legal")
                          : h.headcount
                      }
                      showClearSlot={orgEditable}
                      withNote
                      note={h.note}
                    />
                  );
                }
                return orgEditable ? (
                  <EditableRateRow
                    key={q}
                    label={`${period} (입력중)`}
                    rates={orgRates}
                    onChange={updateOrgRate}
                    headcount={currentOrgHeadcount}
                    onClear={() => setOrgRates(emptyRates())}
                    headcountEditable
                    headcountValue={orgHeadcountInput}
                    onHeadcountChange={setOrgHeadcountInput}
                    withNote
                    noteValue={orgNoteInput}
                    onNoteChange={setOrgNoteInput}
                  />
                ) : (
                  <ReadOnlyRateRow
                    key={q}
                    label={`${period}${usesPersonTable ? " (자동계산)" : ""}`}
                    rec={toNumRec(computedOrgRates)}
                    headcount={currentOrgHeadcount}
                    withNote
                    note={orgNoteInput || null}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
        {!totalOk && (
          <div className="field-hint" style={{ color: "#dc2626", marginBottom: 12 }}>
            ⚠ {period} 합계가 100%가 아닙니다. 각 항목의 비율 합이 100%가 되도록 입력해주세요.
          </div>
        )}

        {usesPersonTable && (
          <>
            <div className="panel-sub" style={{ fontWeight: 700, color: "#1a202c", margin: "0 0 8px" }}>
              ■ 개인별 리소스 배부율
            </div>
            <div className="field-hint" style={{ marginBottom: 8 }}>
              관계사·계열사(H.Mobility~H.Networks)에 청구되는 조직이라 개인별 확인이 필요합니다. 팀원별로 행을 추가해 입력해주세요.
              위 조직 단위 값은 아래 행들의 평균으로 자동 계산됩니다.
            </div>

            <PersonHistoryBlocks rows={beforePersonRows} quarterOrder={personQuarterOrder} hasExpat={false} />

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
              <div className="field-hint" style={{ fontWeight: 700, color: personsEditable ? "#2563eb" : "#1a202c", margin: 0 }}>
                {period} {personsEditable ? "(입력중)" : "(제출됨)"}
              </div>
              {personsEditable && previousPersonsForOrg.length > 0 && (
                <button className="btn btn-secondary btn-sm" onClick={loadPreviousPersons}>
                  전분기 데이터 끌고오기 ({previousPersonsForOrg.length}명)
                </button>
              )}
            </div>
            {personsEditable ? (
              <PersonEditTable persons={persons} setPersons={setPersons} hasExpat={false} />
            ) : (
              <PersonReadOnlyTable persons={persons} hasExpat={false} />
            )}
            {error && <div className="callout alert" style={{ marginTop: 12, marginBottom: 12 }}>{error}</div>}
            {actionButton}
            <PersonHistoryBlocks rows={afterPersonRows} quarterOrder={personQuarterOrder} hasExpat={false} />
          </>
        )}

        {!usesPersonTable && (
          <>
            {error && <div className="callout alert" style={{ marginTop: 12, marginBottom: 12 }}>{error}</div>}
            {actionButton}
          </>
        )}
      </div>
    </div>
  );
}
