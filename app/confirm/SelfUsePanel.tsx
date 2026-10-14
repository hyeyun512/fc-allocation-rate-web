"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { TARGETS, TargetKey, getPreviousPeriod } from "@/lib/targets";
import { prettyQuarterLabel, sortQuarters } from "@/lib/quarter";
import {
  BUNDANG_SELFUSE_2_QUARTERS,
  computeSelfuseRates,
  hasBundangSelfuse2,
  SelfuseBasisInput,
} from "@/lib/selfuseBasis";
import { RateTableHead, ReadOnlyRateRow, NoteTip } from "@/components/RateParts";
import { readPasteGrid, shouldHandlePaste } from "@/lib/paste";

export interface SelfuseBasisRow {
  quarter: string;
  bundang_selfuse_ratio: number;
  /** 이사로 분당 건물이 둘인 분기에만 값이 있다. 그 외에는 null. */
  bundang_selfuse_ratio_2: number | null;
  yongin_selfuse_ratio: number;
  biz_dev_media_headcount: number;
  staff_headcount: number;
  hq_total_headcount: number;
  material_evcs_domestic_ratio: number;
  material_evcs_overseas_ratio: number;
  submitted_by: string | null;
  confirmed_at: string | null;
  note: string | null;
}

type FieldKey = keyof SelfuseBasisInput;

type FormState = Record<FieldKey, string>;

interface FieldDef {
  key: FieldKey;
  /** 머리글 윗줄 묶음 — 같은 묶음이 이어지면 윗줄 칸을 합친다. 아랫줄에는 label만 적는다. */
  group: string;
  label: string;
  /** 직접 입력받지 않고 다른 값에서 계산해 채우는 칸. */
  derived?: boolean;
  /** 이사로 분당 건물이 둘인 분기에만 서는 칸. */
  bundang2?: boolean;
}

const FIELDS: FieldDef[] = [
  { key: "bundangSelfuseRatio", group: "자가사용비율(%)", label: "분당" },
  { key: "bundangSelfuseRatio2", group: "자가사용비율(%)", label: "분당2", bundang2: true },
  { key: "yonginSelfuseRatio", group: "자가사용비율(%)", label: "용인" },
  // 본사 총 인원수에서 Staff부문을 뺀 나머지 — 직접 입력받지 않고 계산해서 채운다.
  { key: "bizDevMediaHeadcount", group: "본사 인원수(명)", label: "사업+개발+Media그룹", derived: true },
  { key: "staffHeadcount", group: "본사 인원수(명)", label: "Staff부문" },
  { key: "hqTotalHeadcount", group: "본사 인원수(명)", label: "본사 총" },
  { key: "materialEvcsDomesticRatio", group: "용인 재료비 비율(%)", label: "EVCS(국내)" },
  { key: "materialEvcsOverseasRatio", group: "용인 재료비 비율(%)", label: "EVCS(해외)" },
];

const EMPTY_FORM: FormState = {
  bundangSelfuseRatio: "",
  bundangSelfuseRatio2: "",
  yonginSelfuseRatio: "",
  bizDevMediaHeadcount: "",
  staffHeadcount: "",
  hqTotalHeadcount: "",
  materialEvcsDomesticRatio: "",
  materialEvcsOverseasRatio: "",
};

function fromRow(row: SelfuseBasisRow | null): FormState {
  if (!row) return { ...EMPTY_FORM };
  return {
    bundangSelfuseRatio: String((row.bundang_selfuse_ratio ?? 0) * 100),
    // 없던 분기에서 끌어오면 빈칸으로 둔다 — 0%로 채우면 '입력했는데 0'과 구분되지 않는다.
    bundangSelfuseRatio2: row.bundang_selfuse_ratio_2 == null ? "" : String(row.bundang_selfuse_ratio_2 * 100),
    yonginSelfuseRatio: String((row.yongin_selfuse_ratio ?? 0) * 100),
    bizDevMediaHeadcount: String(row.biz_dev_media_headcount ?? ""),
    staffHeadcount: String(row.staff_headcount ?? ""),
    hqTotalHeadcount: String(row.hq_total_headcount ?? ""),
    materialEvcsDomesticRatio: String((row.material_evcs_domestic_ratio ?? 0) * 100),
    materialEvcsOverseasRatio: String((row.material_evcs_overseas_ratio ?? 0) * 100),
  };
}

