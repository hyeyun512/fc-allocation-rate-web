"use client";

import { useMemo, useState } from "react";
import { TARGETS, TargetKey, getPreviousPeriod } from "@/lib/targets";
import { sortQuarters } from "@/lib/quarter";
import { computeSelfuseRates, SelfuseBasisInput } from "@/lib/selfuseBasis";
import { RateTableHead, ReadOnlyRateRow } from "./ConfirmReview";
import { readPasteGrid, shouldHandlePaste } from "@/lib/paste";

export interface SelfuseBasisRow {
  quarter: string;
  bundang_selfuse_ratio: number;
  yongin_selfuse_ratio: number;
  biz_dev_media_headcount: number;
  staff_headcount: number;
  hq_total_headcount: number;
  material_evcs_domestic_ratio: number;
  material_evcs_overseas_ratio: number;
  submitted_by: string | null;
  confirmed_at: string | null;
}

type FieldKey = keyof SelfuseBasisInput;

interface FormState {
  bundangSelfuseRatio: string;
  yonginSelfuseRatio: string;
  bizDevMediaHeadcount: string;
  staffHeadcount: string;
  hqTotalHeadcount: string;
  materialEvcsDomesticRatio: string;
  materialEvcsOverseasRatio: string;
}

const FIELDS: { key: FieldKey; label: string; hint: string; isPercent: boolean }[] = [
  { key: "bundangSelfuseRatio", label: "분당 자가사용비율", hint: "0~100(%)로 입력", isPercent: true },
  { key: "yonginSelfuseRatio", label: "용인 자가사용비율", hint: "0~100(%)로 입력", isPercent: true },
  { key: "bizDevMediaHeadcount", label: "사업+개발+Media그룹 인원수", hint: "명", isPercent: false },
  { key: "staffHeadcount", label: "Staff부문 인원수", hint: "명", isPercent: false },
  { key: "hqTotalHeadcount", label: "본사 총 인원수", hint: "명", isPercent: false },
  { key: "materialEvcsDomesticRatio", label: "재료비 비중(EVCS국내)", hint: "0~100(%)로 입력", isPercent: true },
  { key: "materialEvcsOverseasRatio", label: "재료비 비중(EVCS해외)", hint: "0~100(%)로 입력", isPercent: true },
];

