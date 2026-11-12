"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { TARGETS, TargetKey } from "@/lib/targets";
import { prettyQuarterLabel, sortQuarters } from "@/lib/quarter";
import { computeBuildingRates, BuildingBasisInput, EvcsAverage, EVCS_AVERAGE_ORGS } from "@/lib/selfuseBasis";
import { RateTableHead, ReadOnlyRateRow, NoteTip, fieldGroupTone, isGroupStart } from "@/components/RateParts";
import { readPasteGrid, shouldHandlePaste } from "@/lib/paste";

/**
 * 27년 BP부터의 건물 기준정보 (allocation_basis_inputs category "selfuse"에 새 필드로 담긴다).
 * 26년 4Q까지의 자가사용(건물) 기준정보(SelfUsePanel)와는 받는 값이 달라 표를 따로 둔다 —
 * 한 표에 섞으면 기간마다 절반의 칸이 '해당 없음'으로 비어 읽기 어렵다.
 */
export interface BuildingBasisRow {
  quarter: string;
  /** 저장 시점의 EVCS리소스평균 (소수). 이후 다섯 조직 값이 바뀌면 재계산이 함께 고친다. */
  evcs_avg_domestic: number;
  evcs_avg_overseas: number;
  bundang_area_evcs: number;
  bundang_area_it: number;
  bundang_area_humax_common: number;
  material_evcs_domestic_ratio: number;
  material_evcs_overseas_ratio: number;
  submitted_by: string | null;
  confirmed_at: string | null;
  note: string | null;
}

type FieldKey = keyof BuildingBasisInput;
/** 입력받는 칸만 (EVCS리소스평균은 자동 계산이라 입력 상태에 두지 않는다). */
type InputKey = Exclude<FieldKey, "evcsAvgDomestic" | "evcsAvgOverseas">;
type FormState = Record<InputKey, string>;

// 머리글은 두 줄이다 — 윗줄에 묶음(group), 아랫줄에 배부 대상(label). 같은 group이 이어지면 윗줄 칸을 합친다.
// 열 구성(사용자 지시 2026-11-12): EVCS리소스평균(자동) / 분당 면적 비율 / 용인 재료비 비율.
const FIELDS: { key: FieldKey; group: string; label: string; pct?: boolean; auto?: boolean }[] = [
  { key: "evcsAvgDomestic", group: "EVCS리소스평균(자동)", label: "EVCS(국내)", pct: true, auto: true },
  { key: "evcsAvgOverseas", group: "EVCS리소스평균(자동)", label: "EVCS(해외)", pct: true, auto: true },
  { key: "bundangAreaEvcs", group: "분당 면적 비율(%)", label: "EVCS" },
  { key: "bundangAreaIt", group: "분당 면적 비율(%)", label: "IT" },
  { key: "bundangAreaHumaxCommon", group: "분당 면적 비율(%)", label: "Humax(공통)" },
  { key: "materialEvcsDomesticRatio", group: "용인 재료비 비율(%)", label: "EVCS(국내)", pct: true },
  { key: "materialEvcsOverseasRatio", group: "용인 재료비 비율(%)", label: "EVCS(해외)", pct: true },
];
const FIELD_GROUPS = FIELDS.reduce<{ group: string; span: number }[]>((acc, f) => {
  const last = acc[acc.length - 1];
  if (last && last.group === f.group) last.span += 1;
  else acc.push({ group: f.group, span: 1 });
  return acc;
}, []);

const EMPTY_FORM: FormState = {
  bundangAreaEvcs: "",
  bundangAreaIt: "",
  bundangAreaHumaxCommon: "",
  materialEvcsDomesticRatio: "",
  materialEvcsOverseasRatio: "",
};

