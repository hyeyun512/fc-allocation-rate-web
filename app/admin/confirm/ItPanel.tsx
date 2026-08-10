"use client";

import { useMemo, useState } from "react";
import { TARGETS, TargetKey, getPreviousPeriod } from "@/lib/targets";
import { sortQuarters } from "@/lib/quarter";
import { computeItRates, sumItBasisInput, ItBasisInput } from "@/lib/itBasis";
import { RateTableHead, ReadOnlyRateRow } from "./ConfirmReview";

export interface ItBasisRow {
  quarter: string;
  metric: "인원수" | "SAP ID 개수";
  headquarters: number;
  overseas_corp: number;
  h_mobility: number;
  h_ev: number;
  hiparking: number;
  peoplecar: number;
  winercom: number;
  holdings: number;
  hiparking_resident: number | null;
  submitted_by: string | null;
  confirmed_at: string | null;
}

type FieldKey = "headquarters" | "overseasCorp" | "hMobility" | "hEv" | "hiparking" | "peoplecar" | "winercom" | "holdings" | "hiparkingResident";

interface FormState {
  headquarters: string;
  overseasCorp: string;
  hMobility: string;
  hEv: string;
  hiparking: string;
  peoplecar: string;
  winercom: string;
  holdings: string;
  hiparkingResident: string;
}

const FIELDS: { key: FieldKey; label: string }[] = [
  { key: "headquarters", label: "본사" },
  { key: "overseasCorp", label: "해외법인" },
  { key: "hMobility", label: "H.Mobility" },
  { key: "hEv", label: "H.EV" },
  { key: "hiparking", label: "하이파킹" },
  { key: "peoplecar", label: "피플카" },
  { key: "winercom", label: "위너콤" },
  { key: "holdings", label: "홀딩스" },
];

function fromRow(row: ItBasisRow | null): FormState {
  if (!row) {
    return { headquarters: "", overseasCorp: "", hMobility: "", hEv: "", hiparking: "", peoplecar: "", winercom: "", holdings: "", hiparkingResident: "" };
  }
  return {
    headquarters: String(row.headquarters ?? ""),
    overseasCorp: String(row.overseas_corp ?? ""),
    hMobility: String(row.h_mobility ?? ""),
    hEv: String(row.h_ev ?? ""),
    hiparking: String(row.hiparking ?? ""),
    peoplecar: String(row.peoplecar ?? ""),
    winercom: String(row.winercom ?? ""),
    holdings: String(row.holdings ?? ""),
    hiparkingResident: row.hiparking_resident != null ? String(row.hiparking_resident) : "",
  };
}

function toBasisInput(f: FormState): ItBasisInput {
  return {
    headquarters: Number(f.headquarters) || 0,
    overseasCorp: Number(f.overseasCorp) || 0,
    hMobility: Number(f.hMobility) || 0,
    hEv: Number(f.hEv) || 0,
    hiparking: Number(f.hiparking) || 0,
    peoplecar: Number(f.peoplecar) || 0,
    winercom: Number(f.winercom) || 0,
    holdings: Number(f.holdings) || 0,
    hiparkingResident: f.hiparkingResident === "" ? null : Number(f.hiparkingResident),
  };
}

function fmtDate(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("ko-KR");
}

function toFullRec(rates: Partial<Record<TargetKey, number>>): Record<TargetKey, number> {
  const r = {} as Record<TargetKey, number>;
  TARGETS.forEach((t) => (r[t.key] = rates[t.key] ?? 0));
  return r;
}

