"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AdminNav from "../AdminNav";
import { TARGETS, TargetKey } from "@/lib/targets";

export interface AllocRateRow extends Partial<Record<TargetKey, number | null>> {
  quarter: string;
  type: string;
  division: string;
  basis: string;
  total: number;
  update_flag: boolean;
  note: string | null;
}

interface DeltaRow {
  type: string;
  division: string;
  basis: string;
  status: "new" | "removed" | "changed" | "same";
  changedCount: number;
  q1: AllocRateRow | null;
  q2: AllocRateRow | null;
  deltas: Record<TargetKey, number | null>;
  note: string | null;
}

const DIVISION_ORDER = ["본사", "주재원", "법인", "건물", "IT", "기타"];
const TYPE_COLOR: Record<string, string> = {
  리소스배부율: "var(--cat-green)",
  "인원수비율(Hu)": "var(--cat-magenta)",
  EVCS재료비비율: "var(--cat-yellow)",
  "인원수비율(All)": "var(--cat-aqua)",
  별도배부율: "var(--cat-orange)",
  직접비: "var(--cat-violet)",
};
const TYPE_ORDER = ["리소스배부율", "인원수비율(Hu)", "EVCS재료비비율", "인원수비율(All)", "별도배부율", "직접비"];
const STATUS_LABEL: Record<string, string> = { new: "신규", removed: "삭제", changed: "변경", same: "동일" };

function sortRows<T extends { division: string; basis: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const da = DIVISION_ORDER.indexOf(a.division);
    const db = DIVISION_ORDER.indexOf(b.division);
    if (da !== db) return da - db;
    return a.basis.localeCompare(b.basis);
  });
}

function fmtPct(v: number, digits = 1): string {
  return (v * 100).toFixed(digits).replace(/\.0$/, "") + "%";
}
function fmtDelta(d: number): string {
  const pct = d * 100;
  const s = (pct >= 0 ? "+" : "") + pct.toFixed(Math.abs(pct) < 1 ? 1 : 0);
  return s + "%p";
}

function makeDeltaRow(r1: AllocRateRow | null, r2: AllocRateRow | null, div: string): DeltaRow {
  let status: DeltaRow["status"] = "same";
  if (!r1) status = "new";
  else if (!r2) status = "removed";
  const base = (r2 || r1) as AllocRateRow;
  const deltas = {} as Record<TargetKey, number | null>;
  let changedCount = 0;
  TARGETS.forEach((t) => {
    if (r1 && r2) {
      const a = r1[t.key] || 0;
      const b = r2[t.key] || 0;
      const d = b - a;
      deltas[t.key] = d;
      if (Math.abs(d) > 1e-9) changedCount++;
    } else {
      deltas[t.key] = null;
    }
  });
  if (status === "same" && changedCount > 0) status = "changed";
  return {
    type: base.type,
    division: div,
    basis: base.basis,
    status,
    changedCount,
    q1: r1,
    q2: r2,
    deltas,
    note: (r2 && r2.note) || (r1 && r1.note) || null,
  };
}

function buildDeltaRows(pair: [string, string] | null, dataByQuarter: Record<string, AllocRateRow[]>) {
  if (!pair) return { rows: [] as DeltaRow[], scale: 0.05 };
  const [qa, qb] = pair;
  const aRows = dataByQuarter[qa] ?? [];
  const bRows = dataByQuarter[qb] ?? [];
  const aMap = new Map(aRows.map((r) => [r.basis, r]));
  const bMap = new Map(bRows.map((r) => [r.basis, r]));
  const rows: DeltaRow[] = [];
  DIVISION_ORDER.forEach((div) => {
    bRows.filter((r) => r.division === div).forEach((r2) => rows.push(makeDeltaRow(aMap.get(r2.basis) ?? null, r2, div)));
    aRows.filter((r) => r.division === div && !bMap.has(r.basis)).forEach((r1) => rows.push(makeDeltaRow(r1, null, div)));
  });
  let maxAbs = 0;
  rows.forEach((row) => TARGETS.forEach((t) => {
    const d = row.deltas[t.key];
    if (d != null) maxAbs = Math.max(maxAbs, Math.abs(d));
  }));
  const scale = Math.max(0.05, Math.ceil(maxAbs * 20) / 20);
  return { rows, scale };
}