function fromRow(row: BuildingBasisRow | null): FormState {
  if (!row) return { ...EMPTY_FORM };
  return {
    bundangAreaEvcs: String(row.bundang_area_evcs ?? ""),
    bundangAreaIt: String(row.bundang_area_it ?? ""),
    bundangAreaHumaxCommon: String(row.bundang_area_humax_common ?? ""),
    materialEvcsDomesticRatio: String((row.material_evcs_domestic_ratio ?? 0) * 100),
    materialEvcsOverseasRatio: String((row.material_evcs_overseas_ratio ?? 0) * 100),
  };
}

function toInput(f: FormState, avg: EvcsAverage | null): BuildingBasisInput {
  return {
    evcsAvgDomestic: avg?.domestic ?? 0,
    evcsAvgOverseas: avg?.overseas ?? 0,
    bundangAreaEvcs: Number(f.bundangAreaEvcs) || 0,
    bundangAreaIt: Number(f.bundangAreaIt) || 0,
    bundangAreaHumaxCommon: Number(f.bundangAreaHumaxCommon) || 0,
    materialEvcsDomesticRatio: (Number(f.materialEvcsDomesticRatio) || 0) / 100,
    materialEvcsOverseasRatio: (Number(f.materialEvcsOverseasRatio) || 0) / 100,
  };
}

function inputOfRow(row: BuildingBasisRow): BuildingBasisInput {
  return {
    evcsAvgDomestic: row.evcs_avg_domestic,
    evcsAvgOverseas: row.evcs_avg_overseas,
    bundangAreaEvcs: row.bundang_area_evcs,
    bundangAreaIt: row.bundang_area_it,
    bundangAreaHumaxCommon: row.bundang_area_humax_common,
    materialEvcsDomesticRatio: row.material_evcs_domestic_ratio,
    materialEvcsOverseasRatio: row.material_evcs_overseas_ratio,
  };
}

function toFullRec(rates: Partial<Record<TargetKey, number>>): Record<TargetKey, number> {
  const r = {} as Record<TargetKey, number>;
  TARGETS.forEach((t) => (r[t.key] = rates[t.key] ?? 0));
  return r;
}

function cellText(key: FieldKey, pct: boolean | undefined, input: BuildingBasisInput): string {
  const v = input[key];
  return pct ? `${(v * 100).toFixed(1)}%` : String(v);
}

/**
 * 저장 전 검사 — 서버(/api/selfuse-basis의 saveBuildingBasis)와 같은 기준.
 * 예전 자가사용처럼 '건물 100%'로 떨어질 자리가 없어, 한쪽이 비면 합계 0인 배부기준이 남는다.
 */
function buildingInputProblem(input: BuildingBasisInput): string | null {
  if (Object.values(input).some((v) => v < 0)) return "면적과 재료비 비중은 0 이상이어야 합니다.";
  if (input.evcsAvgDomestic + input.evcsAvgOverseas <= 0)
    return "EVCS리소스평균을 계산할 값이 없습니다. 사업 그룹·개발 그룹 등 다섯 조직의 배부율을 먼저 저장해 주세요.";
  const area = input.bundangAreaEvcs + input.bundangAreaIt + input.bundangAreaHumaxCommon;
  if (area <= 0) return "분당 면적을 입력해 주세요.";
  if (input.materialEvcsDomesticRatio + input.materialEvcsOverseasRatio <= 0) return "용인 재료비 비중을 입력해 주세요.";
  return null;
}

