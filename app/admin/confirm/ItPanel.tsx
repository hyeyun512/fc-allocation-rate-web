"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { TARGETS, TargetKey, getPreviousPeriod } from "@/lib/targets";
import { sortQuarters } from "@/lib/quarter";
import { computeItRates, sumItBasisInput, ItBasisInput } from "@/lib/itBasis";
import { RateTableHead, ReadOnlyRateRow, NoteTip } from "./ConfirmReview";
import { readPasteGrid, shouldHandlePaste } from "@/lib/paste";

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
  /** 이 수치가 어느 반기 청구기준인지 (예: 2026-1H). 분기와 청구기준이 항상 같지 않아 따로 받는다. */
  billing_basis: string | null;
  note: string | null;
  submitted_by: string | null;
  confirmed_at: string | null;
}

/** 청구기준 선택지 — 목록에 없으면 '직접 입력'으로 자유롭게 적는다. */
export const BILLING_BASIS_OPTIONS = ["2025-2H", "2026-1H", "2026-2H", "2027-1H"];
const BILLING_CUSTOM = "__custom__";

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
  quarter,
  state,
  onChange,
  withResident,
  pastRows,
  billingBasis,
  onBillingBasisChange,
  note,
  onNoteChange,
  submittedBy,
  onSubmittedByChange,
  onSave,
  saving,
  noteDirty,
  editable,
  confirmedAt,
}: {
  quarter: string;
  state: FormState;
  onChange: (key: FieldKey, v: string) => void;
  withResident?: boolean;
  pastRows: ItBasisRow[];
  billingBasis: string;
  onBillingBasisChange: (v: string) => void;
  note: string;
  onNoteChange: (v: string) => void;
  submittedBy: string;
  onSubmittedByChange: (v: string) => void;
  onSave: () => void;
  saving: boolean;
  /** 확정된 분기는 읽기 전용으로 보여준다 ('입력중'으로 두면 아직 안 한 것처럼 보인다). */
  editable: boolean;
  confirmedAt: string | null;
  /** 저장하지 않은 코멘트 변경이 있으면 버튼을 짙게 칠해 눈에 띄게 한다. */
  noteDirty: boolean;
}) {
  // 목록에 없는 값이 저장돼 있으면 '직접 입력'으로 열어둔다.
  // (선택 직후에는 값이 비어 있어 값만으로는 판단할 수 없어 별도 상태로 둔다.)
  const [customBasis, setCustomBasis] = useState(
    billingBasis !== "" && !BILLING_BASIS_OPTIONS.includes(billingBasis)
  );
  const isCustomBasis = customBasis;
  const total = sumItBasisInput(toBasisInput(state));
  const currentRow = !editable ? (
    // 확정된 분기 — 과거 분기 행과 같은 읽기 전용 모양.
    <tr key={quarter} className="ro-row">
      <td style={{ textAlign: "left" }}>{quarter}</td>
      <td>{billingBasis || "-"}</td>
      {FIELDS.map((f) => (
        <td key={f.key}>{state[f.key] === "" ? 0 : Number(state[f.key])}</td>
      ))}
      <td className="total-col">{total}</td>
      {withResident && <td>{state.hiparkingResident === "" ? "-" : Number(state.hiparkingResident)}</td>}
      <td>{submittedBy || "-"}</td>
      <td>{fmtDate(confirmedAt)}</td>
      <td>{note ? <NoteTip text={note} /> : null}</td>
    </tr>
  ) : (
    <tr key={quarter}>
      <td style={{ textAlign: "left", fontWeight: 700, color: "#2563eb" }}>{quarter} (입력중)</td>
      <td>
        <select
          value={isCustomBasis ? BILLING_CUSTOM : billingBasis}
          onChange={(e) => {
            const v = e.target.value;
            setCustomBasis(v === BILLING_CUSTOM);
            onBillingBasisChange(v === BILLING_CUSTOM ? "" : v);
          }}
          style={{ width: 96 }}
        >
          <option value="">선택</option>
          {BILLING_BASIS_OPTIONS.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
          <option value={BILLING_CUSTOM}>직접 입력…</option>
        </select>
        {isCustomBasis && (
          <input
            value={billingBasis}
            onChange={(e) => onBillingBasisChange(e.target.value)}
            placeholder="예: 2026-1H"
            style={{ width: 96, marginTop: 4, textAlign: "left" }}
          />
        )}
      </td>
      {FIELDS.map((f, i) => (
        <td key={f.key}>
          <input
            type="number"
            min="0"
            value={state[f.key]}
            onChange={(e) => onChange(f.key, e.target.value)}
            style={{ width: 64 }}
            onPaste={(e) => {
              // 엑셀에서 여러 칸을 복사해 붙여넣으면 그 칸부터 순서대로 채운다.
              if (!shouldHandlePaste(e.clipboardData)) return;
              e.preventDefault();
              const row = readPasteGrid(e.clipboardData)[0] ?? [];
              row.forEach((tok, offset) => {
                const target = FIELDS[i + offset];
                if (target) onChange(target.key, tok);
              });
            }}
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
      <td>
        <input
          value={submittedBy}
          onChange={(e) => onSubmittedByChange(e.target.value)}
          placeholder="이름"
          style={{ width: 84, textAlign: "left" }}
        />
      </td>
      <td className="field-hint">확정 시 기록됨</td>
      <td>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <input
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
            placeholder="코멘트"
            style={{ width: 140, textAlign: "left" }}
            // 엔터로도 저장되게 한다 (표 안이라 폼 제출이 없다).
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onSave();
              }
            }}
          />
          {/* 아래 저장 버튼까지 내려가지 않고 여기서 바로 저장한다. */}
          <button
            type="button"
            className={`note-save-btn${noteDirty ? " is-dirty" : ""}`}
            title={noteDirty ? "저장하지 않은 변경이 있습니다 — 눌러서 저장" : "저장"}
            aria-label="저장"
            disabled={saving}
            onClick={onSave}
          >
            ✓
          </button>
        </div>
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
            {/* 첫 열은 분기 라벨이라 머리글을 비워둔다. */}
            <th></th>
            <th>청구기준</th>
            {FIELDS.map((f) => (
              <th key={f.key}>{f.label}</th>
            ))}
            <th>합계</th>
            {withResident && <th>하이파킹 입주인원</th>}
            <th>입력자</th>
            <th>확인일자</th>
            <th>코멘트</th>
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
                <td>{r.billing_basis ?? "-"}</td>
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
                <td>{r.note ? <NoteTip text={r.note} /> : null}</td>
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
  // 청구기준·코멘트도 표마다 따로 받는다.
  const [headcountBasis, setHeadcountBasis] = useState(initialHeadcount?.billing_basis ?? "");
  const [sapBasis, setSapBasis] = useState(initialSap?.billing_basis ?? "");
  const [headcountNote, setHeadcountNote] = useState(initialHeadcount?.note ?? "");
  const [sapNote, setSapNote] = useState(initialSap?.note ?? "");
  // 마지막으로 저장된 코멘트. 지금 값과 다르면 아직 저장 전이라 버튼을 짙게 칠한다.
  const [savedHeadcountNote, setSavedHeadcountNote] = useState(initialHeadcount?.note ?? "");
  const [savedSapNote, setSavedSapNote] = useState(initialSap?.note ?? "");
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  // 이미 확정된 분기를 '입력중'으로 보여주면 아직 안 한 것처럼 보인다 —
  // 확정 상태면 읽기 전용으로 두고 '수정'을 눌렀을 때만 다시 입력할 수 있게 한다.
  const [savedConfirmedAt, setSavedConfirmedAt] = useState(
    initialHeadcount?.confirmed_at ?? initialSap?.confirmed_at ?? null
  );
  const [unlocked, setUnlocked] = useState(false);
  const editable = !savedConfirmedAt || unlocked;
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

  /**
   * 과거 분기 이력 표에 뿌릴 행.
   * 맨 앞 열에 청구기준을 두고, 같은 값이 연속되면 첫 행에만 적어 아래로 합친다(rowSpan).
   * 인원수와 SAP은 청구기준이 다를 수 있어 행마다 해당하는 쪽 값을 가져온다.
   */
  const historyRows = useMemo(() => {
    const flat = historyByQuarter.flatMap(([q, { headcount, sap }]) =>
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
      ).map((row) => {
        const rates = toFullRec(row.rates);
        return {
          key: `${q}-${row.basis}`,
          billing: (row.division === "ID수" ? sap?.billing_basis : headcount?.billing_basis) || "미지정",
          quarter: q,
          basisName: row.basis,
          rates,
          total: TARGETS.reduce((a, t) => a + (rates[t.key] || 0), 0),
          headcount: row.headcount ?? null,
        };
      })
    );
    // 같은 청구기준끼리 붙여 보여준다 — 분기 순으로만 늘어놓으면 기준이 같은 행이 표 위아래로 흩어진다.
    // (예: 2026-Q2의 SAP은 2025-2H 기준이라 2026-Q1 행들과 같은 묶음이어야 한다.)
    const basisRank = (b: string) => {
      const m = /^(\d{4})-([12])H$/.exec(b);
      return m ? Number(m[1]) * 10 + Number(m[2]) : Number.MAX_SAFE_INTEGER;
    };
    flat.sort(
      (a, b) => basisRank(a.billing) - basisRank(b.billing) || a.billing.localeCompare(b.billing) || a.key.localeCompare(b.key)
    );

    return flat.map((r, i) => {
      const prev = flat[i - 1];
      // 청구기준 묶음
      const isStart = i === 0 || prev.billing !== r.billing;
      let span = 0;
      if (isStart) {
        span = 1;
        while (i + span < flat.length && flat[i + span].billing === r.billing) span++;
      }
      // 같은 청구기준 안에서 분기도 한 번만 적는다 (한 묶음에 여러 분기가 들어올 수 있다).
      const qStart = isStart || prev.quarter !== r.quarter;
      let qSpan = 0;
      if (qStart) {
        qSpan = 1;
        while (
          i + qSpan < flat.length &&
          flat[i + qSpan].billing === r.billing &&
          flat[i + qSpan].quarter === r.quarter
        )
          qSpan++;
      }
      return { ...r, spanStart: isStart, span, qStart, qSpan };
    });
  }, [historyByQuarter]);

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
          headcountBasis: headcountBasis || null,
          sapBasis: sapBasis || null,
          headcountNote: headcountNote || null,
          sapNote: sapNote || null,
          // 예전 형식(단일 입력자)과 호환 — 서버가 개별 값이 없을 때만 쓴다.
          submittedBy: headcountBy || sapBy || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "확정 처리 중 오류가 발생했습니다.");
      setConfirmed(true);
      setSavedHeadcountNote(headcountNote);
      setSavedSapNote(sapNote);
      setSavedConfirmedAt(new Date().toISOString());
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
        {prevHeadcountRow && (
          <button className="btn btn-secondary btn-sm" onClick={() => setHeadcountForm(fromRow(prevHeadcountRow))}>
            전분기 데이터 끌고오기
          </button>
        )}
      </div>
      <BasisForm
        quarter={quarter}
        state={headcountForm}
        onChange={(k, v) => setHeadcountForm((s) => ({ ...s, [k]: v }))}
        withResident
        pastRows={pastHeadcountRows}
        billingBasis={headcountBasis}
        onBillingBasisChange={setHeadcountBasis}
        note={headcountNote}
        onNoteChange={setHeadcountNote}
        submittedBy={headcountBy}
        onSubmittedByChange={setHeadcountBy}
        onSave={handleConfirm}
        saving={confirming}
        noteDirty={headcountNote !== savedHeadcountNote}
        editable={editable}
        confirmedAt={savedConfirmedAt}
      />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, margin: "16px 0 8px" }}>
        <div className="panel-sub" style={{ fontWeight: 700, color: "#1a202c", margin: 0 }}>
          ■ SAP ID 개수 (Ea) — 분기별 이력
        </div>
        {prevSapRow && (
          <button className="btn btn-secondary btn-sm" onClick={() => setSapForm(fromRow(prevSapRow))}>
            전분기 데이터 끌고오기
          </button>
        )}
      </div>
      <BasisForm
        quarter={quarter}
        state={sapForm}
        onChange={(k, v) => setSapForm((s) => ({ ...s, [k]: v }))}
        pastRows={pastSapRows}
        billingBasis={sapBasis}
        onBillingBasisChange={setSapBasis}
        note={sapNote}
        onNoteChange={setSapNote}
        submittedBy={sapBy}
        onSubmittedByChange={setSapBy}
        onSave={handleConfirm}
        saving={confirming}
        noteDirty={sapNote !== savedSapNote}
        editable={editable}
        confirmedAt={savedConfirmedAt}
      />

      {/* 확정된 분기는 잠가두고, 고칠 때만 연다. 고칠 대상이 위 두 표이므로 버튼도 그 아래에 둔다. */}
      {!editable && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", margin: "4px 0 12px" }}>
          <span className="status-badge status-confirmed">확정됨 ({quarter})</span>
          <button className="btn btn-secondary btn-sm" onClick={() => setUnlocked(true)}>
            수정
          </button>
        </div>
      )}

      <div className="panel-sub" style={{ fontWeight: 700, color: "#1a202c", margin: "12px 0 8px" }}>
        {/* 어떤 청구기준으로 만들어진 비율인지 함께 밝힌다 (인원수·SAP의 기준이 다를 수 있다). */}
        ■ 자동계산 미리보기 ({quarter}
        {headcountBasis || sapBasis
          ? ` · 청구기준 인원수 ${headcountBasis || "미지정"} / SAP ${sapBasis || "미지정"}`
          : ""}
        )
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
      {/* 확정된 분기에는 저장 버튼을 감춘다 — 다시 열려면 위 기준정보 표 아래의 '수정'을 누른다. */}
      {editable && (
        <button className="btn btn-primary btn-sm" disabled={confirming} onClick={handleConfirm}>
          {confirming ? "저장 중..." : "저장 (allocation_rate 반영)"}
        </button>
      )}

      {historyByQuarter.length > 0 && (
        <>
          <div className="panel-sub" style={{ fontWeight: 700, color: "#1a202c", margin: "20px 0 8px" }}>
            ■ 과거 분기 이력
          </div>
          <div className="tbl-scroll" style={{ marginBottom: 8 }}>
            <table className="rate-tbl">
              <thead>
                <tr>
                  <th>청구기준</th>
                  <th>분기</th>
                  <th>배부기준</th>
                  <th>인원수</th>
                  {TARGETS.map((t) => (
                    <th key={t.key} className={t.group === "humax" ? "grp-humax" : "grp-affiliate"}>
                      {t.label}
                    </th>
                  ))}
                  <th>TOTAL</th>
                </tr>
              </thead>
              <tbody>
                {historyRows.map((r, i) => (
                  <tr
                    key={r.key}
                    className={`ro-row${r.spanStart ? " basis-group-start" : ""}${
                      r.qStart && !r.spanStart ? " quarter-group-start" : ""
                    }`}
                  >
                    {/* 같은 청구기준·분기가 이어지면 첫 행에만 적고 아래로 합친다. */}
                    {r.spanStart && (
                      <td rowSpan={r.span} className="basis-cell">
                        {r.billing}
                      </td>
                    )}
                    {r.qStart && (
                      <td rowSpan={r.qSpan} className="basis-cell quarter-cell">
                        {r.quarter}
                      </td>
                    )}
                    <td style={{ textAlign: "left" }}>{r.basisName}</td>
                    <td>{r.headcount != null ? `${r.headcount}명` : "-"}</td>
                    {TARGETS.map((t) => (
                      <td key={t.key}>{((r.rates[t.key] || 0) * 100).toFixed(1)}%</td>
                    ))}
                    <td className="total-col">{(r.total * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="field-hint">
            {historyByQuarter.map(([q, { headcount, sap }]) => (
              <div key={q}>
                {q}: 인원수 청구기준 {headcount?.billing_basis ?? "미지정"} · 입력 {headcount?.submitted_by ?? "-"} (
                {fmtDate(headcount?.confirmed_at ?? null)}) · SAP ID 개수 청구기준 {sap?.billing_basis ?? "미지정"} · 입력{" "}
                {sap?.submitted_by ?? "-"} ({fmtDate(sap?.confirmed_at ?? null)})
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