export default function AllocationView({
  quarters,
  dataByQuarter,
}: {
  quarters: string[];
  dataByQuarter: Record<string, AllocRateRow[]>;
}) {
  const router = useRouter();
  const [view, setView] = useState<string>(quarters[quarters.length - 1] ?? "");
  const [search, setSearch] = useState("");
  const [divisions, setDivisions] = useState<Set<string>>(new Set());
  const [types, setTypes] = useState<Set<string>>(new Set());
  const [changedOnly, setChangedOnly] = useState(false);

  const isDelta = view === "delta";
  const deltaPair: [string, string] | null = quarters.length >= 2 ? [quarters[quarters.length - 2], quarters[quarters.length - 1]] : null;
  const delta = useMemo(() => buildDeltaRows(deltaPair, dataByQuarter), [deltaPair, dataByQuarter]);

  const quarterRows = sortRows(dataByQuarter[view] ?? []);
  const deltaRows = sortRows(delta.rows);

  function toggleSet(set: Set<string>, setter: (s: Set<string>) => void, value: string) {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setter(next);
  }

  function resetFilters() {
    setSearch("");
    setDivisions(new Set());
    setTypes(new Set());
    setChangedOnly(false);
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.push("/admin/login");
  }

  function matchesSearch(basis: string, division: string, type: string, note: string | null) {
    if (!search) return true;
    const hay = `${basis} ${division} ${type} ${note ?? ""}`.toLowerCase();
    return hay.includes(search.toLowerCase());
  }

  const filteredQuarterRows = quarterRows.filter(
    (r) =>
      (divisions.size === 0 || divisions.has(r.division)) &&
      (types.size === 0 || types.has(r.type)) &&
      matchesSearch(r.basis, r.division, r.type, r.note)
  );
  const filteredDeltaRows = deltaRows.filter(
    (r) =>
      (divisions.size === 0 || divisions.has(r.division)) &&
      (types.size === 0 || types.has(r.type)) &&
      !(changedOnly && r.status === "same") &&
      matchesSearch(r.basis, r.division, r.type, r.note)
  );

  const visibleRows: Array<AllocRateRow | DeltaRow> = isDelta ? filteredDeltaRows : filteredQuarterRows;

  // ---- stat tiles ----
  let stats: { label: string; value: string; sub: string; ok?: boolean }[];
  if (isDelta) {
    const changed = deltaRows.filter((r) => r.status === "changed").length;
    const added = deltaRows.filter((r) => r.status === "new").length;
    const removed = deltaRows.filter((r) => r.status === "removed").length;
    const same = deltaRows.filter((r) => r.status === "same").length;
    stats = [
      { label: "비교 대상 배부기준", value: `${deltaRows.length}건`, sub: deltaPair ? `${deltaPair[0]} ∪ ${deltaPair[1]} 합집합 기준` : "" },
      { label: "값 변경", value: `${changed}건`, sub: `${same}건은 변동 없음` },
      { label: `신규 추가 (${deltaPair?.[1] ?? ""})`, value: `${added}건`, sub: added ? "이전 분기에 없던 배부기준" : "없음", ok: added === 0 },
      { label: `삭제됨 (${deltaPair?.[1] ?? ""})`, value: `${removed}건`, sub: removed ? "이번 분기에서 제외됨" : "없음", ok: removed === 0 },
    ];
  } else {
    const total = quarterRows.length;
    const validated = quarterRows.filter((r) => Math.abs(r.total - 1) < 1e-6).length;
    const excluded = total - validated;
    stats = [
      { label: "배부기준", value: `${total}건`, sub: `${DIVISION_ORDER.length}개 구분 · ${TYPE_ORDER.length}개 유형` },
      { label: "적용 법인", value: `${TARGETS.length}개`, sub: "STB ~ H.Networks" },
      { label: "배부 유형", value: `${TYPE_ORDER.length}종`, sub: "리소스 · 인원수 · 직접비 등" },
      { label: "합계 검증", value: `${validated}/${total}`, sub: excluded ? `${excluded}건 실적 제외 (설계상 total=0)` : "전건 100% 일치", ok: true },
    ];
  }

  // ---- chip counts ----
  const sourceForCounts = isDelta ? deltaRows : quarterRows;
  const divisionCounts = DIVISION_ORDER.map((d) => ({ d, n: sourceForCounts.filter((r) => r.division === d).length }));

  let lastDivision: string | null = null;

  return (
    <div className="page page-wide alloc-view">
      <div className="topbar" style={{ marginBottom: 16, borderRadius: 12 }}>
        <div className="topbar-title">배부율 관리</div>
        <button className="btn btn-secondary btn-sm" onClick={logout}>
          로그아웃
        </button>
      </div>
      <AdminNav active="view" />

      <div className="panel" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div className="panel-title">
              {isDelta ? `배부율 변화 — ${deltaPair?.[0]} → ${deltaPair?.[1]}` : `${view} 배부율 마스터`}
            </div>
            <div className="panel-sub" style={{ maxWidth: 640 }}>
              {isDelta
                ? `${deltaPair?.[0]} 대비 ${deltaPair?.[1]} 배부기준 변경 내역을 한눈에 비교합니다. 법인별 배분 비율(%p) 증감을 색으로 표시합니다.`
                : `전체 조직 ${quarterRows.length}건의 리소스·인원수·직접비 배부율을 한 화면에서 비교합니다.`}
            </div>
          </div>
          <div className="av-qswitch" role="group" aria-label="분기 선택">
            {quarters.map((q) => (
              <button key={q} type="button" className={view === q ? "active" : ""} onClick={() => setView(q)}>
                {q}
              </button>
            ))}
            {deltaPair && (
              <button type="button" className={`mode-delta ${isDelta ? "active" : ""}`} onClick={() => setView("delta")}>
                변화 ({deltaPair[1]}-{deltaPair[0]})
              </button>
            )}
          </div>
        </div>
      </div>

      <section className="av-stats">
        {stats.map((t) => (
          <div className="av-stat-tile" key={t.label}>
            <p className="av-stat-label">{t.label}</p>
            <div className="av-stat-value">{t.value}</div>
            <p className="av-stat-sub">
              {t.ok && <span className="ok">✓ </span>}
              {t.sub}
            </p>
          </div>
        ))}
      </section>

      <section className="av-controls">
        <input
          className="av-search"
          type="text"
          placeholder="배부기준, 비고 검색…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="av-chip-group">
          <span className="av-chip-label">구분</span>
          {divisionCounts.map(({ d, n }) => (
            <button
              key={d}
              type="button"
              className={`av-chip ${divisions.has(d) ? "active" : ""}`}
              onClick={() => toggleSet(divisions, setDivisions, d)}
            >
              {d} ({n})
            </button>
          ))}
        </div>
        <div className="av-chip-group">
          <span className="av-chip-label">유형</span>
          {TYPE_ORDER.map((t) => (
            <button
              key={t}
              type="button"
              className={`av-chip ${types.has(t) ? "active" : ""}`}
              onClick={() => toggleSet(types, setTypes, t)}
            >
              <span className="dot" style={{ background: TYPE_COLOR[t] }} />
              {t}
            </button>
          ))}
        </div>
        {isDelta && (
          <div className="av-chip-group">
            <button
              type="button"
              className={`av-chip changed ${changedOnly ? "active" : ""}`}
              onClick={() => setChangedOnly((v) => !v)}
            >
              변경분만 보기
            </button>
          </div>
        )}
        <button className="av-reset" type="button" onClick={resetFilters}>
          필터 초기화
        </button>
      </section>

      <div className="av-legend">
        {!isDelta && (
          <div className="av-seq-legend">
            <span>배부율</span>
            <div className="av-seq-bar" />
            <span>0% → 100%</span>
          </div>
        )}
        {isDelta && (
          <div className="av-seq-legend">
            <span>{deltaPair?.[0]} → {deltaPair?.[1]} 변화</span>
            <div className="av-div-bar" />
            <span>감소 ← 0 → 증가 (최대 ±{(delta.scale * 100).toFixed(0)}%p 기준)</span>
          </div>
        )}
        <div className="av-type-legend">
          {TYPE_ORDER.map((t) => (
            <span className="item" key={t}>
              <span className="dot" style={{ background: TYPE_COLOR[t] }} />
              {t}
            </span>
          ))}
        </div>
      </div>

      <div className="av-table-scroll">
        <table className="av-table">
          <thead>
            <tr>
              <th className="col-basis">배부기준</th>
              {TARGETS.map((t) => (
                <th key={t.key}>{t.label}</th>
              ))}
              {isDelta ? <th>상태</th> : (
                <>
                  <th>TOTAL</th>
                  <th>update</th>
                  <th>비고</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 && (
              <tr>
                <td colSpan={TARGETS.length + (isDelta ? 2 : 4)}>
                  <div className="av-empty">조건에 맞는 배부기준이 없습니다.</div>
                </td>
              </tr>
            )}
            {(() => {
              lastDivision = null;
              return visibleRows.map((row) => {
                const groupHeader =
                  row.division !== lastDivision
                    ? (() => {
                        lastDivision = row.division;
                        const count = visibleRows.filter((r) => r.division === row.division).length;
                        return (
                          <tr className="group-row" key={`grp-${row.division}`}>
                            <td className="col-basis">
                              {row.division} <span className="grp-count">· {count}건</span>
                            </td>
                            <td colSpan={TARGETS.length + (isDelta ? 1 : 3)}></td>
                          </tr>
                        );
                      })()
                    : null;

                if (isDelta) {
                  const r = row as DeltaRow;
                  return (
                    <React.Fragment key={r.basis}>
                      {groupHeader}
                      <tr className={r.status === "removed" ? "row-removed" : ""}>
                        <td className="col-basis">
                          <span className="type-dot" style={{ background: TYPE_COLOR[r.type] }} title={r.type} />
                          <span className="basis-name">{r.basis}</span>
                          {r.status !== "same" && <span className={`av-status-badge ${r.status}`}>{STATUS_LABEL[r.status]}</span>}
                        </td>
                        {TARGETS.map((t) => {
                          const d = r.deltas[t.key];
                          if (d == null) {
                            const solo = r.q1 ? r.q1[t.key] : r.q2 ? r.q2[t.key] : null;
                            if (solo === null || solo === undefined) return <td key={t.key} className="heat-cell na"></td>;
                            return (
                              <td key={t.key} className="heat-cell delta-solo" title={r.status === "removed" ? `${deltaPair?.[0]} 값` : `${deltaPair?.[1]} 값`}>
                                ({fmtPct(solo, solo < 0.01 ? 1 : 0)})
                              </td>
                            );
                          }
                          if (Math.abs(d) < 1e-9) {
                            return <td key={t.key} className="heat-cell delta-zero">–</td>;
                          }
                          const dv = Math.min(Math.abs(d) / delta.scale, 1);
                          const cls = d > 0 ? "delta-pos" : "delta-neg";
                          const strong = dv >= 0.42 ? " delta-strong" : "";
                          return (
                            <td
                              key={t.key}
                              className={`heat-cell ${cls}${strong}`}
                              style={{ ["--dv" as any]: dv.toFixed(4) }}
                              title={`${r.basis} → ${t.label}: ${deltaPair?.[0]}→${deltaPair?.[1]} ${d >= 0 ? "+" : ""}${(d * 100).toFixed(2)}%p`}
                            >
                              {fmtDelta(d)}
                            </td>
                          );
                        })}
                        <td className="col-status">
                          <span className={`pill ${r.status}`}>
                            {STATUS_LABEL[r.status]}
                            {r.status === "changed" ? ` · ${r.changedCount}개 법인` : ""}
                          </span>
                        </td>
                      </tr>
                    </React.Fragment>
                  );
                }

                const r = row as AllocRateRow;
                const totalOk = Math.abs(r.total - 1) < 1e-6;
                return (
                  <React.Fragment key={r.basis}>
                    {groupHeader}
                    <tr>
                      <td className="col-basis">
                        <span className="type-dot" style={{ background: TYPE_COLOR[r.type] }} title={r.type} />
                        <span className="basis-name">{r.basis}</span>
                      </td>
                      {TARGETS.map((t) => {
                        const v = r[t.key];
                        if (v === null || v === undefined) return <td key={t.key} className="heat-cell na"></td>;
                        if (v === 0) return <td key={t.key} className="heat-cell zero">0</td>;
                        const hi = v >= 0.5;
                        return (
                          <td
                            key={t.key}
                            className={`heat-cell has-value${hi ? " hi" : ""}`}
                            style={{ ["--v" as any]: v.toFixed(4) }}
                            title={`${r.basis} → ${t.label}: ${(v * 100).toFixed(4).replace(/\.?0+$/, "")}%`}
                          >
                            {fmtPct(v, v < 0.01 ? 2 : 0)}
                          </td>
                        );
                      })}
                      <td className={`col-total ${totalOk ? "av-total-ok" : "av-total-excl"}`}>
                        {totalOk ? fmtPct(r.total, 0) : r.total === 0 ? "제외" : fmtPct(r.total, 0)}
                      </td>
                      <td className="col-update">
                        {r.update_flag ? <span className="pill">● 반영</span> : <span className="pill off">–</span>}
                      </td>
                      <td className="col-note">
                        {r.note && (
                          <button className="av-note-btn" type="button">
                            i<span className="tip">{r.note}</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  </React.Fragment>
                );
              });
            })()}
          </tbody>
        </table>
      </div>

      <footer style={{ textAlign: "right" }}>소수점은 원본 계산값을 그대로 저장 — 표시는 반올림, 셀에 마우스를 올리면 정밀값이 표시됩니다</footer>
    </div>
  );
}