/** 기간 하나의 건물 기준정보 입력 상태 (SelfUsePanel의 useSelfuseEntry와 같은 구성). */
function useBuildingEntry(period: string, initial: BuildingBasisRow | null, avg: EvcsAverage | null) {
  const [form, setForm] = useState<FormState>(() => fromRow(initial));
  const [note, setNote] = useState(initial?.note ?? "");
  // 이미 확정된 기간은 읽기 전용으로 두고 '수정'을 눌렀을 때만 다시 입력한다.
  const [confirmed, setConfirmed] = useState(!!initial?.confirmed_at);
  const [unlocked, setUnlocked] = useState(false);
  const editable = !confirmed || unlocked;

  const input = toInput(form, avg);
  const preview = useMemo(() => computeBuildingRates(input), [JSON.stringify(input)]);
  // EVCS리소스평균은 자동으로 늘 채워지므로 '입력했는가'는 입력 칸만 본다.
  const hasInput = (Object.keys(form) as InputKey[]).some((k) => (Number(form[k]) || 0) > 0);

  function asRow(submittedBy: string): BuildingBasisRow {
    return {
      quarter: period,
      evcs_avg_domestic: input.evcsAvgDomestic,
      evcs_avg_overseas: input.evcsAvgOverseas,
      bundang_area_evcs: input.bundangAreaEvcs,
      bundang_area_it: input.bundangAreaIt,
      bundang_area_humax_common: input.bundangAreaHumaxCommon,
      material_evcs_domestic_ratio: input.materialEvcsDomesticRatio,
      material_evcs_overseas_ratio: input.materialEvcsOverseasRatio,
      submitted_by: initial?.submitted_by ?? submittedBy,
      confirmed_at: initial?.confirmed_at ?? null,
      note,
    };
  }

  /** 이 기간을 저장한다. 실패하면 던진다. */
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
  }

  return { period, form, setForm, note, setNote, confirmed, editable, setUnlocked, input, preview, hasInput, asRow, save };
}

type BuildingEntry = ReturnType<typeof useBuildingEntry>;