function fromRow(row: SelfuseBasisRow | null): FormState {
  if (!row) {
    return {
      bundangSelfuseRatio: "",
      yonginSelfuseRatio: "",
      bizDevMediaHeadcount: "",
      staffHeadcount: "",
      hqTotalHeadcount: "",
      materialEvcsDomesticRatio: "",
      materialEvcsOverseasRatio: "",
    };
  }
  return {
    bundangSelfuseRatio: String((row.bundang_selfuse_ratio ?? 0) * 100),
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
    yonginSelfuseRatio: (Number(f.yonginSelfuseRatio) || 0) / 100,
    bizDevMediaHeadcount: Number(f.bizDevMediaHeadcount) || 0,
    staffHeadcount: Number(f.staffHeadcount) || 0,
    hqTotalHeadcount: Number(f.hqTotalHeadcount) || 0,
    materialEvcsDomesticRatio: (Number(f.materialEvcsDomesticRatio) || 0) / 100,
    materialEvcsOverseasRatio: (Number(f.materialEvcsOverseasRatio) || 0) / 100,
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

export default function SelfUsePanel({
  period,
  initial,
  history,
}: {
  period: string;
  initial: SelfuseBasisRow | null;
  history: SelfuseBasisRow[];
}) {
  const quarter = period;
  const [form, setForm] = useState<FormState>(() => fromRow(initial));
  const [submittedBy, setSubmittedBy] = useState(initial?.submitted_by ?? "");
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");

  const input = toBasisInput(form);
  const preview = useMemo(() => computeSelfuseRates(input), [JSON.stringify(input)]);
  const evcsShare = input.hqTotalHeadcount > 0 ? input.bizDevMediaHeadcount / input.hqTotalHeadcount / 2 : 0;
  const humaxCommonShare = input.hqTotalHeadcount > 0 ? input.staffHeadcount / input.hqTotalHeadcount : 0;

  const pastHistory = useMemo(() => history.filter((h) => h.quarter !== quarter).sort((a, b) => a.quarter.localeCompare(b.quarter)), [history, quarter]);

  const prevPeriod = getPreviousPeriod(quarter);
  const prevRow = prevPeriod ? pastHistory.find((h) => h.quarter === prevPeriod) ?? null : null;

  async function handleConfirm() {
    setError("");
    setConfirming(true);
    try {
      const res = await fetch("/api/admin/selfuse-basis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quarter, input, submittedBy: submittedBy || null }),
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
      <div className="panel-title">자가사용(건물) — 기준정보 입력</div>
      <div className="panel-sub" style={{ marginBottom: 12 }}>
        분당·용인 자가사용비율과 본사 인원수, 재료비 비중을 입력하면 분당(자가사용)/용인(자가사용) 2개 배부기준이 자동 계산됩니다. 확정 시 운영 allocation_rate에 반영됩니다.
      </div>

      <div style={{ marginBottom: 12, display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div className="field-hint">
          적용 분기: <b>{quarter}</b> (검토 및 확정 상단의 현재 라운드에서 변경)
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
        {prevRow && (
          <button className="btn btn-secondary btn-sm" onClick={() => setForm(fromRow(prevRow))}>
            전분기 데이터 끌고오기
          </button>
        )}
      </div>
      <div className="tbl-scroll" style={{ marginBottom: 8 }}>
        <table className="rate-tbl">
          <thead>
            <tr>
              <th></th>
              {FIELDS.map((f) => (
                <th key={f.key}>{f.label}</th>
              ))}
              <th>입력자</th>
              <th>확인일자</th>
            </tr>
          </thead>
          <tbody>
            {sortQuarters(Array.from(new Set([...pastHistory.map((h) => h.quarter), quarter]))).map((q) => {
              if (q !== quarter) {
                const h = pastHistory.find((row) => row.quarter === q)!;
                return (
                  <tr key={h.quarter} className="ro-row">
                    <td style={{ textAlign: "left" }}>{h.quarter}</td>
                    <td>{(h.bundang_selfuse_ratio * 100).toFixed(1)}%</td>
                    <td>{(h.yongin_selfuse_ratio * 100).toFixed(1)}%</td>
                    <td>{h.biz_dev_media_headcount}</td>
                    <td>{h.staff_headcount}</td>
                    <td>{h.hq_total_headcount}</td>
                    <td>{(h.material_evcs_domestic_ratio * 100).toFixed(1)}%</td>
                    <td>{(h.material_evcs_overseas_ratio * 100).toFixed(1)}%</td>
                    <td>{h.submitted_by ?? "-"}</td>
                    <td>{fmtDate(h.confirmed_at)}</td>
                  </tr>
                );
              }
              return (
                <tr key={q}>
                  <td style={{ textAlign: "left", fontWeight: 700, color: "#2563eb" }}>{quarter} (입력중)</td>
                  {FIELDS.map((f, i) => (
                    <td key={f.key}>
                      <input
                        type="number"
                        min="0"
                        value={form[f.key]}
                        onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                        style={{ width: 80 }}
                        onPaste={(e) => {
                          // 엑셀에서 여러 칸을 복사해 붙여넣으면 그 칸부터 순서대로 채운다.
                          if (!shouldHandlePaste(e.clipboardData)) return;
                          e.preventDefault();
                          const row = readPasteGrid(e.clipboardData)[0] ?? [];
                          setForm((s) => {
                            const next = { ...s };
                            row.forEach((tok, offset) => {
                              const target = FIELDS[i + offset];
                              if (target) next[target.key] = tok;
                            });
                            return next;
                          });
                        }}
                      />
                    </td>
                  ))}
                  <td colSpan={2} className="field-hint">
                    확정 시 기록됨
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="field-hint" style={{ marginBottom: 12 }}>
        {FIELDS.map((f) => `${f.label}: ${f.hint}`).join(" · ")}
      </div>

      <div className="field-hint" style={{ marginBottom: 12 }}>
        본사 인원수 비중(자동): EVCS(국내)/EVCS(해외) 각 {(evcsShare * 100).toFixed(1)}% · Humax(공통) {(humaxCommonShare * 100).toFixed(1)}%
      </div>
      <div className="field-hint" style={{ marginBottom: 12 }}>
        최근 입력: {initial?.submitted_by ?? "-"} · {fmtDate(initial?.confirmed_at ?? null)}
      </div>

      <div className="panel-sub" style={{ fontWeight: 700, color: "#1a202c", margin: "0 0 8px" }}>
        ■ 자동계산 미리보기 ({quarter})
      </div>
      <div className="tbl-scroll" style={{ marginBottom: 12 }}>
        <table className="rate-tbl">
          <RateTableHead />
          <tbody>
            {preview.map((row) => (
              <ReadOnlyRateRow key={row.basis} label={row.basis} rec={toFullRec(row.rates)} />
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

      {pastHistory.length > 0 && (
        <>
          <div className="panel-sub" style={{ fontWeight: 700, color: "#1a202c", margin: "20px 0 8px" }}>
            ■ 과거 분기 이력
          </div>
          <div className="tbl-scroll" style={{ marginBottom: 8 }}>
            <table className="rate-tbl">
              <RateTableHead />
              <tbody>
                {pastHistory.map((h) =>
                  computeSelfuseRates({
                    bundangSelfuseRatio: h.bundang_selfuse_ratio,
                    yonginSelfuseRatio: h.yongin_selfuse_ratio,
                    bizDevMediaHeadcount: h.biz_dev_media_headcount,
                    staffHeadcount: h.staff_headcount,
                    hqTotalHeadcount: h.hq_total_headcount,
                    materialEvcsDomesticRatio: h.material_evcs_domestic_ratio,
                    materialEvcsOverseasRatio: h.material_evcs_overseas_ratio,
                  }).map((row) => (
                    <ReadOnlyRateRow key={`${h.quarter}-${row.basis}`} label={`${h.quarter} · ${row.basis}`} rec={toFullRec(row.rates)} />
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
