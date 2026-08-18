"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { TARGETS, TargetKey, getPreviousPeriod } from "@/lib/targets";
import { sortQuarters } from "@/lib/quarter";
import { computeSelfuseRates, SelfuseBasisInput } from "@/lib/selfuseBasis";
import { RateTableHead, ReadOnlyRateRow, NoteTip } from "@/components/RateParts";
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
  note: string | null;
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

const FIELDS: { key: FieldKey; label: string; hint: string; isPercent: boolean; derived?: boolean }[] = [
  { key: "bundangSelfuseRatio", label: "분당 자가사용비율", hint: "0~100(%)로 입력", isPercent: true },
  { key: "yonginSelfuseRatio", label: "용인 자가사용비율", hint: "0~100(%)로 입력", isPercent: true },
  // 본사 총 인원수에서 Staff부문을 뺀 나머지 — 직접 입력받지 않고 계산해서 채운다.
  { key: "bizDevMediaHeadcount", label: "사업+개발+Media그룹 인원수", hint: "본사 총 - Staff (자동)", isPercent: false, derived: true },
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
  // 기준정보 표의 맨 오른쪽 코멘트. IT 탭과 달리 저장 버튼이 하나뿐이라 값과 함께 저장한다.
  const [note, setNote] = useState(initial?.note ?? "");
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  // 이미 확정된 분기를 '입력중'으로 보여주면 아직 안 한 것처럼 보인다 — 확정 상태면 읽기 전용으로 두고
  // '수정'을 눌렀을 때만 다시 입력할 수 있게 한다.
  const [confirmed, setConfirmed] = useState(!!initial?.confirmed_at);
  const [unlocked, setUnlocked] = useState(false);
  const editable = !confirmed || unlocked;
  const [error, setError] = useState("");

  // 사업+개발+Media그룹 인원수 = 본사 총 인원수 - Staff부문 인원수 (음수는 0으로).
  const derivedBizDevMedia = String(Math.max(0, (Number(form.hqTotalHeadcount) || 0) - (Number(form.staffHeadcount) || 0)));
  const input = toBasisInput({ ...form, bizDevMediaHeadcount: derivedBizDevMedia });
  const preview = useMemo(() => computeSelfuseRates(input), [JSON.stringify(input)]);

  // 확정된 분기 전체. 현재 라운드가 1Q여도 이미 확정된 2Q가 남아 있을 수 있어(뒤 분기를 먼저 확정할 수 있다)
  // '과거'로 걸러내지 않고 그대로 모두 보여준다.
  const confirmedHistory = useMemo(() => [...history].sort((a, b) => a.quarter.localeCompare(b.quarter)), [history]);
  // 위 기준정보 표에서는 현재 분기를 입력행으로 따로 그리므로 나머지 분기만 쓴다.
  const otherQuarters = useMemo(() => confirmedHistory.filter((h) => h.quarter !== quarter), [confirmedHistory, quarter]);

  const prevPeriod = getPreviousPeriod(quarter);
  const prevRow = prevPeriod ? otherQuarters.find((h) => h.quarter === prevPeriod) ?? null : null;

  async function handleConfirm() {
    setError("");
    // 빈 화면에서 저장이 눌리면 자가사용비율 0 → '건물 100%'짜리 배부율이 만들어져,
    // 열어본 적도 없는 분기가 View에 확정된 것처럼 남는다.
    if (!Object.values(input).some((v) => v > 0)) {
      setError("입력값이 비어 있어 저장하지 않았습니다.");
      return;
    }
    setConfirming(true);
    try {
      const res = await fetch("/api/admin/selfuse-basis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quarter, input, submittedBy: submittedBy || null, note: note.trim() || null }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "확정 처리 중 오류가 발생했습니다.");
      setConfirmed(true);
      setUnlocked(false);
      // 서버 컴포넌트는 진입 시 한 번만 조회한다 — 새로고침하지 않으면
      // 탭을 옮겼다 돌아왔을 때 저장 전 값으로 다시 그려진다.
      router.refresh();
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
              <th>코멘트</th>
            </tr>
          </thead>
          <tbody>
            {sortQuarters(Array.from(new Set([...otherQuarters.map((h) => h.quarter), quarter]))).map((q) => {
              if (q !== quarter) {
                const h = otherQuarters.find((row) => row.quarter === q)!;
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
                    <td>{h.note ? <NoteTip text={h.note} /> : null}</td>
                  </tr>
                );
              }
              // 이미 확정된 분기는 과거 분기와 같은 읽기 전용 모양으로 보여준다.
              if (!editable) {
                return (
                  <tr key={q} className="ro-row">
                    <td style={{ textAlign: "left" }}>{quarter}</td>
                    <td>{(input.bundangSelfuseRatio * 100).toFixed(1)}%</td>
                    <td>{(input.yonginSelfuseRatio * 100).toFixed(1)}%</td>
                    <td>{input.bizDevMediaHeadcount}</td>
                    <td>{input.staffHeadcount}</td>
                    <td>{input.hqTotalHeadcount}</td>
                    <td>{(input.materialEvcsDomesticRatio * 100).toFixed(1)}%</td>
                    <td>{(input.materialEvcsOverseasRatio * 100).toFixed(1)}%</td>
                    <td>{initial?.submitted_by ?? submittedBy ?? "-"}</td>
                    <td>{fmtDate(initial?.confirmed_at ?? null)}</td>
                    <td>{note ? <NoteTip text={note} /> : null}</td>
                  </tr>
                );
              }
              return (
                <tr key={q}>
                  <td style={{ textAlign: "left", fontWeight: 700, color: "#2563eb" }}>{quarter} (입력중)</td>
                  {FIELDS.map((f, i) => (
                    <td key={f.key}>
                      {f.derived ? (
                        // 본사 총 - Staff 로 계산되는 값이라 직접 고치지 않는다.
                        <span title="본사 총 인원수 - Staff부문 인원수" style={{ color: "#475569", fontWeight: 600 }}>
                          {derivedBizDevMedia}
                        </span>
                      ) : (
                        <input
                          type="number"
                          min="0"
                          value={form[f.key]}
                          onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                          style={{ width: 80 }}
                          onPaste={(e) => {
                            // 엑셀에서 여러 칸을 복사해 붙여넣으면 그 칸부터 순서대로 채운다.
                            // 자동계산 칸은 건너뛰고 다음 입력 칸으로 넘긴다.
                            if (!shouldHandlePaste(e.clipboardData)) return;
                            e.preventDefault();
                            const row = readPasteGrid(e.clipboardData)[0] ?? [];
                            setForm((s) => {
                              const next = { ...s };
                              row.forEach((tok, offset) => {
                                const target = FIELDS[i + offset];
                                if (target && !target.derived) next[target.key] = tok;
                              });
                              return next;
                            });
                          }}
                        />
                      )}
                    </td>
                  ))}
                  <td colSpan={2} className="field-hint">
                    확정 시 기록됨
                  </td>
                  <td>
                    <input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="코멘트"
                      style={{ width: 160 }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {/* 확정된 분기는 잠가두고, 고칠 때만 열어 실수로 덮어쓰는 걸 막는다.
          고칠 대상이 바로 위 표이므로 버튼도 그 아래에 둔다. */}
      {!editable && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          <span className="status-badge status-confirmed">확정됨 ({quarter})</span>
          <button className="btn btn-secondary btn-sm" onClick={() => setUnlocked(true)}>
            수정
          </button>
        </div>
      )}
      {/* 입력 형식·최근 입력자 같은 설명은 표에 이미 드러나므로 빼고, 자동계산 규칙 하나만 각주로 남긴다. */}
      <div className="field-hint" style={{ marginBottom: 12 }}>
        ※ 사업+개발+Media그룹 인원수 = 본사 총 인원수 − Staff부문 인원수
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
      {/* 확정된 분기에는 저장 버튼을 감춘다 — 다시 열려면 기준정보 표 아래의 '수정'을 누른다. */}
      {editable && (
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