function BasisForm({
  title,
  quarter,
  state,
  onChange,
  withResident,
  pastRows,
}: {
  title: string;
  quarter: string;
  state: FormState;
  onChange: (key: FieldKey, v: string) => void;
  withResident?: boolean;
  pastRows: ItBasisRow[];
}) {
  const total = sumItBasisInput(toBasisInput(state));
  const currentRow = (
    <tr key={quarter}>
      <td style={{ textAlign: "left", fontWeight: 700, color: "#2563eb" }}>{quarter} (입력중)</td>
      {FIELDS.map((f) => (
        <td key={f.key}>
          <input
            type="number"
            min="0"
            value={state[f.key]}
            onChange={(e) => onChange(f.key, e.target.value)}
            style={{ width: 64 }}
          />
        </td>
      ))}
      <td className="total-col">{total}</td>
      {withResident && (
        <td>
          <input
            type="number"
            min="0"
            value={state.hiparkingResident}
            onChange={(e) => onChange("hiparkingResident", e.target.value)}
            style={{ width: 64 }}
          />
        </td>
      )}
      <td colSpan={2} className="field-hint">
        확정 시 기록됨
      </td>
    </tr>
  );
  // 과거 이력 + 현재 분기를 항상 연도->분기 순으로 정렬해서, 현재 분기가 과거 데이터보다
  // 이전 분기여도(예: 2Q까지 입력된 상태에서 1Q를 다시 열람) 순서가 뒤집히지 않게 한다.
  const orderedQuarterList = sortQuarters(Array.from(new Set([...pastRows.map((r) => r.quarter), quarter])));
  return (
    <div className="tbl-scroll" style={{ marginBottom: 12 }}>
      <table className="rate-tbl">
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>{title}</th>
            {FIELDS.map((f) => (
              <th key={f.key}>{f.label}</th>
            ))}
            <th>합계</th>
            {withResident && <th>하이파킹 입주인원</th>}
            <th>입력자</th>
            <th>확인일자</th>
          </tr>
        </thead>
        <tbody>
          {orderedQuarterList.map((q) => {
            if (q === quarter) return currentRow;
            const r = pastRows.find((row) => row.quarter === q)!;
            const rTotal = sumItBasisInput({
              headquarters: r.headquarters,
              overseasCorp: r.overseas_corp,
              hMobility: r.h_mobility,
              hEv: r.h_ev,
              hiparking: r.hiparking,
              peoplecar: r.peoplecar,
              winercom: r.winercom,
              holdings: r.holdings,
              hiparkingResident: r.hiparking_resident,
            });
            return (
              <tr key={r.quarter} className="ro-row">
                <td style={{ textAlign: "left" }}>{r.quarter}</td>
                <td>{r.headquarters}</td>
                <td>{r.overseas_corp}</td>
                <td>{r.h_mobility}</td>
                <td>{r.h_ev}</td>
                <td>{r.hiparking}</td>
                <td>{r.peoplecar}</td>
                <td>{r.winercom}</td>
                <td>{r.holdings}</td>
                <td className="total-col">{rTotal}</td>
                {withResident && <td>{r.hiparking_resident ?? "-"}</td>}
                <td>{r.submitted_by ?? "-"}</td>
                <td>{fmtDate(r.confirmed_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function ItPanel({
  period,
  initialHeadcount,
  initialSap,
  history,
}: {
  period: string;
  initialHeadcount: ItBasisRow | null;
  initialSap: ItBasisRow | null;
  history: ItBasisRow[];
}) {
  const quarter = period;
  const [headcountForm, setHeadcountForm] = useState<FormState>(() => fromRow(initialHeadcount));
  const [sapForm, setSapForm] = useState<FormState>(() => fromRow(initialSap));
  // 인원수와 SAP ID 개수는 담당자가 달라 입력자를 따로 받는다.
  const [headcountBy, setHeadcountBy] = useState(initialHeadcount?.submitted_by ?? "");
  const [sapBy, setSapBy] = useState(initialSap?.submitted_by ?? "");
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");

  const preview = useMemo(() => computeItRates(toBasisInput(headcountForm), toBasisInput(sapForm)), [headcountForm, sapForm]);

  const pastHeadcountRows = useMemo(
    () => history.filter((r) => r.metric === "인원수" && r.quarter !== quarter).sort((a, b) => a.quarter.localeCompare(b.quarter)),
    [history, quarter]
  );
  const pastSapRows = useMemo(
    () => history.filter((r) => r.metric === "SAP ID 개수" && r.quarter !== quarter).sort((a, b) => a.quarter.localeCompare(b.quarter)),
    [history, quarter]
  );

  const prevPeriod = getPreviousPeriod(quarter);
  const prevHeadcountRow = prevPeriod ? pastHeadcountRows.find((r) => r.quarter === prevPeriod) ?? null : null;
  const prevSapRow = prevPeriod ? pastSapRows.find((r) => r.quarter === prevPeriod) ?? null : null;

  // 분기별로 인원수/SAP 행을 묶어 과거 이력 배부율을 재계산 (현재 편집 중인 분기는 위 미리보기에서 이미 보여주므로 제외).
  const historyByQuarter = useMemo(() => {
    const map = new Map<string, { headcount: ItBasisRow | null; sap: ItBasisRow | null }>();
    history.forEach((row) => {
      const entry = map.get(row.quarter) ?? { headcount: null, sap: null };
      if (row.metric === "인원수") entry.headcount = row;
      else entry.sap = row;
      map.set(row.quarter, entry);
    });
    return Array.from(map.entries())
      .filter(([q]) => q !== quarter)
      .sort(([a], [b]) => a.localeCompare(b));
  }, [history, quarter]);

  async function handleConfirm() {
    setError("");
    setConfirming(true);
    try {
      const res = await fetch("/api/admin/it-basis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quarter,
          headcount: toBasisInput(headcountForm),
          sap: toBasisInput(sapForm),
          headcountBy: headcountBy || null,
          sapBy: sapBy || null,
          // 예전 형식(단일 입력자)과 호환 — 서버가 개별 값이 없을 때만 쓴다.
          submittedBy: headcountBy || sapBy || null,
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
      <div className="panel-title">IT 인원수비율 — 기준정보 입력</div>
      <div className="panel-sub" style={{ marginBottom: 12 }}>
        인원수·SAP ID 개수를 입력하면 6개 배부기준(인원수비율 5종 + SAP 1종)이 자동 계산되어 미리보기에 표시됩니다. 확정 시 운영 allocation_rate에 반영됩니다.
      </div>

      <div style={{ marginBottom: 12, display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div className="field-hint">
          적용 분기: <b>{quarter}</b> (검토 및 확정 상단의 현재 라운드에서 변경)
        </div>
      </div>

      {/* 인원수와 SAP ID 개수는 담당자가 서로 달라 입력자를 각각 받는다. */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
        <div className="panel-sub" style={{ fontWeight: 700, color: "#1a202c", margin: 0 }}>
          ■ 인원수 (명) — 분기별 이력
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
          <label className="field-hint">입력자</label>
          <input
            value={headcountBy}
            onChange={(e) => setHeadcountBy(e.target.value)}
            placeholder="이름"
            style={{ width: 110, textAlign: "left" }}
          />
          {prevHeadcountRow && (
            <button className="btn btn-secondary btn-sm" onClick={() => setHeadcountForm(fromRow(prevHeadcountRow))}>
              전분기 데이터 끌고오기
            </button>
          )}
        </div>
      </div>
      <BasisForm
        title="청구기준"
        quarter={quarter}
        state={headcountForm}
        onChange={(k, v) => setHeadcountForm((s) => ({ ...s, [k]: v }))}
        withResident
        pastRows={pastHeadcountRows}
      />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, margin: "16px 0 8px" }}>
        <div className="panel-sub" style={{ fontWeight: 700, color: "#1a202c", margin: 0 }}>
          ■ SAP ID 개수 (Ea) — 분기별 이력
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
          <label className="field-hint">입력자</label>
          <input
            value={sapBy}
            onChange={(e) => setSapBy(e.target.value)}
            placeholder="이름"
            style={{ width: 110, textAlign: "left" }}
          />
          {prevSapRow && (
            <button className="btn btn-secondary btn-sm" onClick={() => setSapForm(fromRow(prevSapRow))}>
              전분기 데이터 끌고오기
            </button>
          )}
        </div>
      </div>
      <BasisForm
        title="청구기준"
        quarter={quarter}
        state={sapForm}
        onChange={(k, v) => setSapForm((s) => ({ ...s, [k]: v }))}
        pastRows={pastSapRows}
      />

      <div className="panel-sub" style={{ fontWeight: 700, color: "#1a202c", margin: "12px 0 8px" }}>
        ■ 자동계산 미리보기 ({quarter})
      </div>
      <div className="tbl-scroll" style={{ marginBottom: 12 }}>
        <table className="rate-tbl">
          <RateTableHead />
          <tbody>
            {preview.map((row) => (
              <ReadOnlyRateRow key={row.basis} label={row.basis} rec={toFullRec(row.rates)} headcount={row.headcount ?? null} />
            ))}
          </tbody>
        </table>
      </div>

      {error && <div className="callout alert" style={{ marginBottom: 12 }}>{error}</div>}
      {confirmed && (
        <div className="status-badge status-confirmed" style={{ marginBottom: 12 }}>
          확정 완료
        </div>
      )}
      <button className="btn btn-primary btn-sm" disabled={confirming} onClick={handleConfirm}>
        {confirming ? "저장 중..." : "저장 (allocation_rate 반영)"}
      </button>

      {historyByQuarter.length > 0 && (
        <>
          <div className="panel-sub" style={{ fontWeight: 700, color: "#1a202c", margin: "20px 0 8px" }}>
            ■ 과거 분기 이력
          </div>
          <div className="tbl-scroll" style={{ marginBottom: 8 }}>
            <table className="rate-tbl">
              <RateTableHead />
              <tbody>
                {historyByQuarter.map(([q, { headcount, sap }]) =>
                  computeItRates(
                    headcount
                      ? {
                          headquarters: headcount.headquarters,
                          overseasCorp: headcount.overseas_corp,
                          hMobility: headcount.h_mobility,
                          hEv: headcount.h_ev,
                          hiparking: headcount.hiparking,
                          peoplecar: headcount.peoplecar,
                          winercom: headcount.winercom,
                          holdings: headcount.holdings,
                          hiparkingResident: headcount.hiparking_resident,
                        }
                      : null,
                    sap
                      ? {
                          headquarters: sap.headquarters,
                          overseasCorp: sap.overseas_corp,
                          hMobility: sap.h_mobility,
                          hEv: sap.h_ev,
                          hiparking: sap.hiparking,
                          peoplecar: sap.peoplecar,
                          winercom: sap.winercom,
                          holdings: sap.holdings,
                          hiparkingResident: null,
                        }
                      : null
                  ).map((row) => (
                    <ReadOnlyRateRow key={`${q}-${row.basis}`} label={`${q} · ${row.basis}`} rec={toFullRec(row.rates)} headcount={row.headcount ?? null} />
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="field-hint">
            {historyByQuarter.map(([q, { headcount, sap }]) => (
              <div key={q}>
                {q}: 인원수 입력 {headcount?.submitted_by ?? "-"} ({fmtDate(headcount?.confirmed_at ?? null)}) · SAP ID 개수 입력{" "}
                {sap?.submitted_by ?? "-"} ({fmtDate(sap?.confirmed_at ?? null)})
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
