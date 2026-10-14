"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { TARGETS, TargetKey, getPreviousPeriod, inactiveTargetKeys, stripInactiveTargets } from "@/lib/targets";
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
  TargetColumns,
} from "@/components/RateParts";
import type {
  CurrentPerson,
  PersonEditRow,
  PersonHistoryEntry,
  PersonHistoryRow,
  RateHistoryEntry,
  RateMap,
} from "@/components/RateParts";
import { SubmitLang, submitStrings, targetLabel } from "@/lib/submitLang";
import { submitLockState } from "@/lib/submitLock";
import { prettyQuarterLabel, sortQuarters } from "@/lib/quarter";

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

/** 링크에 열린 기간 하나와 그 기간의 화면 데이터. 여러 기간을 함께 조사하면 기간별 탭이 된다. */
export interface SubmitRound {
  period: string;
  data: SubmitPageData;
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
 * 한 조직 · 한 기간의 입력 상태(입력값·임시저장·제출·수정 취소).
 *
 * 26년 4Q와 27년 BP처럼 두 기간을 함께 조사하면 한 조직의 표에 입력 행이 기간마다 하나씩 붙는다.
 * 기간마다 저장되는 곳(임시저장·제출·재수정 허용)이 따로라 상태도 기간마다 따로 둔다.
 * 기간 하나만 조사할 때도 같은 훅을 한 번 쓴다 — 화면 구성이 갈라지지 않게.
 */
function useOrgEntry({
  token,
  period,
  data,
  lang,
}: {
  token: string;
  period: string;
  data: SubmitOrgData;
  lang: SubmitLang;
}) {
  const s = submitStrings(lang);
  const draft = data.draft;
  const router = useRouter();
  // 이번 분기에 배부하지 않는 대상(예: 2026-Q4부터 홀딩스) — 입력을 막고, 불러온 값에서도 뺀다.
  const lockedKeys = inactiveTargetKeys(period);
  const forPeriod = (rates: RateMap) => stripInactiveTargets(rates, period);

  const [submittedBy, setSubmittedBy] = useState(draft?.submittedBy ?? data.submittedBy ?? data.managerName ?? "");
  const [orgRates, setOrgRates] = useState<RateMap>(() =>
    forPeriod(
      draft?.orgRates
        ? ({ ...emptyRates(), ...draft.orgRates } as RateMap)
        : toRateMap(data.currentOrgSubmission ?? data.currentRate)
    )
  );
  // 인원수를 비워두고 제출하면 0명으로 남긴다 (빈칸으로 두지 않는다).
  const [orgHeadcountInput, setOrgHeadcountInput] = useState(
    () => draft?.orgHeadcount ?? String(data.submittedHeadcount ?? 0)
  );
  const [orgNoteInput, setOrgNoteInput] = useState(() => draft?.orgNote ?? data.submittedNote ?? "");
  const [persons, setPersons] = useState<PersonEditRow[]>(
    () => (draft?.persons ?? data.currentPersons.map(personRowFromCurrent)).map((p) => ({ ...p, rates: forPeriod(p.rates) }))
  );

  const [submitted, setSubmitted] = useState(data.submittedThisPeriod);
  // 서버 데이터가 다시 오기 전이라도 곧바로 잠긴 것으로 다뤄야 하는 경우 —
  // '수정 취소'를 눌렀을 때, 그리고 서버가 '이미 제출됨'으로 막았을 때.
  const [forceLocked, setForceLocked] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  // 제출을 마친 뒤에는 **관리자가 열어준 경우에만** 다시 고칠 수 있다.
  //
  // 임시저장본은 '아직 제출 전'이라는 뜻일 때만 잠금을 푼다. 제출한 뒤에 남거나 되살아난
  // 임시저장본까지 잠금을 풀면 제출 잠금이 통째로 무력화된다 — 제출 직후 창을 닫으면
  // pagehide 비콘이 방금 지워진 임시저장본을 다시 만들어 실제로 그렇게 됐다.
  const unlocked = !forceLocked && (data.editAllowed || (!!draft && !data.submittedThisPeriod));
  const [justSubmitted, setJustSubmitted] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(data.draftSavedAt);
  const [draftState, setDraftState] = useState<"idle" | "saving" | "error">("idle");

  const usesPersonTable = data.requiresPersonDetail;
  const isExpatOnlyOrg = isExpatOnly(data.division, data.orgBasis);
  // 입력 가능 여부와 '이미 제출되었습니다' 안내는 함께 계산한다 —
  // 따로 적으면 둘이 어긋나 '안내는 떴는데 표는 고칠 수 있는' 화면이 나온다.
  const { editable, showLockedNotice } = submitLockState({ submitted, unlocked });
  const orgEditable = usesPersonTable ? false : editable;
  const personsEditable = usesPersonTable ? editable : false;

  const prevPeriod = getPreviousPeriod(period);
  const previousPersons = prevPeriod ? data.personHistory.filter((h) => h.period === prevPeriod) : [];
  const previousOrgRate = prevPeriod ? data.rateHistory.find((h) => h.quarter === prevPeriod) ?? null : null;

  const legalPersons = isExpatOnlyOrg ? persons : persons.filter((p) => p.role !== "주재원");
  const computedOrgRates = usesPersonTable ? averageFromPersons(legalPersons) : orgRates;
  const currentOrgHeadcount = usesPersonTable ? namedHeadcountSum(legalPersons) : Number(orgHeadcountInput) || 0;

  const total = totalOf(computedOrgRates);
  const totalOk = Math.abs(total - 1) < 0.005 || total === 0;
  /** 이 기간에 입력한 값이 있는지 — 함께 제출할 때 비워 둔 기간은 건너뛴다. */
  const hasInput = usesPersonTable ? persons.some((p) => p.name.trim() && totalOf(p.rates) > 0) : totalOf(orgRates) > 0;
  // 화면을 연 뒤 이 기간 값을 고쳤는지. 미리 채워진 값(지난 분기 확정값)을 그대로 둔 기간을
  // 다른 기간과 함께 몰래 제출하지 않도록, 제출 전에 따로 확인받는 데 쓴다.
  // 임시저장본이 있으면 담당자가 이미 손댄 기간이다.
  const valuesJson = JSON.stringify({ orgRates, orgHeadcountInput, orgNoteInput, persons });
  const [initialValuesJson] = useState(valuesJson);
  // 불러오기·복사 버튼은 값이 우연히 같아도 '손댄 것'으로 본다 (담당자가 그 기간을 확인했다는 뜻).
  const [actedOn, setActedOn] = useState(false);
  const touched = !!draft || actedOn || valuesJson !== initialValuesJson;

  function updateOrgRate(key: TargetKey, value: string) {
    setOrgRates((r) => ({ ...r, [key]: value }));
  }

  function loadPreviousOrgRate() {
    if (!previousOrgRate) return;
    setActedOn(true);
    setOrgRates(forPeriod(toRateMap(previousOrgRate.rates)));
    setOrgHeadcountInput(previousOrgRate.headcount != null ? String(previousOrgRate.headcount) : "");
    setOrgNoteInput(previousOrgRate.note ?? "");
  }

  function loadPreviousPersons() {
    setActedOn(true);
    setPersons(
      previousPersons.map((p, i) => ({
        key: `prev-${i}-${Date.now()}`,
        name: p.name,
        headcount: p.headcount != null ? String(p.headcount) : "0",
        note: p.note ?? "",
        role: p.role,
        rates: forPeriod(toRateMap(p.rates)),
      }))
    );
  }

  /** 같은 조직의 다른 기간에 지금 입력 중인 값을 그대로 가져온다 (예: 4Q 값을 27년 BP에). */
  function copyFrom(other: { orgRates: RateMap; orgHeadcountInput: string; orgNoteInput: string; persons: PersonEditRow[] }) {
    setActedOn(true);
    setOrgRates(forPeriod({ ...other.orgRates }));
    setOrgHeadcountInput(other.orgHeadcountInput);
    setOrgNoteInput(other.orgNoteInput);
    setPersons(other.persons.map((p, i) => ({ ...p, key: `copy-${i}-${Date.now()}`, rates: forPeriod({ ...p.rates }) })));
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
          body: JSON.stringify({ token, orgId: data.orgId, period, payload: draftPayload() }),
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
      const blob = new Blob([JSON.stringify({ token, orgId: data.orgId, period, payload })], { type: "application/json" });
      navigator.sendBeacon("/api/submissions/draft", blob);
    }
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [token, data.orgId, period]);