export default function BuildingPanel({
  periods,
  history,
  materialSource,
  evcsAverages,
}: {
  /** 이번 라운드에서 건물 기준정보를 쓰는 기간들 (27년 BP~). */
  periods: string[];
  history: BuildingBasisRow[];
  /**
   * 재료비 비중을 가져올 바로 앞 기간의 자가사용 기준정보 (예: 2026-Q4). 용인 재료비 비중은 방식이 바뀌어도
   * 같은 값이라 이어 쓸 수 있다 — 분당은 인원수에서 면적으로 바뀌어 가져올 것이 없다.
   */
  materialSource: { quarter: string; material_evcs_domestic_ratio: number; material_evcs_overseas_ratio: number } | null;
  /** 기간별 EVCS리소스평균 — 서버가 지금 값으로 계산해 내려준다 (아무도 입력 전이면 null). */
  evcsAverages: Record<string, EvcsAverage | null>;
}) {
  const initialOf = (p: string) => history.find((h) => h.quarter === p) ?? null;
  // 기간 수는 라운드가 정하고 화면을 여는 동안 바뀌지 않으므로, 훅을 기간마다 한 번씩 불러도 순서가 고정된다.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const entries: BuildingEntry[] = periods.map((p) => useBuildingEntry(p, initialOf(p), evcsAverages[p] ?? null));
  // 다른 표와 함께 저장 규칙을 지켜야 하면(4Q 자가사용 + BP 건물) 기간이 하나여도 여러 기간 라운드로 본다.
  const multi = entries.length > 1;
  // 기간마다 저장된 입력자가 다르면 어느 쪽인지 알 수 없으므로 비워 두고 새로 적게 한다.
  const [submittedBy, setSubmittedBy] = useState(() => {
    const names = Array.from(new Set(periods.map((p) => initialOf(p)?.submitted_by).filter((x): x is string => !!x)));
    return names.length === 1 ? names[0] : "";
  });
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");

  const confirmedHistory = useMemo(() => sortQuarters(history.map((h) => h.quarter)).map((q) => history.find((h) => h.quarter === q)!), [history]);
  const otherRows = confirmedHistory.filter((h) => !periods.includes(h.quarter));
  const quartersShown = sortQuarters(Array.from(new Set([...otherRows.map((h) => h.quarter), ...periods])));

  async function handleConfirm() {
    setError("");
    // 함께 저장할 기간: 열려 있는 기간 모두. 여러 기간이면 값이 빈 기간은 건너뛴다 — 한 기간만 저장할 수 있다(사용자 지시).
    const changed = entries.filter((e) => e.editable && (!multi || e.hasInput));
    if (changed.length === 0) {
      setError("열려 있는 기간이 없어 저장하지 않았습니다.");
      return;
    }
    for (const e of changed) {
      const problem = buildingInputProblem(e.input);
      if (problem) {
        setError(multi ? `${e.period}: ${problem}` : problem);
        return;
      }
    }
    setConfirming(true);
    const failures: string[] = [];
    for (const e of changed) {
      try {
        await e.save(submittedBy);
      } catch (err: any) {
        failures.push(multi ? `${e.period}: ${err.message}` : err.message);
      }
    }
    if (failures.length > 0) setError(failures.join(" / "));
    // 바뀌지 않아 다시 저장하지 않은 기간도 '재수정'으로 열어 둔 것이면 함께 잠근다.
    else entries.forEach((e) => e.setUnlocked(false));
    setConfirming(false);
    // 서버 컴포넌트는 진입 시 한 번만 조회한다 — 새로고침하지 않으면 탭을 옮겼다 돌아왔을 때 저장 전 값으로 그려진다.
    router.refresh();
  }

  function readOnlyRow(row: BuildingBasisRow, label: string) {
    const input = inputOfRow(row);
    return (
      <tr key={row.quarter} className="ro-row">
        <td style={{ textAlign: "left" }}>{label}</td>
        {FIELDS.map((f, i) => (
          <td key={f.key} className={isGroupStart(FIELDS, i) ? "fg-start" : undefined}>{cellText(f.key, f.pct, input)}</td>
        ))}
        <td>{row.note ? <NoteTip text={row.note} /> : null}</td>
      </tr>
    );
  }

  function entryRow(e: BuildingEntry) {
    if (!e.editable) return readOnlyRow(e.asRow(submittedBy), e.period);
    return (
      <tr key={e.period}>
        <td style={{ textAlign: "left" }}>{e.period}</td>
        {FIELDS.map((f, i) =>
          f.auto ? (
            <td key={f.key} className={isGroupStart(FIELDS, i) ? "fg-start" : undefined} title="자동 계산 — 입력하지 않습니다">
              {e.input.evcsAvgDomestic + e.input.evcsAvgOverseas > 0 ? cellText(f.key, f.pct, e.input) : "-"}
            </td>
          ) : (
          <td key={f.key} className={isGroupStart(FIELDS, i) ? "fg-start" : undefined}>
            <input
              type="number"
              min="0"
              value={e.form[f.key as InputKey]}
              onChange={(ev) => e.setForm((s) => ({ ...s, [f.key]: ev.target.value }))}
              style={{ width: 80 }}
              onPaste={(ev) => {
                // 엑셀에서 여러 칸을 복사해 붙여넣으면 그 칸부터 순서대로 채운다.
                if (!shouldHandlePaste(ev.clipboardData)) return;
                ev.preventDefault();
                const row = readPasteGrid(ev.clipboardData)[0] ?? [];
                e.setForm((s) => {
                  const next = { ...s };
                  row.forEach((tok, offset) => {
                    const target = FIELDS[i + offset];
                    if (target && !target.auto) next[target.key as InputKey] = tok;
                  });
                  return next;
                });
              }}
            />
          </td>
          )
        )}
        <td>
          <input value={e.note} onChange={(ev) => e.setNote(ev.target.value)} placeholder="코멘트" style={{ width: 160, textAlign: "left" }} />
        </td>
      </tr>
    );
  }

  /** 재료비 비중만 앞 기간에서 가져온다 (분당 면적은 새로 받는 값이라 가져올 것이 없다). */
  function loadMaterialButton(e: BuildingEntry) {
    if (!e.editable || !materialSource) return null;
    return (
      <button
        key={e.period}
        className="copy-link"
        onClick={() =>
          e.setForm((s) => ({
            ...s,
            materialEvcsDomesticRatio: String(materialSource.material_evcs_domestic_ratio * 100),
            materialEvcsOverseasRatio: String(materialSource.material_evcs_overseas_ratio * 100),
          }))
        }
      >
        {multi ? `${prettyQuarterLabel(e.period)}: ` : ""}
        {prettyQuarterLabel(materialSource.quarter)} 재료비 비중 가져오기
      </button>
    );
  }

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="panel-title">건물 (27년 BP~) — 기준정보 입력</div>
      <div className="panel-sub" style={{ marginBottom: 12 }}>
        27년 BP부터는 자가사용(건물) 대신 건물(분당)·건물(용인) 배부기준을 씁니다. 분당은 면적 비율(EVCS·IT·Humax(공통))로 나누고,
        EVCS 몫은 EVCS리소스평균으로 국내/해외에 다시 나눕니다. 용인은 재료비 비중(EVCS 국내/해외)으로 나눕니다.
        배부 대상 &apos;건물&apos;은 이 기간부터 없습니다. 확정 시 운영 allocation_rate에 반영됩니다.
      </div>

      <div style={{ marginBottom: 12, display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div className="field-hint">
          적용 분기: <b>{periods.join(", ")}</b>
        </div>
        <div>
          <label className="field-hint" style={{ marginRight: 8 }}>
            입력자
          </label>
          <input className="required-input" value={submittedBy} onChange={(e) => setSubmittedBy(e.target.value)} placeholder="이름" style={{ width: 120 }} />
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
        <div className="panel-sub" style={{ fontWeight: 700, color: "#1a202c", margin: 0 }}>
          ■ 건물 기준정보 — 분기별 이력
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{entries.map(loadMaterialButton)}</div>
      </div>
      <div className="tbl-scroll" style={{ marginBottom: 8 }}>
        <table className="rate-tbl">
          <thead>
            <tr>
              <th rowSpan={2}></th>
              {FIELD_GROUPS.map((g) => (
                <th key={g.group} colSpan={g.span} className={`fg-head fg-start fg-${fieldGroupTone(g.group)}`}>
                  {g.group}
                </th>
              ))}
              <th rowSpan={2}>코멘트</th>
            </tr>
            <tr>
              {FIELDS.map((f, i) => (
                <th key={f.key} className={`fg-sub fg-${fieldGroupTone(f.group)}${isGroupStart(FIELDS, i) ? " fg-start" : ""}`}>
                  {f.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {quartersShown.map((q) => {
              const e = entries.find((x) => x.period === q);
              if (e) return entryRow(e);
              const h = otherRows.find((r) => r.quarter === q)!;
              return readOnlyRow(h, h.quarter);
            })}
          </tbody>
        </table>
      </div>
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
      <div className="field-hint" style={{ marginBottom: 12 }}>
        ※ EVCS리소스평균은 {EVCS_AVERAGE_ORGS.join(" · ")}의 인원수 가중평균에서 EVCS(국내)·EVCS(해외)만 떼어 합이 100%가 되게
        맞춘 값으로, 언제나 자동 계산됩니다(이 조직들 값이 바뀌면 건물(분당)도 다시 계산). 분당 면적은 단위와 상관없이 세 칸의
        비중만 씁니다 (건물(분당) EVCS(국내) = EVCS 면적 비중 × EVCS리소스평균 국내).
      </div>

      {/* '자동계산 미리보기'는 아래 '확정 이력'과 같아 지웠다(사용자 지시). */}

      {error && <div className="callout alert" style={{ marginBottom: 12 }}>{error}</div>}
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
                  computeBuildingRates(inputOfRow(h)).map((row) => (
                    <ReadOnlyRateRow
                      key={`${h.quarter}-${row.basis}`}
                      label={`${h.quarter} · ${row.basis}`}
                      period={h.quarter}
                      rec={toFullRec(row.rates)}
                    />
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
