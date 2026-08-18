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
import { SubmitLang, submitStrings } from "@/lib/submitLang";

/** 자동 임시저장에 담는 값 — 화면을 다시 열었을 때 그대로 이어서 입력할 수 있게 한다. */
export interface SubmitDraft {
  submittedBy?: string;
  orgRates?: Record<string, string>;
  orgHeadcount?: string;
  orgNote?: string;
  persons?: PersonEditRow[];
}

export interface SubmitOrgData {
  orgId: number;
  /** 화면에 보여줄 조직명 — 영어 링크에서는 서버에서 영문 표기로 바꿔 넣는다. */
  orgBasis: string;
  division: string;
  requiresPersonDetail: boolean;
  managerName: string | null;
  submittedThisPeriod: boolean;
  /** 관리자가 재제출을 허용했는지. 제출 후에는 이게 true일 때만 고칠 수 있다. */
  editAllowed: boolean;
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

export interface SubmitPageData {
  /** 집계 조직(개발 그룹 등)일 때 그 조직 자체. 자기가 입력하는 자리가 아니라 하위 조직 값을 모으는 자리다. */
  parent: SubmitOrgData | null;
  /** 집계에 들어가는 하위 조직 이름 (안내문에 그대로 쓴다). */
  parentChildNames: string[];
  /** 입력란 없이 다른 조직 값을 따라가는 자리 — 각주로만 알린다. */
  mirrors: { basis: string; source: string; headcount: number }[];
  /** 실제로 입력받는 조직들 (단일 조직이면 1개). */
  orgs: SubmitOrgData[];
}

const DRAFT_DEBOUNCE_MS = 1500;

function fmtTime(iso: string | null, locale: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString(locale);
}

/**
 * 조직 하나의 입력 구역.
 *
 * 관리자 '검토 및 확정 > 리소스배부율'의 조직 상세(OrgDetail)와 같은 구성이다
 * (같은 표 컴포넌트를 @/components/RateParts에서 함께 쓴다).
 * 다만 하단 버튼은 관리자 화면의 '저장'이 아니라 '제출하기'다.
 */
function OrgSubmitSection({
  token,
  period,
  version,
  data,
  showPeriodTag,
  lang,
}: {
  token: string;
  period: string;
  version: string;
  data: SubmitOrgData;
  /** 조직이 하나뿐인 화면에서는 제목 옆에 분기를 함께 보여준다 (집계 화면은 맨 위에 이미 있다). */
  showPeriodTag: boolean;
  lang: SubmitLang;
}) {
  const s = submitStrings(lang);
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
  const [persons, setPersons] = useState<PersonEditRow[]>(
    () => draft?.persons ?? data.currentPersons.map(personRowFromCurrent)
  );

  const [submitted, setSubmitted] = useState(data.submittedThisPeriod);
  // '수정 취소' 직후에는 서버 데이터가 다시 오기 전이라도 곧바로 잠긴 것처럼 보여야 한다.
  const [editCancelled, setEditCancelled] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  // 제출을 마친 뒤에는 **관리자가 열어준 경우에만** 다시 고칠 수 있다 —
  // 예전에는 화면의 '수정하기' 버튼으로 담당자가 스스로 풀 수 있었다.
  //
  // 임시저장본은 '아직 제출 전'이라는 뜻일 때만 잠금을 푼다. 제출한 뒤에 남거나 되살아난
  // 임시저장본까지 잠금을 풀면 제출 잠금이 통째로 무력화된다 — 제출 직후 창을 닫으면
  // pagehide 비콘이 방금 지워진 임시저장본을 다시 만들어 실제로 그렇게 됐다.
  const unlocked = !editCancelled && (data.editAllowed || (!!draft && !data.submittedThisPeriod));
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
  //
  // 화면을 열어보기만 해도 저장되면 안 된다 — 손대지 않은 빈 임시저장본이 남아
  // 다음에 열 때 제출한 조직이 '입력중'으로 풀려 보인다. 처음 값과 달라졌을 때만 저장한다.
  const initialDraftJson = useRef<string | null>(null);
  useEffect(() => {
    const current = JSON.stringify(draftPayload());
    if (initialDraftJson.current === null) {
      initialDraftJson.current = current;
      return;
    }
    if (current === initialDraftJson.current) return;
    if (!editable) return;
    // 제출을 마쳤으면 더 남기지 않는다 — 서버가 제출 시 지운 임시저장본을 다시 만들면 안 된다.
    if (justSubmitted) return;
    const timer = setTimeout(async () => {
      setDraftState("saving");
      try {
        const res = await fetch("/api/submissions/draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, orgId: data.orgId, payload: draftPayload() }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? s.errDraft);
        setDraftSavedAt(json.savedAt ?? new Date().toISOString());
        setDraftState("idle");
      } catch {
        setDraftState("error");
      }
    }, DRAFT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submittedBy, orgRates, orgHeadcountInput, orgNoteInput, persons, editable, justSubmitted]);

  // 자동 임시저장(1.5초)이 돌기 전에 창을 닫아도 마지막 입력이 남도록 한 번 더 보낸다.
  const draftPayloadRef = useRef(draftPayload);
  draftPayloadRef.current = draftPayload;
  // 리스너는 한 번만 등록되므로 최신 상태를 ref로 넘긴다 (클로저가 옛 값을 붙잡지 않게).
  const draftingAllowedRef = useRef(true);
  draftingAllowedRef.current = editable && !justSubmitted;
  useEffect(() => {
    function flush() {
      if (!navigator.sendBeacon) return;
      // 잠긴 화면이거나 이미 제출을 마쳤으면 남기지 않는다.
      if (!draftingAllowedRef.current) return;
      const payload = draftPayloadRef.current();
      // 열어보기만 하고 닫은 경우에는 남기지 않는다 (위 자동저장과 같은 기준).
      if (JSON.stringify(payload) === initialDraftJson.current) return;
      const blob = new Blob([JSON.stringify({ token, orgId: data.orgId, payload })], { type: "application/json" });
      navigator.sendBeacon("/api/submissions/draft", blob);
    }
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [token, data.orgId]);

  async function handleSubmit() {
    setError("");
    if (!submittedBy.trim()) {
      setError(s.errNoName);
      return;
    }
    if (usesPersonTable) {
      const invalid = persons.find((p) => p.name.trim() && !totalIsValid(p.rates));
      if (invalid) {
        setError(s.errPersonTotal(invalid.name));
        return;
      }
    } else if (!totalIsValid(orgRates)) {
      setError(s.errOrgTotal);
      return;
    }

    setSending(true);
    try {
      const res = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          orgId: data.orgId,
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
      // 서버가 돌려주는 오류 문구는 한국어라 영어 링크에서는 쓰지 않는다
      // (합계·입력자 이름은 위에서 이미 걸러지므로 남는 건 통신/저장 실패뿐이다).
      if (!res.ok) throw new Error((lang === "ko" && json.error) || s.errSubmit);
      setSubmitted(true);
      setJustSubmitted(true);
      setDraftSavedAt(null);
      // 제출과 함께 서버가 재제출 허용 표식을 지운다 — 새로 읽어와 잠긴 상태로 되돌린다.
      router.refresh();
    } catch (e: any) {
      setError(e.message || s.errSubmit);
    } finally {
      setSending(false);
    }
  }

  /**
   * 재수정을 그만둔다. 서버가 임시저장본과 재수정 허용 표식을 지우고, 화면은 제출된 값으로 되돌린다.
   * 되돌아갈 값은 서버가 이미 넘겨준 data.*(= 제출된 값)라 따로 받아올 것이 없다.
   */
  async function handleCancelEdit() {
    if (!window.confirm(s.cancelEditConfirm)) return;
    setError("");
    setCancelling(true);
    try {
      const res = await fetch("/api/submissions/cancel-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, orgId: data.orgId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error((lang === "ko" && json.error) || s.cancelEditFailed);

      setSubmittedBy(data.submittedBy ?? data.managerName ?? "");
      setOrgRates(toRateMap(data.currentOrgSubmission ?? data.currentRate));
      setOrgHeadcountInput(String(data.submittedHeadcount ?? 0));
      setOrgNoteInput(data.submittedNote ?? "");
      setPersons(data.currentPersons.map(personRowFromCurrent));
      setJustSubmitted(false);
      setDraftSavedAt(null);
      setSubmitted(true);
      setEditCancelled(true);
      // 값이 되돌아간 것을 '고쳤다'고 보고 자동 임시저장이 돌면 방금 지운 것이 되살아난다.
      // 잠긴 뒤라 저장 조건에서 걸러지지만, 비교 기준도 다시 잡아 둔다.
      initialDraftJson.current = null;
      router.refresh();
    } catch (e: any) {
      setError(e.message || s.cancelEditFailed);
    } finally {
      setCancelling(false);
    }
  }

  const actionButton = (
    <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      {submitted && !unlocked ? (
        <span className="submit-locked">{s.lockedNotice}</span>
      ) : (
        <>
          <button className="btn btn-primary" disabled={sending || cancelling} onClick={handleSubmit}>
            {sending ? s.btnSubmitting : s.btnSubmit}
          </button>
          {/* 이미 제출한 조직을 다시 연 경우에만 — 되돌아갈 '원래 값'이 있어야 취소가 뜻을 갖는다. */}
          {submitted && (
            <button className="btn btn-secondary" disabled={sending || cancelling} onClick={handleCancelEdit}>
              {cancelling ? s.cancelEditing : s.btnCancelEdit}
            </button>
          )}
        </>
      )}
      {editable && (
        <span className="field-hint" style={{ margin: 0, color: draftState === "error" ? "#dc2626" : undefined }}>
          {draftState === "saving"
            ? s.draftSaving
            : draftState === "error"
            ? s.draftFailed
            : draftSavedAt
            ? s.draftSaved(fmtTime(draftSavedAt, s.locale))
            : s.draftIdle}
        </span>
      )}
    </div>
  );

  return (
    <div className="panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
        <div>
          <div className="panel-title">
            {data.orgBasis} {showPeriodTag && <span className="tag">{period} · {version}</span>}{" "}
            {submitted ? (
              <span className="status-badge status-confirmed">{s.badgeSubmitted(period)}</span>
            ) : (
              <span className="status-badge" style={{ background: "#f1f5f9", color: "#64748b" }}>
                {s.badgeNotSubmitted}
              </span>
            )}
          </div>
          <div className="panel-sub">
            {s.divisionLabel(data.division)} · {usesPersonTable ? s.unitPersonDetail : s.unitOrgLevel}
            {data.submittedBy ? ` · ${s.submitterPrefix}${data.submittedBy}` : ""}
            {data.latestSubmittedAt ? ` · ${new Date(data.latestSubmittedAt).toLocaleString(s.locale)}` : ""}
          </div>
        </div>
        <div className="field" style={{ minWidth: 200 }}>
          <label>{s.inputterLabel}</label>
          <input
            value={submittedBy}
            onChange={(e) => setSubmittedBy(e.target.value)}
            placeholder={s.namePlaceholder}
            disabled={!editable}
          />
        </div>
      </div>

      {justSubmitted && (
        <div className="callout success" style={{ marginBottom: 12 }}>
          <b>{s.justSubmittedTitle}</b>
          {s.justSubmittedBody}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
        <div className="panel-sub" style={{ fontWeight: 700, color: "#1a202c", margin: 0 }}>
          {s.sectionOrgRate}
        </div>
        {!usesPersonTable && orgEditable && previousOrgRate && (
          <button className="btn btn-secondary btn-sm" onClick={loadPreviousOrgRate}>
            {s.loadPrev}
          </button>
        )}
      </div>
      <div className="tbl-scroll" style={{ marginBottom: 12 }}>
        <table className="rate-tbl">
          <RateTableHead withClear={orgEditable} withNote lang={lang} />
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
                    lang={lang}
                  />
                );
              }
              return orgEditable ? (
                <EditableRateRow
                  key={q}
                  label={s.quarterEditing(period)}
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
                  lang={lang}
                />
              ) : (
                <ReadOnlyRateRow
                  key={q}
                  label={usesPersonTable ? s.quarterAuto(period) : period}
                  rec={toNumRec(computedOrgRates)}
                  headcount={currentOrgHeadcount}
                  withNote
                  note={orgNoteInput || null}
                  lang={lang}
                />
              );
            })}
          </tbody>
        </table>
      </div>
      {!totalOk && (
        <div className="field-hint" style={{ color: "#dc2626", marginBottom: 12 }}>
          {s.totalWarning(period)}
        </div>
      )}

      {usesPersonTable && (
        <>
          <div className="panel-sub" style={{ fontWeight: 700, color: "#1a202c", margin: "0 0 8px" }}>
            {s.sectionPersonRate}
          </div>
          <div className="field-hint" style={{ marginBottom: 8 }}>
            {s.personHint}
          </div>

          <PersonHistoryBlocks rows={beforePersonRows} quarterOrder={personQuarterOrder} hasExpat={false} lang={lang} />

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
            <div className="field-hint" style={{ fontWeight: 700, color: personsEditable ? "#2563eb" : "#1a202c", margin: 0 }}>
              {personsEditable ? s.quarterEditing(period) : s.quarterSubmitted(period)}
            </div>
            {personsEditable && previousPersonsForOrg.length > 0 && (
              <button className="btn btn-secondary btn-sm" onClick={loadPreviousPersons}>
                {s.loadPrevPersons(previousPersonsForOrg.length)}
              </button>
            )}
          </div>
          {personsEditable ? (
            <PersonEditTable persons={persons} setPersons={setPersons} hasExpat={false} lang={lang} />
          ) : (
            <PersonReadOnlyTable persons={persons} hasExpat={false} lang={lang} />
          )}
          {error && <div className="callout alert" style={{ marginTop: 12, marginBottom: 12 }}>{error}</div>}
          {actionButton}
          <PersonHistoryBlocks rows={afterPersonRows} quarterOrder={personQuarterOrder} hasExpat={false} lang={lang} />
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

/**
 * 집계 조직 화면 (개발 그룹·경영지원실 등).
 *
 * 관리자 화면(ParentOrgDetail)과 같은 구성 — 위에 자동계산된 집계 값을 보여주고,
 * 그 아래에 하위 조직 입력란을 모두 펼친다. 조사 링크는 이 조직에 하나만 발급되므로
 * 이 한 화면에서 하위 조직을 모두 입력한다.
 */
function ParentSummary({
  data,
  period,
  version,
  lang,
}: {
  data: SubmitPageData;
  period: string;
  version: string;
  lang: SubmitLang;
}) {
  const s = submitStrings(lang);
  const parent = data.parent!;
  const pastRateHistory = parent.rateHistory.filter((h) => h.quarter !== period);
  const currentRow = parent.rateHistory.find((h) => h.quarter === period) ?? null;

  // 하위 조직 인원수의 합 (관리자 화면의 가중치와 같은 기준: 값이 채워진 개인 행 수 또는 조직 인원수).
  function headcountOf(o: SubmitOrgData): number {
    const fromPersons = o.currentPersons.filter((p) => Object.values(p.rates).reduce((s, v) => s + (v || 0), 0) > 0).length;
    if (fromPersons > 0) return fromPersons;
    return Number(o.submittedHeadcount) || 0;
  }
  const childHeadcount =
    data.orgs.reduce((s, o) => s + headcountOf(o), 0) + data.mirrors.reduce((s, m) => s + m.headcount, 0);
  const submittedChildren = data.orgs.filter((o) => o.submittedThisPeriod).length;

  return (
    <div className="panel">
      <div style={{ marginBottom: 14 }}>
        <div className="panel-title">
          {parent.orgBasis} <span className="tag">{period} · {version}</span>{" "}
          <span className="status-badge" style={{ background: "#eff6ff", color: "#2563eb" }}>
            {s.badgeAggregate}
          </span>{" "}
          <span
            className={`status-badge${submittedChildren === data.orgs.length ? " status-confirmed" : ""}`}
            style={submittedChildren === data.orgs.length ? undefined : { background: "#f1f5f9", color: "#64748b" }}
          >
            {s.childProgress(submittedChildren, data.orgs.length)}
          </span>
        </div>
        <div className="panel-sub">
          {s.divisionLabel(parent.division)} · {s.parentSub(data.parentChildNames.join(" + "))}
        </div>
      </div>

      <div className="tbl-scroll" style={{ marginBottom: 12 }}>
        <table className="rate-tbl">
          <RateTableHead withNote lang={lang} />
          <tbody>
            {orderedQuarters(pastRateHistory.map((h) => h.quarter), period).map((q) =>
              q === period ? (
                <ReadOnlyRateRow
                  key={q}
                  label={s.quarterAuto(period)}
                  rec={currentRow ? currentRow.rates : toNumRec(emptyRates())}
                  headcount={childHeadcount || null}
                  withNote
                  note={currentRow?.note ?? null}
                  lang={lang}
                />
              ) : (
                <ReadOnlyRateRow
                  key={q}
                  label={q}
                  rec={pastRateHistory.find((h) => h.quarter === q)!.rates}
                  headcount={pastRateHistory.find((h) => h.quarter === q)!.headcount ?? null}
                  withNote
                  note={pastRateHistory.find((h) => h.quarter === q)!.note}
                  lang={lang}
                />
              )
            )}
          </tbody>
        </table>
      </div>

      {data.mirrors.map((m) => (
        <div key={m.basis} className="field-hint" style={{ marginBottom: 6 }}>
          {s.mirrorNote(m.basis, m.source, m.headcount)}
        </div>
      ))}

      <div className="field-hint">{s.parentFooter}</div>
    </div>
  );
}

export default function SubmitForm({
  token,
  period,
  version,
  data,
  lang = "ko",
}: {
  token: string;
  period: string;
  version: string;
  data: SubmitPageData;
  /** 담당자가 현지인이라 영어로 나가는 조직이 있다 (판단은 서버에서 — lib/englishOrgs.ts). */
  lang?: SubmitLang;
}) {
  const isParent = !!data.parent;
  const s = submitStrings(lang);

  // 루트 레이아웃의 <html lang>은 한국어로 고정돼 있다 — 영어로 나가는 링크에서는 실제 언어와 맞춰준다
  // (브라우저가 번역을 권하거나 스크린리더가 한국어로 읽는 걸 막는다).
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  return (
    // page-form: 배부대상 13개가 들어가도록 폭을 넓게, submit-tight: 표를 압축해 가로 스크롤을 없앤다.
    <div className="page page-form submit-tight">
      {isParent && <ParentSummary data={data} period={period} version={version} lang={lang} />}

      {isParent && (
        <div className="panel-sub" style={{ fontWeight: 700, color: "#1a202c", margin: "20px 0 12px" }}>
          {s.childSectionTitle(data.orgs.length)}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {data.orgs.map((o) => (
          <OrgSubmitSection
            key={o.orgId}
            token={token}
            period={period}
            version={version}
            data={o}
            showPeriodTag={!isParent}
            lang={lang}
          />
        ))}
      </div>
    </div>
  );
}