  /** 제출 전 검사. 문제가 있으면 안내 문구, 없으면 null. */
  function validate(): string | null {
    if (!submittedBy.trim()) return s.errNoName;
    if (usesPersonTable) {
      const invalid = persons.find((p) => p.name.trim() && !totalIsValid(p.rates));
      if (invalid) return s.errPersonTotal(invalid.name);
    } else if (!totalIsValid(orgRates)) {
      return s.errOrgTotal;
    }
    return null;
  }

  /** 이 기간을 제출한다. 오류 문구를 돌려주고, 성공하면 null. */
  async function submit(): Promise<string | null> {
    try {
      const res = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          orgId: data.orgId,
          period,
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
      // 서버가 '이미 제출됨'으로 막았다면 이 화면의 인식이 낡은 것이다(다른 창에서 먼저 제출한 경우 등).
      // 곧바로 잠근 상태로 맞추고 서버 값을 다시 읽어온다.
      if (res.status === 409 && json?.code === "already-submitted") {
        setSubmitted(true);
        setForceLocked(true);
        return s.lockedNotice;
      }
      // 서버가 돌려주는 오류 문구는 한국어라 영어 링크에서는 쓰지 않는다
      // (합계·입력자 이름은 위에서 이미 걸러지므로 남는 건 통신/저장 실패뿐이다).
      if (!res.ok) return (lang === "ko" && json.error) || s.errSubmit;
      setSubmitted(true);
      setJustSubmitted(true);
      setDraftSavedAt(null);
      return null;
    } catch (e: any) {
      return e?.message || s.errSubmit;
    }
  }

