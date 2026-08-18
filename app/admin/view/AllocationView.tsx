"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AdminNav from "../AdminNav";
import { TARGETS, TargetKey } from "@/lib/targets";
import { defaultDeltaPairKey, deltaPairOptions, parseQuarter, prettyQuarterLabel, shortQuarterLabel } from "@/lib/quarter";

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
}

const DIVISION_ORDER = ["본사", "주재원", "법인", "건물", "IT", "인원수", "ID수", "기타", "직접비"];
const DIVISION_LABEL: Record<string, string> = {
  본사: "리소스배부율-본사",
  주재원: "리소스배부율-주재원",
  법인: "리소스배부율-법인",
  건물: "자가사용(건물)",
  인원수: "IT-인원수",
  ID수: "IT-ID",
  기타: "고정비율-기타",
  직접비: "고정비율-직접비",
};
function divisionLabel(division: string): string {
  return DIVISION_LABEL[division] ?? division;
}
const TYPE_COLOR: Record<string, string> = {
  리소스배부율: "var(--cat-green)",
  "자가사용(건물)": "var(--cat-orange)",
  IT: "var(--cat-aqua)",
  고정비율: "var(--cat-violet)",
};
const TYPE_ORDER = ["리소스배부율", "자가사용(건물)", "IT", "고정비율"];
const STATUS_LABEL: Record<string, string> = { new: "신규", removed: "삭제", changed: "변경", same: "동일" };

/**
 * View 표기 순서 — 배부판 양식의 행 순서를 그대로 따른다.
 * 이름순(가나다/ABC)으로 정렬하면 양식과 어긋나 대조하기 어렵다.
 * 목록에 없는 배부기준은 맨 뒤로 보내고, 그 안에서만 이름순으로 정렬한다.
 */
const BASIS_ORDER = [
  // 리소스배부율 · 본사
  "Staff(휴맥스이브이)", "국내영업팀", "Platform개발팀", "사업협력팀", "사업 그룹", "개발 그룹",
  "SCM실", "Media그룹", "CEO", "경영지원실", "지식재산팀", "Staff(CEO)", "HR실", "HKR(관계사제외)",
  // 리소스배부율 · 주재원
  "HBR_주재원", "HUK_주재원", "HDG_주재원", "HSZ_주재원",
  // 리소스배부율 · 법인
  "HUS", "HMX", "HUK", "HDG", "HUG", "HTR", "HBR", "HJP", "HTH", "HAU", "HID", "HSZ",
  // 자가사용(건물)
  "분당(자가사용)", "용인(자가사용)",
  // IT
  "인원수비율(Mobility 포함)", "인원수비율(MS)", "인원수비율(SAP)", "인원수비율(그룹사인원)",
  "인원수비율(그룹사인원_입주사)", "인원수비율(M/W/H)", "인원수비율(M/E/W/H)",
  // 고정비율 · 기타
  "EVCS(국내/해외)", "EVCS(국내30/해외70)",
  // 고정비율 · 직접비
  "건물 100%", "공통 100%", "STB 100%", "Mobility 100%", "EVCS(국내) 100%", "EVCS(해외) 100%",
  "H.Networks", "H.Mobility 100%", "H.Holdings 100%", "H.EV 100%", "실적 제외",
];
function basisOrderIndex(basis: string): number {
  const i = BASIS_ORDER.indexOf(basis);
  return i === -1 ? BASIS_ORDER.length : i;
}

function sortRows<T extends { division: string; basis: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const da = DIVISION_ORDER.indexOf(a.division);
    const db = DIVISION_ORDER.indexOf(b.division);
    if (da !== db) return da - db;
    return basisOrderIndex(a.basis) - basisOrderIndex(b.basis) || a.basis.localeCompare(b.basis);
  });
}

/**
 * 관리자 코멘트 저장 키 — 같은 배부기준이라도 분기마다 코멘트를 따로 갖는다.
 *
 * 코멘트를 allocation_rate.note에 적지 않는 이유:
 * 그 칸에는 확정할 때마다 "웹 확정 (Forecast) - 2026-08-05T…" 같은 감사 로그가 자동으로 덮여서,
 * 관리자가 적은 코멘트가 다음 확정에서 조용히 사라진다.
 * 그래서 allocation_view_comments 표에 따로 보관한다.
 */