function toBasisInput(f: FormState): SelfuseBasisInput {
  return {
    bundangSelfuseRatio: (Number(f.bundangSelfuseRatio) || 0) / 100,
    // 빈칸은 null로 남긴다 — 0을 넣은 것과 구분해야 미리보기에 없는 행이 생기지 않는다.
    bundangSelfuseRatio2: f.bundangSelfuseRatio2.trim() === "" ? null : (Number(f.bundangSelfuseRatio2) || 0) / 100,
    yonginSelfuseRatio: (Number(f.yonginSelfuseRatio) || 0) / 100,
    bizDevMediaHeadcount: Number(f.bizDevMediaHeadcount) || 0,
    staffHeadcount: Number(f.staffHeadcount) || 0,
    hqTotalHeadcount: Number(f.hqTotalHeadcount) || 0,
    materialEvcsDomesticRatio: (Number(f.materialEvcsDomesticRatio) || 0) / 100,
    materialEvcsOverseasRatio: (Number(f.materialEvcsOverseasRatio) || 0) / 100,
  };
}

function toFullRec(rates: Partial<Record<TargetKey, number>>): Record<TargetKey, number> {
  const r = {} as Record<TargetKey, number>;
  TARGETS.forEach((t) => (r[t.key] = rates[t.key] ?? 0));
  return r;
}

/**
 * 기준정보 표 한 칸의 표시값. 머리글과 행이 같은 FIELDS를 보고 그려져 열 수가 어긋날 수 없다.
 * Record<FieldKey, string>이라 칸을 새로 추가하고 여기를 빠뜨리면 컴파일이 막힌다.
 */
function cellText(f: FieldDef, row: SelfuseBasisRow): string {
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const byKey: Record<FieldKey, string> = {
    bundangSelfuseRatio: pct(row.bundang_selfuse_ratio),
    // 건물이 하나였던 분기에는 값 자체가 없다. 0%로 보이면 '0으로 입력했다'로 읽히므로 비운다.
    bundangSelfuseRatio2: row.bundang_selfuse_ratio_2 == null ? "-" : pct(row.bundang_selfuse_ratio_2),
    yonginSelfuseRatio: pct(row.yongin_selfuse_ratio),
    bizDevMediaHeadcount: String(row.biz_dev_media_headcount),
    staffHeadcount: String(row.staff_headcount),
    hqTotalHeadcount: String(row.hq_total_headcount),
    materialEvcsDomesticRatio: pct(row.material_evcs_domestic_ratio),
    materialEvcsOverseasRatio: pct(row.material_evcs_overseas_ratio),
  };
  return byKey[f.key];
}
/**
 * 기간 하나의 자가사용 기준정보 입력 상태.
 * 26년 4Q와 27년 BP처럼 두 기간을 함께 검토하면 같은 표에 기간마다 입력 행이 붙고, 저장도 기간마다 따로 된다
 * (/api/selfuse-basis의 quarter).
 */