  /**
   * 재수정을 그만둔다. 서버가 임시저장본과 재수정 허용 표식을 지우고, 화면은 제출된 값으로 되돌린다.
   * 되돌아갈 값은 서버가 이미 넘겨준 data.*(= 제출된 값)라 따로 받아올 것이 없다.
   */
  async function cancelEdit(): Promise<string | null> {
    setCancelling(true);
    try {
      const res = await fetch("/api/submissions/cancel-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, orgId: data.orgId, period }),
      });
      const json = await res.json();
      if (!res.ok) return (lang === "ko" && json.error) || s.cancelEditFailed;

      setSubmittedBy(data.submittedBy ?? data.managerName ?? "");
      setOrgRates(forPeriod(toRateMap(data.currentOrgSubmission ?? data.currentRate)));
      setOrgHeadcountInput(String(data.submittedHeadcount ?? 0));
      setOrgNoteInput(data.submittedNote ?? "");
      setPersons(data.currentPersons.map(personRowFromCurrent).map((p) => ({ ...p, rates: forPeriod(p.rates) })));
      setJustSubmitted(false);
      setDraftSavedAt(null);
      setSubmitted(true);
      setForceLocked(true);
      // 값이 되돌아간 것을 '고쳤다'고 보고 자동 임시저장이 돌면 방금 지운 것이 되살아난다.
      initialDraftJson.current = null;
      router.refresh();
      return null;
    } catch (e: any) {
      return e?.message || s.cancelEditFailed;
    } finally {
      setCancelling(false);
    }
  }

  return {
    period,
    data,
    lockedKeys,
    submittedBy,
    setSubmittedBy,
    orgRates,
    setOrgRates,
    updateOrgRate,
    orgHeadcountInput,
    setOrgHeadcountInput,
    orgNoteInput,
    setOrgNoteInput,
    persons,
    setPersons,
    submitted,
    cancelling,
    justSubmitted,
    draftSavedAt,
    draftState,
    usesPersonTable,
    isExpatOnlyOrg,
    editable,
    showLockedNotice,
    orgEditable,
    personsEditable,
    previousOrgRate,
    previousPersons,
    computedOrgRates,
    currentOrgHeadcount,
    totalOk,
    hasInput,
    touched,
    loadPreviousOrgRate,
    loadPreviousPersons,
    copyFrom,
    validate,
    submit,
    cancelEdit,
  };
}