function commentKey(quarter: string, basis: string): string {
  return [quarter, basis].join(" ");
}

function fmtPct(v: number, digits = 1): string {
  return (v * 100).toFixed(digits).replace(/\.0$/, "") + "%";
}
function fmtDelta(d: number): string {
  const pct = d * 100;
  const s = (pct >= 0 ? "+" : "") + pct.toFixed(Math.abs(pct) < 1 ? 1 : 0);
  return s + "%p";
}
// 셀에 마우스를 올렸을 때 보여줄 정밀값 — 소수점 3자리까지 (표에 보이는 값은 반올림돼 있다).
function fmtPctExact(v: number): string {
  return (v * 100).toFixed(3) + "%";
}
function fmtDeltaExact(d: number): string {
  return (d >= 0 ? "+" : "") + (d * 100).toFixed(3) + "%p";
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
  comments,
}: {
  quarters: string[];
  dataByQuarter: Record<string, AllocRateRow[]>;
  /** commentKey(quarter, basis) -> 저장된 관리자 코멘트 */
  comments: Record<string, string>;
}) {
  const router = useRouter();
  const [view, setView] = useState<string>(quarters[quarters.length - 1] ?? "");
  const [search, setSearch] = useState("");
  const [divisions, setDivisions] = useState<Set<string>>(new Set());
  const [types, setTypes] = useState<Set<string>>(new Set());
  const [changedOnly, setChangedOnly] = useState(false);
  // 저장이 끝난 코멘트. 저장 후 router.refresh()로 다시 받아오면 서버가 아직 예전 값을 주는 순간이 있어
  // 방금 적은 코멘트가 사라져 보인다 — 저장 성공 시 이 상태만 갱신한다.
  const [savedComments, setSavedComments] = useState<Record<string, string>>(comments);
  // 아직 저장하지 않은 입력값만 담는다 (키가 없으면 = 저장된 값과 같다).
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [savingComment, setSavingComment] = useState<string | null>(null);

  const isDelta = view === "delta";
  // 어느 두 분기를 비교할지는 콤보박스로 고른다. 예전에는 마지막 두 분기로 고정이라
  // 2Q-1Q 같은 지난 비교를 볼 수 없었다. 기본값은 예전과 같은 쌍이다.
  const deltaOptions = useMemo(() => deltaPairOptions(quarters), [quarters]);
  const [deltaKey, setDeltaKey] = useState<string>(() => defaultDeltaPairKey(quarters));
  const selectedPair = deltaOptions.find((o) => o.key === deltaKey) ?? deltaOptions[deltaOptions.length - 1] ?? null;
  const deltaPair: [string, string] | null = selectedPair ? [selectedPair.from, selectedPair.to] : null;
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

  // ---- 관리자 코멘트 ----
  /** 칸에 보여줄 값 — 저장 안 된 입력이 있으면 그것을 우선한다. */
  function commentValue(quarter: string, basis: string): string {
    const key = commentKey(quarter, basis);
    return commentDrafts[key] ?? savedComments[key] ?? "";
  }
  function commentDirty(quarter: string, basis: string): boolean {
    const key = commentKey(quarter, basis);
    return key in commentDrafts && commentDrafts[key] !== (savedComments[key] ?? "");
  }
  function changeComment(quarter: string, basis: string, value: string) {
    setCommentDrafts((prev) => ({ ...prev, [commentKey(quarter, basis)]: value }));
  }
  async function saveComment(quarter: string, basis: string) {
    const key = commentKey(quarter, basis);
    const content = commentDrafts[key] ?? savedComments[key] ?? "";
    setSavingComment(key);
    try {
      const res = await fetch("/api/admin/view-comment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quarter, basis, content }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(json.error ?? "코멘트 저장에 실패했습니다.");
        return;
      }
      setSavedComments((prev) => ({ ...prev, [key]: content }));
      setCommentDrafts((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } catch {
      alert("코멘트 저장에 실패했습니다. 네트워크 상태를 확인해주세요.");
    } finally {
      setSavingComment(null);
    }
  }

  /**
   * 코멘트 칸 — 분기 표와 변화 표가 똑같은 모습을 쓰도록 한곳에서 그린다.
   * 평소에는 글자만 보이고 커서를 올리면 입력칸과 초록 체크가 나타난다 (.comment-cell, globals.css).
   */
  function commentCell(quarter: string, basis: string) {
    const dirty = commentDirty(quarter, basis);
    return (
      <td className="col-comment">
        <div className="comment-cell">
          <input
            value={commentValue(quarter, basis)}
            onChange={(e) => changeComment(quarter, basis, e.target.value)}
            placeholder="코멘트"
            maxLength={500}
            // 표 안이라 폼 제출이 없다 — 엔터로도 저장되게 한다.
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                saveComment(quarter, basis);
              }
            }}
          />
          <button
            type="button"
            className={`note-save-btn${dirty ? " is-dirty" : ""}`}
            title={dirty ? "저장하지 않은 변경이 있습니다 — 눌러서 저장" : "저장"}
            aria-label="코멘트 저장"
            disabled={savingComment === commentKey(quarter, basis)}
            onClick={() => saveComment(quarter, basis)}
          >
            ✓
          </button>
        </div>
      </td>
    );
  }

  // 변화 표의 코멘트는 비교 대상인 나중 분기에 매어 저장한다 —
  // 그러면 그 분기 탭에서 적은 코멘트와 같은 칸이 되어 두 화면이 어긋나지 않는다.
  const deltaCommentQuarter = deltaPair ? deltaPair[1] : "";

  function matchesSearch(basis: string, division: string, type: string, comment: string) {
    if (!search) return true;
    const hay = `${basis} ${division} ${type} ${comment}`.toLowerCase();
    return hay.includes(search.toLowerCase());
  }

  const filteredQuarterRows = quarterRows.filter(
    (r) =>
      (divisions.size === 0 || divisions.has(r.division)) &&
      (types.size === 0 || types.has(r.type)) &&
      matchesSearch(r.basis, r.division, r.type, commentValue(view, r.basis))
  );
  const filteredDeltaRows = deltaRows.filter(
    (r) =>
      (divisions.size === 0 || divisions.has(r.division)) &&
      (types.size === 0 || types.has(r.type)) &&
      !(changedOnly && r.status === "same") &&
      matchesSearch(r.basis, r.division, r.type, commentValue(deltaCommentQuarter, r.basis))
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
      {
        label: "비교 대상 배부기준",
        value: `${deltaRows.length}건`,
        sub: deltaPair ? `${prettyQuarterLabel(deltaPair[0])} ∪ ${prettyQuarterLabel(deltaPair[1])} 합집합 기준` : "",
      },
      { label: "값 변경", value: `${changed}건`, sub: `${same}건은 변동 없음` },
      {
        label: `신규 추가 (${deltaPair ? prettyQuarterLabel(deltaPair[1]) : ""})`,
        value: `${added}건`,
        sub: added ? "이전 분기에 없던 배부기준" : "없음",
        ok: added === 0,
      },
      {
        label: `삭제됨 (${deltaPair ? prettyQuarterLabel(deltaPair[1]) : ""})`,
        value: `${removed}건`,
        sub: removed ? "이번 분기에서 제외됨" : "없음",
        ok: removed === 0,
      },
    ];
  } else {
    const total = quarterRows.length;
    const validated = quarterRows.filter((r) => Math.abs(r.total - 1) < 1e-6).length;
    const excluded = total - validated;
    stats = [
      { label: "배부기준", value: `${total}건`, sub: `${DIVISION_ORDER.length}개 구분 · ${TYPE_ORDER.length}개 유형` },
      { label: "적용 법인", value: `${TARGETS.length}개`, sub: "STB ~ H.Networks" },
      { label: "배부 유형", value: `${TYPE_ORDER.length}종`, sub: "리소스 · 건물 · IT · 고정비율" },
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
              {isDelta
                ? `배부율 변화 — ${prettyQuarterLabel(deltaPair?.[0] ?? "")} → ${prettyQuarterLabel(deltaPair?.[1] ?? "")}`
                : `${prettyQuarterLabel(view)} 배부율 마스터`}
            </div>
            <div className="panel-sub" style={{ maxWidth: 640 }}>
              {isDelta
                ? `${prettyQuarterLabel(deltaPair?.[0] ?? "")} 대비 ${prettyQuarterLabel(deltaPair?.[1] ?? "")} 배부기준 변경 내역을 한눈에 비교합니다. 법인별 배분 비율(%p) 증감을 색으로 표시합니다.`
                : `전체 조직 ${quarterRows.length}건의 리소스·인원수·직접비 배부율을 한 화면에서 비교합니다.`}
            </div>
          </div>
          <div className="av-qswitch" role="group" aria-label="분기 선택">
            {quarters.map((q) => (
              <button key={q} type="button" className={view === q ? "active" : ""} onClick={() => setView(q)}>
                {prettyQuarterLabel(q)}
              </button>
            ))}
            {deltaOptions.length > 0 && (
              <select
                className={`av-delta-pick ${isDelta ? "active" : ""}`}
                aria-label="변화 비교 분기"
                value={isDelta ? deltaKey : ""}
                onChange={(e) => {
                  const next = e.target.value;
                  if (!next) return;
                  setDeltaKey(next);
                  setView("delta");
                }}
              >
                <option value="" disabled>
                  변화 비교
                </option>
                {deltaOptions.map((o) => (
                  <option key={o.key} value={o.key}>
                    변화({o.label})
                  </option>
                ))}
              </select>
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
          placeholder="배부기준, 코멘트 검색…"
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
              {divisionLabel(d)} ({n})
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
            <span>{deltaPair ? prettyQuarterLabel(deltaPair[0]) : ""} → {deltaPair ? prettyQuarterLabel(deltaPair[1]) : ""} 변화</span>
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
              {/* update(반영 여부)는 검토 및 확정 > 조사 탭에서 확인하는 내용이라 여기서는 빼둔다. */}
              {isDelta ? <th>상태</th> : <th>TOTAL</th>}
              <th className="col-comment">코멘트</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 && (
              <tr>
                <td colSpan={TARGETS.length + 3}>
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
                              {divisionLabel(row.division)} <span className="grp-count">· {count}건</span>
                            </td>
                            <td colSpan={TARGETS.length + 2}></td>
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
                              <td
                                key={t.key}
                                className="heat-cell delta-solo"
                                title={
                                  r.status === "removed"
                                    ? `${deltaPair ? prettyQuarterLabel(deltaPair[0]) : ""} 값`
                                    : `${deltaPair ? prettyQuarterLabel(deltaPair[1]) : ""} 값`
                                }
                              >
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
                              title={`${r.basis} → ${t.label}: ${deltaPair ? prettyQuarterLabel(deltaPair[0]) : ""} ${fmtPctExact(
                                r.q1?.[t.key] ?? 0
                              )} → ${deltaPair ? prettyQuarterLabel(deltaPair[1]) : ""} ${fmtPctExact(
                                r.q2?.[t.key] ?? 0
                              )} (${fmtDeltaExact(d)})`}
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
                        {commentCell(deltaCommentQuarter, r.basis)}
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
                        if (v === 0)
                          return (
                            <td key={t.key} className="heat-cell zero" title={`${r.basis} → ${t.label}: ${fmtPctExact(0)}`}>
                              0
                            </td>
                          );
                        const hi = v >= 0.5;
                        return (
                          <td
                            key={t.key}
                            className={`heat-cell has-value${hi ? " hi" : ""}`}
                            style={{ ["--v" as any]: v.toFixed(4) }}
                            title={`${r.basis} → ${t.label}: ${fmtPctExact(v)}`}
                          >
                            {fmtPct(v, v < 0.01 ? 2 : 0)}
                          </td>
                        );
                      })}
                      <td className={`col-total ${totalOk ? "av-total-ok" : "av-total-excl"}`}>
                        {totalOk ? fmtPct(r.total, 0) : r.total === 0 ? "제외" : fmtPct(r.total, 0)}
                      </td>
                      {commentCell(view, r.basis)}
                    </tr>
                  </React.Fragment>
                );
              });
            })()}
          </tbody>
        </table>
      </div>

      <footer style={{ textAlign: "right" }}>소수점은 원본 계산값을 그대로 저장 — 표시는 반올림, 셀에 마우스를 올리면 소수점 3자리까지 표시됩니다</footer>
    </div>
  );
}