function useSelfuseEntry(period: string, initial: SelfuseBasisRow | null) {
  const [form, setForm] = useState<FormState>(() => fromRow(initial));
  // 기준정보 표의 맨 오른쪽 코멘트. IT 탭과 달리 저장 버튼이 하나뿐이라 값과 함께 저장한다.
  const [note, setNote] = useState(initial?.note ?? "");
  // 이미 확정된 분기를 '입력중'으로 보여주면 아직 안 한 것처럼 보인다 — 확정 상태면 읽기 전용으로 두고
  // '수정'을 눌렀을 때만 다시 입력할 수 있게 한다.
  const [confirmed, setConfirmed] = useState(!!initial?.confirmed_at);
  const [unlocked, setUnlocked] = useState(false);
  const editable = !confirmed || unlocked;

  // 사업+개발+Media그룹 인원수 = 본사 총 인원수 - Staff부문 인원수 (음수는 0으로).
  const derivedBizDevMedia = String(Math.max(0, (Number(form.hqTotalHeadcount) || 0) - (Number(form.staffHeadcount) || 0)));
  const input = toBasisInput({ ...form, bizDevMediaHeadcount: derivedBizDevMedia });
  const preview = useMemo(() => computeSelfuseRates(input, period), [JSON.stringify(input), period]);

  // 지금 입력 중인 분기가 이사 기간인가 — 열은 서 있어도 이 분기 것이 아니면 입력칸을 두지 않는다.
  const hasBundang2 = hasBundangSelfuse2(period);
  const canEditField = (f: FieldDef) => !f.derived && !(f.bundang2 && !hasBundang2);
  // 빈 화면에서 저장이 눌리면 자가사용비율 0 → '건물 100%'짜리 배부율이 만들어져,
  // 열어본 적도 없는 분기가 View에 확정된 것처럼 남는다.
  const hasInput = Object.values(input).some((v) => (v ?? 0) > 0);
  // 두 기간을 함께 검토할 때는 이 화면에서 값을 바꾼 기간만 저장한다 — 손대지 않은 기간을 다시 저장하면
  // 그 기간의 확정 시각·입력자가 덮어써진다. 처음 불러온 값(또는 마지막 저장값)과 비교한다.
  const currentJson = JSON.stringify({ form, note });
  const snapshotRef = useRef<string | null>(null);
  if (snapshotRef.current === null) snapshotRef.current = currentJson;
  const dirty = currentJson !== snapshotRef.current;

  /** 이 분기의 입력값을 과거 행과 같은 모양으로 본 것. 확정 후 읽기 전용 행에 그대로 쓴다. */
  function asRow(submittedBy: string): SelfuseBasisRow {
    return {
      quarter: period,
      bundang_selfuse_ratio: input.bundangSelfuseRatio,
      bundang_selfuse_ratio_2: hasBundang2 ? input.bundangSelfuseRatio2 : null,
      yongin_selfuse_ratio: input.yonginSelfuseRatio,
      biz_dev_media_headcount: input.bizDevMediaHeadcount,
      staff_headcount: input.staffHeadcount,
      hq_total_headcount: input.hqTotalHeadcount,
      material_evcs_domestic_ratio: input.materialEvcsDomesticRatio,
      material_evcs_overseas_ratio: input.materialEvcsOverseasRatio,
      submitted_by: initial?.submitted_by ?? submittedBy,
      confirmed_at: initial?.confirmed_at ?? null,
      note,
    };
  }

  /** 이 분기를 저장한다. 실패하면 던진다. */
  async function save(submittedBy: string) {
    const res = await fetch("/api/selfuse-basis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quarter: period, input, submittedBy: submittedBy || null, note: note.trim() || null }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "확정 처리 중 오류가 발생했습니다.");
    setConfirmed(true);
    setUnlocked(false);
    snapshotRef.current = currentJson;
  }

  return {
    period,
    form,
    setForm,
    note,
    setNote,
    editable,
    setUnlocked,
    derivedBizDevMedia,
    preview,
    hasBundang2,
    canEditField,
    hasInput,
    dirty,
    asRow,
    save,
  };
}

type SelfuseEntry = ReturnType<typeof useSelfuseEntry>;

export default function SelfUsePanel({
  periods,
  history,
  onUntouchedChange,
  partnerUntouched,
}: {
  /** 이번 라운드의 기간들 (기간 순서대로). 묶음 라운드(26년 4Q & 27년 BP)면 기간마다 입력 행이 붙는다. */
  periods: string[];
  history: SelfuseBasisRow[];
  /** 아직 고치지 않은 열린 기간(표기)을 알린다 — 같은 라운드의 건물 표(BuildingPanel)가 저장 전에 본다. */
  onUntouchedChange?: (labels: string[]) => void;
  /**
   * 같은 라운드의 다른 표(27년 BP 건물)에서 아직 고치지 않은 열린 기간. 넘어오면 두 표가 한 라운드라는 뜻이고,
   * 한 표 안의 여러 기간과 같은 규칙(열린 기간을 모두 고쳐야 저장)을 표를 건너 적용한다.
   */
  partnerUntouched?: string[];
}) {
  const initialOf = (p: string) => history.find((h) => h.quarter === p) ?? null;
  // 기간 수는 라운드가 정하고 화면을 여는 동안 바뀌지 않으므로, 훅을 기간마다 한 번씩 불러도 순서가 고정된다.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const entries: SelfuseEntry[] = periods.map((p) => useSelfuseEntry(p, initialOf(p)));
  // 다른 표와 함께 저장 규칙을 지켜야 하면(4Q 자가사용 + BP 건물) 기간이 하나여도 여러 기간 라운드로 본다.
  const multi = entries.length > 1 || partnerUntouched !== undefined;
  const untouchedLabels = entries.filter((e) => e.editable && !e.dirty).map((e) => prettyQuarterLabel(e.period));
  const untouchedKey = untouchedLabels.join(",");
  useEffect(() => {
    onUntouchedChange?.(untouchedLabels);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [untouchedKey]);
  // 입력자는 한 사람이 라운드의 기간을 함께 입력하므로 하나만 받고, 이번에 저장하는 기간에만 실어 보낸다.
  // 기간마다 저장된 입력자가 서로 다르면 어느 쪽인지 알 수 없으므로 비워 두고 새로 적게 한다.
  const [submittedBy, setSubmittedBy] = useState(() => {
    const names = Array.from(new Set(periods.map((p) => initialOf(p)?.submitted_by).filter((x): x is string => !!x)));
    return names.length === 1 ? names[0] : "";
  });
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");

  // 확정된 분기 전체. 현재 라운드가 1Q여도 이미 확정된 2Q가 남아 있을 수 있어(뒤 분기를 먼저 확정할 수 있다)
  // '과거'로 걸러내지 않고 그대로 모두 보여준다.
  const confirmedHistory = useMemo(() => [...history].sort((a, b) => a.quarter.localeCompare(b.quarter)), [history]);
  // 위 기준정보 표에서는 이번 라운드 기간들을 입력행으로 따로 그리므로 나머지 분기만 쓴다.
  const otherQuarters = confirmedHistory.filter((h) => !periods.includes(h.quarter));
  const quartersShown = sortQuarters(Array.from(new Set([...otherQuarters.map((h) => h.quarter), ...periods])));
  // 이사 기간 분기가 표에 하나라도 있으면 열을 세운다 — 그 분기를 지나 4Q를 입력하는 중에도
  // 3Q 행의 두 번째 비율은 계속 보여야 한다. 해당 없는 행은 '-'로 비운다.
  const showBundang2 = quartersShown.some(hasBundangSelfuse2);
  const visibleFields = showBundang2 ? FIELDS : FIELDS.filter((f) => !f.bundang2);
  const bundang2Periods = entries.filter((e) => e.hasBundang2).map((e) => e.period);

  const prevPeriod = getPreviousPeriod(periods[0]);
  const prevRow = prevPeriod ? otherQuarters.find((h) => h.quarter === prevPeriod) ?? null : null;

  async function handleConfirm() {
    setError("");
    // 함께 저장할 기간: 열려 있고 이 화면에서 값을 바꾼 기간 (기간이 하나뿐이면 예전처럼 그 기간).
    // 그중 값이 빈 기간은 뺀다 — 빈 기간을 저장하면 '건물 100%'가 확정된 것처럼 남는다.
    // 두 기간을 함께 조사할 때는 열린 기간을 모두 고쳐야 저장된다(사용자 지시) — 미리 채워진 지난 분기
    // 값이 그대로 확정되거나, 한 기간만 고치고 다른 기간을 빠뜨리는 일을 막는다.
    if (multi) {
      const untouched = [...untouchedLabels, ...(partnerUntouched ?? [])];
      if (untouched.length > 0) {
        setError(`${untouched.join(", ")}은(는) 아직 수정하지 않았습니다. 두 기간을 모두 수정한 뒤 저장해 주세요.`);
        return;
      }
    }
    const changed = entries.filter((e) => e.editable && (!multi || e.dirty));
    if (changed.length === 0) {
      setError("바뀐 값이 없어 저장하지 않았습니다.");
      return;
    }
    const targets = changed.filter((e) => e.hasInput);
    if (targets.length === 0) {
      setError("입력값이 비어 있어 저장하지 않았습니다.");
      return;
    }
    setConfirming(true);
    const failures: string[] = [];
    for (const e of targets) {
      try {
        await e.save(submittedBy);
      } catch (err: any) {
        failures.push(multi ? `${e.period}: ${err.message}` : err.message);
      }
    }
    if (failures.length > 0) setError(failures.join(" / "));
    setConfirming(false);
    // 서버 컴포넌트는 진입 시 한 번만 조회한다 — 새로고침하지 않으면
    // 탭을 옮겼다 돌아왔을 때 저장 전 값으로 다시 그려진다.
    router.refresh();
  }

  function renderReadOnlyRow(row: SelfuseBasisRow, label: string) {
    return (
      <tr key={row.quarter} className="ro-row">
        <td style={{ textAlign: "left" }}>{label}</td>
        {visibleFields.map((f) => (
          <td key={f.key}>{cellText(f, row)}</td>
        ))}
        <td>{row.note ? <NoteTip text={row.note} /> : null}</td>
      </tr>
    );
  }

  function renderEntryRow(e: SelfuseEntry) {
    // 이미 확정된 분기는 과거 분기와 같은 읽기 전용 모양으로 보여준다.
    if (!e.editable) return renderReadOnlyRow(e.asRow(submittedBy), e.period);
    return (
      <tr key={e.period}>
        <td style={{ textAlign: "left", fontWeight: 700, color: "#2563eb" }}>{e.period} (입력중)</td>
        {visibleFields.map((f, i) => (
          <td key={f.key}>
            {f.derived ? (
              // 본사 총 - Staff 로 계산되는 값이라 직접 고치지 않는다.
              <span title="본사 총 인원수 - Staff부문 인원수" style={{ color: "#475569", fontWeight: 600 }}>
                {e.derivedBizDevMedia}
              </span>
            ) : !e.canEditField(f) ? (
              // 열은 다른 분기 때문에 서 있지만 이 분기에는 해당이 없다.
              <span className="field-hint" title="이 분기에는 해당 없음">
                -
              </span>
            ) : (
              <input
                type="number"
                min="0"
                value={e.form[f.key]}
                onChange={(ev) => e.setForm((s) => ({ ...s, [f.key]: ev.target.value }))}
                style={{ width: 80 }}
                onPaste={(ev) => {
                  // 엑셀에서 여러 칸을 복사해 붙여넣으면 그 칸부터 순서대로 채운다.
                  // 자동계산 칸과 이 분기에 해당 없는 칸은 건너뛰고 다음 입력 칸으로 넘긴다.
                  if (!shouldHandlePaste(ev.clipboardData)) return;
                  ev.preventDefault();
                  const row = readPasteGrid(ev.clipboardData)[0] ?? [];
                  e.setForm((s) => {
                    const next = { ...s };
                    row.forEach((tok, offset) => {
                      const target = visibleFields[i + offset];
                      if (target && e.canEditField(target)) next[target.key] = tok;
                    });
                    return next;
                  });
                }}
              />
            )}
          </td>
        ))}
        <td>
          <input value={e.note} onChange={(ev) => e.setNote(ev.target.value)} placeholder="코멘트" style={{ width: 160 }} />
        </td>
      </tr>
    );
  }

  /** 기간 하나의 불러오기 버튼 — 첫 기간은 전분기 확정값, 다음 기간은 바로 앞 기간에 지금 넣은 값. */
  function loadButton(e: SelfuseEntry, i: number) {
    if (!e.editable) return null;
    // 전분기(예: 3Q) 끌고오기는 첫 기간(4Q)에만 두고, 뒤 기간(27년 BP)에는 앞 기간 입력값 복사 버튼만 둔다.
    const prev = i > 0 ? entries[i - 1] : null;
    return (
      <span key={e.period} style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
        {!prev && prevRow && (
          <button className="btn btn-secondary btn-sm" onClick={() => e.setForm(fromRow(prevRow))}>
            {multi ? `${prettyQuarterLabel(e.period)}: ` : ""}전분기 데이터 끌고오기
          </button>
        )}
        {prev && (
          <button className="btn btn-secondary btn-sm" onClick={() => e.setForm({ ...prev.form })}>
            {prettyQuarterLabel(prev.period)} 입력값을 {prettyQuarterLabel(e.period)}에 복사
          </button>
        )}
      </span>
    );
  }

  return (
    <div className="panel">
      <div className="panel-title">자가사용(건물) — 기준정보 입력</div>
      <div className="panel-sub" style={{ marginBottom: 12 }}>
        분당·용인 자가사용비율과 본사 인원수, 재료비 비중을 입력하면 분당(자가사용)/용인(자가사용) 배부기준이 자동 계산됩니다.
        {bundang2Periods.length > 0 &&
          ` ${bundang2Periods.join(", ")}은(는) 이사로 분당 건물이 둘이라 분당(자가사용)2가 함께 만들어집니다.`}{" "}
        확정 시 운영 allocation_rate에 반영됩니다.
      </div>

      <div style={{ marginBottom: 12, display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div className="field-hint">
          적용 분기: <b>{periods.join(", ")}</b> (검토 및 확정 상단의 현재 라운드에서 변경)
        </div>
        <div>
          <label className="field-hint" style={{ marginRight: 8 }}>
            입력자
          </label>
          <input value={submittedBy} onChange={(e) => setSubmittedBy(e.target.value)} placeholder="이름" style={{ width: 120 }} />
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
        <div className="panel-sub" style={{ fontWeight: 700, color: "#1a202c", margin: 0 }}>
          ■ 기준정보 — 분기별 이력
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{entries.map(loadButton)}</div>
      </div>
      <div className="tbl-scroll" style={{ marginBottom: 8 }}>
        <table className="rate-tbl">
          <thead>
            <tr>
              <th rowSpan={2}></th>
              {visibleFields
                .reduce<{ group: string; span: number }[]>((acc, f) => {
                  const last = acc[acc.length - 1];
                  if (last && last.group === f.group) last.span += 1;
                  else acc.push({ group: f.group, span: 1 });
                  return acc;
                }, [])
                .map((g) => (
                  <th key={g.group} colSpan={g.span} className="grp-humax">
                    {g.group}
                  </th>
                ))}
              <th rowSpan={2}>코멘트</th>
            </tr>
            <tr>
              {visibleFields.map((f) => (
                <th key={f.key}>{f.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {quartersShown.map((q) => {
              const e = entries.find((x) => x.period === q);
              if (e) return renderEntryRow(e);
              const h = otherQuarters.find((row) => row.quarter === q)!;
              return renderReadOnlyRow(h, h.quarter);
            })}
          </tbody>
        </table>
      </div>
      {/* 확정된 분기는 잠가두고, 고칠 때만 열어 실수로 덮어쓰는 걸 막는다 (기간마다 따로).
          고칠 대상이 바로 위 표이므로 버튼도 그 아래에 둔다. */}
      {entries.some((e) => !e.editable) && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          {entries
            .filter((e) => !e.editable)
            .map((e) => (
              <span key={e.period} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span className="status-badge status-confirmed">확정됨 ({e.period})</span>
                <button className="btn btn-secondary btn-sm" onClick={() => e.setUnlocked(true)}>
                  {multi ? `${prettyQuarterLabel(e.period)} 수정` : "수정"}
                </button>
              </span>
            ))}
        </div>
      )}
      {/* 입력 형식·최근 입력자 같은 설명은 표에 이미 드러나므로 빼고, 자동계산 규칙만 각주로 남긴다. */}
      <div className="field-hint" style={{ marginBottom: 12 }}>
        ※ 사업+개발+Media그룹 인원수 = 본사 총 인원수 − Staff부문 인원수
        {showBundang2 && (
          <>
            <br />※ 분당 자가사용비율2는 이사로 분당 건물이 둘인 분기({BUNDANG_SELFUSE_2_QUARTERS.join(", ")})에만 입력합니다.
          </>
        )}
      </div>

      {entries.map((e) => (
        <div key={e.period}>
          <div className="panel-sub" style={{ fontWeight: 700, color: "#1a202c", margin: "0 0 8px" }}>
            ■ 자동계산 미리보기 ({e.period})
          </div>
          <div className="tbl-scroll" style={{ marginBottom: 12 }}>
            <table className="rate-tbl">
              <RateTableHead />
              <tbody>
                {e.preview.map((row) => (
                  <ReadOnlyRateRow key={row.basis} label={row.basis} period={e.period} rec={toFullRec(row.rates)} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {error && <div className="callout alert" style={{ marginBottom: 12 }}>{error}</div>}
      {/* 확정된 분기에는 저장 버튼을 감춘다 — 다시 열려면 기준정보 표 아래의 '수정'을 누른다.
          두 기간을 함께 검토하면 열려 있고 값을 넣은 기간을 모두 저장한다. */}
      {entries.some((e) => e.editable) && (
        <button className="btn btn-primary btn-sm" disabled={confirming} onClick={handleConfirm}>
          {confirming ? "저장 중..." : "저장 (allocation_rate 반영)"}
        </button>
      )}

      {confirmedHistory.length > 0 && (
        <>
          <div className="panel-sub" style={{ fontWeight: 700, color: "#1a202c", margin: "20px 0 8px" }}>
            ■ 확정 이력
          </div>
          <div className="tbl-scroll" style={{ marginBottom: 8 }}>
            <table className="rate-tbl">
              <RateTableHead />
              <tbody>
                {confirmedHistory.map((h) =>
                  computeSelfuseRates(
                    {
                      bundangSelfuseRatio: h.bundang_selfuse_ratio,
                      bundangSelfuseRatio2: h.bundang_selfuse_ratio_2,
                      yonginSelfuseRatio: h.yongin_selfuse_ratio,
                      bizDevMediaHeadcount: h.biz_dev_media_headcount,
                      staffHeadcount: h.staff_headcount,
                      hqTotalHeadcount: h.hq_total_headcount,
                      materialEvcsDomesticRatio: h.material_evcs_domestic_ratio,
                      materialEvcsOverseasRatio: h.material_evcs_overseas_ratio,
                    },
                    h.quarter
                  ).map((row) => (
                    <ReadOnlyRateRow key={`${h.quarter}-${row.basis}`} label={`${h.quarter} · ${row.basis}`} period={h.quarter} rec={toFullRec(row.rates)} />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