type OrgEntry = ReturnType<typeof useOrgEntry>;

/**
 * 조직 하나의 입력 구역.
 *
 * 관리자 '검토 및 확정 > 리소스배부율'의 조직 상세(OrgDetail)와 같은 구성이다
 * (같은 표 컴포넌트를 @/components/RateParts에서 함께 쓴다).
 * 두 기간을 함께 조사하면 지난 분기 이력은 한 번만 보이고, 그 아래에 기간마다 입력 행이 붙는다 —
 * 기간별로 구역을 따로 그리면 같은 이력이 두 번 나와 읽기 어렵다.
 * 제출하기는 하나다 — 값을 넣은 기간을 모두 제출한다.
 */
function OrgSubmitSection({
  token,
  entries: entryData,
  version,
  showPeriodTag,
  lang,
}: {
  token: string;
  /** 기간마다의 이 조직 데이터 (기간 순서대로). 조사 중인 기간 수는 화면을 여는 동안 바뀌지 않는다. */
  entries: { period: string; data: SubmitOrgData }[];
  version: string;
  /** 조직이 하나뿐인 화면에서는 제목 옆에 분기를 함께 보여준다 (집계 화면은 맨 위에 이미 있다). */
  showPeriodTag: boolean;
  lang: SubmitLang;
}) {
  const s = submitStrings(lang);
  const router = useRouter();
  // 기간 수는 서버가 정해 내려주고 화면을 여는 동안 바뀌지 않으므로, 훅을 기간마다 한 번씩 불러도 순서가 고정된다.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const entries: OrgEntry[] = entryData.map((e) => useOrgEntry({ token, period: e.period, data: e.data, lang }));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const first = entries[0];
  const data = first.data;
  const multi = entries.length > 1;
  const periods = entries.map((e) => e.period);
  const usesPersonTable = first.usesPersonTable;
  const isExpatOnlyOrg = first.isExpatOnlyOrg;
  const anyEditable = entries.some((e) => e.editable);
  const anyOrgEditable = entries.some((e) => e.orgEditable);
  const allLocked = entries.every((e) => e.showLockedNotice);

  // 지난 분기 이력은 한 번만 — 지금 입력하는 기간들은 아래 입력 행으로 그린다.
  const pastRateHistory = data.rateHistory.filter((h) => !periods.includes(h.quarter));
  const pastPersonHistory = data.personHistory.filter((h) => !periods.includes(h.period));
  const quarterOrder = sortQuarters(Array.from(new Set([...pastRateHistory.map((h) => h.quarter), ...periods])));
  const personOrder = sortQuarters(Array.from(new Set([...quarterOrder, ...pastPersonHistory.map((h) => h.period)])));
  const firstIdx = personOrder.indexOf(periods[0]);
  const lastIdx = personOrder.indexOf(periods[periods.length - 1]);
  const personRowSort = (a: PersonHistoryRow, b: PersonHistoryRow) => personOrder.indexOf(a.period) - personOrder.indexOf(b.period);
  const beforePersonRows = pastPersonHistory.filter((r) => personOrder.indexOf(r.period) < firstIdx).sort(personRowSort);
  const afterPersonRows = pastPersonHistory.filter((r) => personOrder.indexOf(r.period) > lastIdx).sort(personRowSort);

  const lockedNoteKeys = Array.from(new Set(entries.filter((e) => e.editable).flatMap((e) => e.lockedKeys)));
  const lockedNoteLabels = TARGETS.filter((t) => lockedNoteKeys.includes(t.key)).map((t) => targetLabel(t, lang)).join(", ");

  function setSubmitter(v: string) {
    entries.forEach((e) => e.setSubmittedBy(v));
  }

  async function handleSubmit() {
    setError("");
    // 함께 제출할 기간: 열려 있고 값을 넣은 기간. 기간이 하나뿐이면 예전처럼 그대로 제출한다.
    const targets = entries.filter((e) => e.editable);
    // 두 기간을 함께 조사할 때는 열린 기간을 모두 고쳐야 제출된다 — 미리 채워진 지난 분기 값을
    // 그대로 둔 기간이 함께 제출되어 잠기면 안 된다(4Q만 고치고 눌러 27년 BP가 지난 값으로 나가는 일).
    if (multi) {
      const untouched = targets.filter((e) => !e.touched);
      if (untouched.length > 0) {
        setError(s.errMustEditAll(untouched.map((e) => prettyQuarterLabel(e.period)).join(", ")));
        return;
      }
    }
    if (targets.length === 0) {
      setError(s.errNothingToSubmit);
      return;
    }
    for (const e of targets) {
      const problem = e.validate();
      if (problem) {
        setError(multi ? `${prettyQuarterLabel(e.period)}: ${problem}` : problem);
        return;
      }
    }
    setSending(true);
    const failures: string[] = [];
    for (const e of targets) {
      const problem = await e.submit();
      if (problem) failures.push(multi ? `${prettyQuarterLabel(e.period)}: ${problem}` : problem);
    }
    setSending(false);
    if (failures.length) setError(failures.join(" / "));
    // 제출과 함께 서버가 재제출 허용 표식을 지운다 — 새로 읽어와 잠긴 상태로 되돌린다.
    router.refresh();
  }

  async function handleCancelEdit(e: OrgEntry) {
    if (!window.confirm(s.cancelEditConfirm)) return;
    setError("");
    const problem = await e.cancelEdit();
    if (problem) setError(problem);
  }

  const draftState = entries.some((e) => e.draftState === "saving")
    ? "saving"
    : entries.some((e) => e.draftState === "error")
    ? "error"
    : "idle";
  const draftSavedAt = entries.map((e) => e.draftSavedAt).filter((x): x is string => !!x).sort().pop() ?? null;

  const actionButton = (
    <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      {allLocked ? (
        <span className="submit-locked">{s.lockedNotice}</span>
      ) : (
        <>
          {anyEditable && (
            <button className="btn btn-primary" disabled={sending || entries.some((e) => e.cancelling)} onClick={handleSubmit}>
              {sending ? s.btnSubmitting : s.btnSubmit}
            </button>
          )}
          {/* 이미 제출한 기간을 다시 연 경우에만 — 되돌아갈 '원래 값'이 있어야 취소가 뜻을 갖는다. */}
          {entries
            .filter((e) => e.editable && e.submitted)
            .map((e) => (
              <button key={e.period} className="btn btn-secondary" disabled={sending || e.cancelling} onClick={() => handleCancelEdit(e)}>
                {e.cancelling ? s.cancelEditing : multi ? `${prettyQuarterLabel(e.period)} ${s.btnCancelEdit}` : s.btnCancelEdit}
              </button>
            ))}
          {/* 일부 기간만 잠겨 있으면 어느 기간인지 알려준다. */}
          {multi &&
            entries
              .filter((e) => e.showLockedNotice)
              .map((e) => (
                <span key={e.period} className="field-hint" style={{ margin: 0 }}>
                  {s.periodLocked(prettyQuarterLabel(e.period))}
                </span>
              ))}
        </>
      )}
      {anyEditable && (
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

  /** 표에 붙는 기간 하나의 입력 행 (입력 가능하면 입력칸, 아니면 제출된 값). */
  function entryRow(e: OrgEntry) {
    const label = e.usesPersonTable ? s.quarterAuto(e.period) : e.editable ? s.quarterEditing(e.period) : e.period;
    return e.orgEditable ? (
      <EditableRateRow
        key={e.period}
        label={label}
        rates={e.orgRates}
        onChange={e.updateOrgRate}
        headcount={e.currentOrgHeadcount}
        onClear={() => e.setOrgRates(emptyRates())}
        headcountEditable
        headcountValue={e.orgHeadcountInput}
        onHeadcountChange={e.setOrgHeadcountInput}
        withNote
        noteValue={e.orgNoteInput}
        onNoteChange={e.setOrgNoteInput}
        lockedKeys={e.lockedKeys}
        lang={lang}
      />
    ) : (
      <ReadOnlyRateRow
        key={e.period}
        label={label}
        period={e.period}
        rec={toNumRec(e.computedOrgRates)}
        headcount={e.currentOrgHeadcount}
        showClearSlot={anyOrgEditable}
        withNote
        note={e.orgNoteInput || null}
        lang={lang}
      />
    );
  }

  /** 기간 하나의 불러오기 버튼 — 첫 기간은 전분기 확정값, 다음 기간은 바로 앞 기간에 지금 넣은 값. */
  function loadButton(e: OrgEntry, i: number) {
    if (usesPersonTable ? !e.personsEditable : !e.orgEditable) return null;
    // 전분기 끌고오기는 첫 기간(4Q)에만 둔다. 뒤 기간(27년 BP)은 앞 기간에 지금 넣은 값을 복사하는 버튼만 둔다
    // — BP는 4Q 입력값을 바탕으로 고쳐 넣는다(사용자 지시).
    const prev = i > 0 ? entries[i - 1] : null;
    const prefix = multi ? `${prettyQuarterLabel(e.period)}: ` : "";
    const loadBtn = usesPersonTable
      ? e.previousPersons.length > 0 && (
          <button className="btn btn-secondary btn-sm" onClick={e.loadPreviousPersons}>
            {prefix}
            {s.loadPrevPersons(e.previousPersons.length)}
          </button>
        )
      : e.previousOrgRate && (
          <button className="btn btn-secondary btn-sm" onClick={e.loadPreviousOrgRate}>
            {prefix}
            {s.loadPrev}
          </button>
        );
    return (
      <span key={e.period} style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
        {!prev && loadBtn}
        {prev && (
          <button className="btn btn-secondary btn-sm" onClick={() => e.copyFrom(prev)}>
            {s.copyFromPeriod(prettyQuarterLabel(prev.period), prettyQuarterLabel(e.period))}
          </button>
        )}
      </span>
    );
  }

  return (
    // 보일 열은 입력하는 기간 모두를 기준으로 — 4Q·BP 둘 다 없는 홀딩스는 감추고, 4Q에 남은 건물은 그린다.
    <TargetColumns periods={personOrder} current={periods}>
      <div className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
          <div>
            <div className="panel-title">
              {data.orgBasis}{" "}
              {showPeriodTag && (
                <span className="tag">
                  {periods.map(prettyQuarterLabel).join(" & ")} · {version}
                </span>
              )}{" "}
              {entries.map((e) =>
                e.submitted ? (
                  <span key={e.period} className="status-badge status-confirmed" style={{ marginRight: 4 }}>
                    {s.badgeSubmitted(e.period)}
                  </span>
                ) : (
                  <span key={e.period} className="status-badge" style={{ background: "#f1f5f9", color: "#64748b", marginRight: 4 }}>
                    {multi ? `${s.badgeNotSubmitted} (${e.period})` : s.badgeNotSubmitted}
                  </span>
                )
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
              value={first.submittedBy}
              onChange={(ev) => setSubmitter(ev.target.value)}
              placeholder={s.namePlaceholder}
              disabled={!anyEditable}
            />
          </div>
        </div>

        {entries.some((e) => e.justSubmitted) && (
          <div className="callout success" style={{ marginBottom: 12 }}>
            <b>{s.justSubmittedTitle}</b>
            {s.justSubmittedBody}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
          <div className="panel-sub" style={{ fontWeight: 700, color: "#1a202c", margin: 0 }}>
            {s.sectionOrgRate}
          </div>
          {!usesPersonTable && <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{entries.map(loadButton)}</div>}
        </div>
        <div className="tbl-scroll" style={{ marginBottom: 12 }}>
          <table className="rate-tbl">
            <RateTableHead withClear={anyOrgEditable} withNote lang={lang} />
            <tbody>
              {quarterOrder.map((q) => {
                const e = entries.find((x) => x.period === q);
                if (e) return entryRow(e);
                const h = pastRateHistory.find((x) => x.quarter === q)!;
                return (
                  <ReadOnlyRateRow
                    key={q}
                    label={h.quarter}
                    period={h.quarter}
                    rec={h.rates}
                    headcount={
                      usesPersonTable
                        ? personHeadcountForQuarter(data.personHistory, h.quarter, isExpatOnlyOrg ? "all" : "legal")
                        : h.headcount
                    }
                    showClearSlot={anyOrgEditable}
                    withNote
                    note={h.note}
                    lang={lang}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
        {entries
          .filter((e) => !e.totalOk)
          .map((e) => (
            <div key={e.period} className="field-hint" style={{ color: "#dc2626", marginBottom: 12 }}>
              {s.totalWarning(e.period)}
            </div>
          ))}
        {lockedNoteKeys.length > 0 && (
          <div className="field-hint" style={{ marginBottom: 12 }}>
            {s.inactiveTargetsNote(lockedNoteLabels)}
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

            <PersonHistoryBlocks rows={beforePersonRows} quarterOrder={personOrder} hasExpat={false} lang={lang} />

            {entries.map((e, i) => (
              <div key={e.period}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                  <div className="field-hint" style={{ fontWeight: 700, color: e.personsEditable ? "#2563eb" : "#1a202c", margin: 0 }}>
                    {e.personsEditable ? s.quarterEditing(e.period) : s.quarterSubmitted(e.period)}
                  </div>
                  {loadButton(e, i)}
                </div>
                {e.personsEditable ? (
                  <PersonEditTable persons={e.persons} setPersons={e.setPersons} hasExpat={false} lockedKeys={e.lockedKeys} lang={lang} />
                ) : (
                  <PersonReadOnlyTable persons={e.persons} hasExpat={false} period={e.period} lang={lang} />
                )}
              </div>
            ))}
            {error && <div className="callout alert" style={{ marginTop: 12, marginBottom: 12 }}>{error}</div>}
            {actionButton}
            <PersonHistoryBlocks rows={afterPersonRows} quarterOrder={personOrder} hasExpat={false} lang={lang} />
          </>
        )}

        {!usesPersonTable && (
          <>
            {error && <div className="callout alert" style={{ marginTop: 12, marginBottom: 12 }}>{error}</div>}
            {actionButton}
          </>
        )}
      </div>
    </TargetColumns>
  );
}

/**
 * 집계 조직 화면 (개발 그룹·경영지원실 등).
 *
 * 관리자 화면(ParentOrgDetail)과 같은 구성 — 위에 자동계산된 집계 값을 보여주고,
 * 그 아래에 하위 조직 입력란을 모두 펼친다. 조사 링크는 이 조직에 하나만 발급되므로
 * 이 한 화면에서 하위 조직을 모두 입력한다. 두 기간을 함께 조사하면 자동계산 행이 기간마다 붙는다.
 */
function ParentSummary({ rounds, version, lang }: { rounds: SubmitRound[]; version: string; lang: SubmitLang }) {
  const s = submitStrings(lang);
  const periods = rounds.map((r) => r.period);
  const parent = rounds[0].data.parent!;
  const pastRateHistory = parent.rateHistory.filter((h) => !periods.includes(h.quarter));
  const quarterOrder = sortQuarters(Array.from(new Set([...pastRateHistory.map((h) => h.quarter), ...periods])));

  // 하위 조직 인원수의 합 (관리자 화면의 가중치와 같은 기준: 값이 채워진 개인 행 수 또는 조직 인원수).
  function headcountOf(o: SubmitOrgData): number {
    const fromPersons = o.currentPersons.filter((p) => Object.values(p.rates).reduce((s, v) => s + (v || 0), 0) > 0).length;
    if (fromPersons > 0) return fromPersons;
    return Number(o.submittedHeadcount) || 0;
  }
  const childHeadcountOf = (d: SubmitPageData) =>
    d.orgs.reduce((s, o) => s + headcountOf(o), 0) + d.mirrors.reduce((s, m) => s + m.headcount, 0);
  const first = rounds[0].data;

  return (
    <TargetColumns periods={quarterOrder} current={periods}>
      <div className="panel">
        <div style={{ marginBottom: 14 }}>
          <div className="panel-title">
            {parent.orgBasis}{" "}
            <span className="tag">
              {periods.map(prettyQuarterLabel).join(" & ")} · {version}
            </span>{" "}
            <span className="status-badge" style={{ background: "#eff6ff", color: "#2563eb" }}>
              {s.badgeAggregate}
            </span>{" "}
            {rounds.map((r) => {
              const done = r.data.orgs.filter((o) => o.submittedThisPeriod).length;
              const all = done === r.data.orgs.length;
              return (
                <span
                  key={r.period}
                  className={`status-badge${all ? " status-confirmed" : ""}`}
                  style={{ marginRight: 4, ...(all ? {} : { background: "#f1f5f9", color: "#64748b" }) }}
                >
                  {rounds.length > 1 ? `${prettyQuarterLabel(r.period)} ` : ""}
                  {s.childProgress(done, r.data.orgs.length)}
                </span>
              );
            })}
          </div>
          <div className="panel-sub">
            {s.divisionLabel(parent.division)} · {s.parentSub(first.parentChildNames.join(" + "))}
          </div>
        </div>

        <div className="tbl-scroll" style={{ marginBottom: 12 }}>
          <table className="rate-tbl">
            <RateTableHead withNote lang={lang} />
            <tbody>
              {quarterOrder.map((q) => {
                const r = rounds.find((x) => x.period === q);
                if (r) {
                  const currentRow = r.data.parent!.rateHistory.find((h) => h.quarter === q) ?? null;
                  return (
                    <ReadOnlyRateRow
                      key={q}
                      label={s.quarterAuto(q)}
                      period={q}
                      rec={currentRow ? currentRow.rates : toNumRec(emptyRates())}
                      headcount={childHeadcountOf(r.data) || null}
                      withNote
                      note={currentRow?.note ?? null}
                      lang={lang}
                    />
                  );
                }
                const h = pastRateHistory.find((x) => x.quarter === q)!;
                return (
                  <ReadOnlyRateRow
                    key={q}
                    label={q}
                    period={q}
                    rec={h.rates}
                    headcount={h.headcount ?? null}
                    withNote
                    note={h.note}
                    lang={lang}
                  />
                );
              })}
            </tbody>
          </table>
        </div>

        {first.mirrors.map((m) => (
          <div key={m.basis} className="field-hint" style={{ marginBottom: 6 }}>
            {s.mirrorNote(m.basis, m.source, m.headcount)}
          </div>
        ))}

        <div className="field-hint">{s.parentFooter}</div>
      </div>
    </TargetColumns>
  );
}

export default function SubmitForm({
  token,
  rounds,
  version,
  lang = "ko",
}: {
  token: string;
  /** 링크에 열린 기간들 (기간 순서대로). 26년 4Q & 27년 BP처럼 둘이면 조직마다 입력 행이 둘 붙는다. */
  rounds: SubmitRound[];
  version: string;
  /** 담당자가 현지인이라 영어로 나가는 조직이 있다 (판단은 서버에서 — lib/englishOrgs.ts). */
  lang?: SubmitLang;
}) {
  const s = submitStrings(lang);

  // 루트 레이아웃의 <html lang>은 한국어로 고정돼 있다 — 영어로 나가는 링크에서는 실제 언어와 맞춰준다
  // (브라우저가 번역을 권하거나 스크린리더가 한국어로 읽는 걸 막는다).
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const multi = rounds.length > 1;
  const base = rounds[0].data;
  const isParent = !!base.parent;

  return (
    // page-form: 배부대상 13~14개가 들어가도록 폭을 넓게, submit-tight: 표를 압축해 가로 스크롤을 없앤다.
    <div className="page page-form submit-tight">
      {multi && (
        <div className="callout info" style={{ marginBottom: 16 }}>
          {s.multiRoundHint(rounds.map((r) => prettyQuarterLabel(r.period)).join(", "))}
        </div>
      )}

      {isParent && <ParentSummary rounds={rounds} version={version} lang={lang} />}

      {isParent && (
        <div className="panel-sub" style={{ fontWeight: 700, color: "#1a202c", margin: "20px 0 12px" }}>
          {s.childSectionTitle(base.orgs.length)}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {base.orgs.map((o) => (
          <OrgSubmitSection
            key={o.orgId}
            token={token}
            entries={rounds
              .map((r) => ({ period: r.period, data: r.data.orgs.find((x) => x.orgId === o.orgId) }))
              .filter((e): e is { period: string; data: SubmitOrgData } => !!e.data)}
            version={version}
            showPeriodTag={!isParent}
            lang={lang}
          />
        ))}
      </div>
    </div>
  );
}
