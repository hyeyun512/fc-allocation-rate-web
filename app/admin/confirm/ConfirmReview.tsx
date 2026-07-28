"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import AdminNav from "../AdminNav";
import {
  TARGETS,
  TargetKey,
  sumTargets,
  fractionToPercentInput,
  percentInputToFraction,
  groupDivisionLabel,
  getPreviousPeriod,
} from "@/lib/targets";

export type PersonRole = "법인" | "주재원";

export interface PersonHistoryEntry {
  name: string;
  period: string;
  headcount: number | null;
  rates: Record<TargetKey, number>;
  total: number;
  submittedAt: string;
  note: string | null;
  role: PersonRole;
}

export interface RateHistoryEntry {
  quarter: string;
  rates: Record<TargetKey, number>;
  total: number;
}

export interface CurrentPerson {
  name: string;
  headcount: number | null;
  rates: Record<TargetKey, number>;
  note: string | null;
  role: PersonRole;
}

export interface OrgReviewData {
  org: {
    id: number;
    basis: string;
    division: string;
    type: string;
    requires_person_detail: boolean;
    access_token: string;
  };
  hasSubmission: boolean;
  submittedBy: string | null;
  latestSubmittedAt: string | null;
  confirmedThisPeriod: boolean;
  rollup: Record<TargetKey, number>;
  currentOrgSubmission: Record<TargetKey, number> | null;
  currentPersons: CurrentPerson[];
  currentRate: Record<TargetKey, number> | null;
  currentQuarter: string | null;
  personHistory: PersonHistoryEntry[];
  rateHistory: RateHistoryEntry[];
  expat: OrgReviewData | null;
  children: OrgReviewData[];
}

type RateMap = Record<TargetKey, string>;

interface PersonEditRow {
  key: string;
  name: string;
  headcount: string;
  note: string;
  role: PersonRole;
  rates: RateMap;
}

function emptyRates(): RateMap {
  const r = {} as RateMap;
  TARGETS.forEach((t) => (r[t.key] = "0"));
  return r;
}

function toRateMap(rec: Record<TargetKey, number> | null): RateMap {
  const r = emptyRates();
  if (!rec) return r;
  TARGETS.forEach((t) => (r[t.key] = String(rec[t.key] ?? 0)));
  return r;
}

function totalOf(rates: RateMap): number {
  const parsed = {} as Record<TargetKey, number>;
  TARGETS.forEach((t) => (parsed[t.key] = Number(rates[t.key]) || 0));
  return sumTargets(parsed);
}

function totalIsValid(rates: RateMap): boolean {
  const total = totalOf(rates);
  return total === 0 || Math.abs(total - 1) < 0.005;
}

function recTotal(rec: Record<TargetKey, number>): number {
  return TARGETS.reduce((sum, t) => sum + (rec[t.key] || 0), 0);
}

function toNumRec(rates: RateMap): Record<TargetKey, number> {
  const r = {} as Record<TargetKey, number>;
  TARGETS.forEach((t) => (r[t.key] = Number(rates[t.key]) || 0));
  return r;
}

function averageFromPersons(persons: PersonEditRow[]): RateMap {
  const named = persons.filter((p) => p.name.trim());
  const r = emptyRates();
  if (named.length === 0) return r;
  const totalHc = named.reduce((sum, p) => sum + (Number(p.headcount) || 1), 0) || named.length;
  TARGETS.forEach((t) => {
    const weighted = named.reduce((sum, p) => {
      const hc = Number(p.headcount) || 1;
      return sum + (Number(p.rates[t.key]) || 0) * hc;
    }, 0);
    r[t.key] = String(totalHc > 0 ? weighted / totalHc : 0);
  });
  return r;
}

// 상위 집계 조직(예: 경영지원실)의 값 = 하위 조직들(예: 재무팀, Staff(경영지원))의 인원수 가중평균.
function weightedAvgFromChildren(children: OrgReviewData[]): RateMap {
  const r = emptyRates();
  if (children.length === 0) return r;
  const weights = children.map((c) => {
    const hc = c.currentPersons.reduce((s, p) => s + (Number(p.headcount) || 1), 0);
    return hc > 0 ? hc : 1;
  });
  const totalW = weights.reduce((a, b) => a + b, 0) || children.length;
  TARGETS.forEach((t) => {
    const weighted = children.reduce((sum, c, i) => {
      const rate = c.hasSubmission ? c.rollup[t.key] : c.currentRate ? c.currentRate[t.key] : 0;
      return sum + (Number(rate) || 0) * weights[i];
    }, 0);
    r[t.key] = String(totalW > 0 ? weighted / totalW : 0);
  });
  return r;
}

function RateTableHead() {
  return (
    <thead>
      <tr>
        <th></th>
        {TARGETS.map((t) => (
          <th key={t.key} className={t.group === "humax" ? "grp-humax" : "grp-affiliate"}>
            {t.label}
          </th>
        ))}
        <th>TOTAL</th>
      </tr>
    </thead>
  );
}

function ReadOnlyRateRow({ label, rec }: { label: string; rec: Record<TargetKey, number> }) {
  const total = recTotal(rec);
  return (
    <tr className="ro-row">
      <td>{label}</td>
      {TARGETS.map((t) => (
        <td key={t.key}>{((rec[t.key] || 0) * 100).toFixed(1)}%</td>
      ))}
      <td className="total-col">{(total * 100).toFixed(1)}%</td>
    </tr>
  );
}

function EditableRateRow({ label, rates, onChange }: { label: string; rates: RateMap; onChange: (key: TargetKey, value: string) => void }) {
  const total = totalOf(rates);
  const ok = Math.abs(total - 1) < 0.005 || total === 0;
  return (
    <tr>
      <td>{label}</td>
      {TARGETS.map((t) => (
        <td key={t.key}>
          <div className="pct-input">
            <input
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={fractionToPercentInput(rates[t.key])}
              onChange={(e) => onChange(t.key, percentInputToFraction(e.target.value))}
            />
            <span>%</span>
          </div>
        </td>
      ))}
      <td className={`total-col ${ok ? "total-ok" : "total-bad"}`}>{(total * 100).toFixed(1)}%</td>
    </tr>
  );
}

const PERSON_COLS = TARGETS.length + 5; // 이름/인원수/구분/TOTAL/코멘트

function personRowFromCurrent(p: CurrentPerson, i: number): PersonEditRow {
  return {
    key: `${i}-${p.name}`,
    name: p.name,
    headcount: p.headcount != null ? String(p.headcount) : "1",
    note: p.note ?? "",
    role: p.role,
    rates: toRateMap(p.rates),
  };
}

// 개인별 추적을 안 하지만 주재원과 하나로 관리되는 조직(HBR/HDG/HUK 등)은
// '법인 전체'를 나타내는 행 하나로 시작해서 주재원 행을 추가할 수 있게 한다.
function initialPersons(item: OrgReviewData): PersonEditRow[] {
  if (item.currentPersons.length > 0) {
    return item.currentPersons.map(personRowFromCurrent);
  }
  if (item.expat && !item.org.requires_person_detail) {
    return [
      {
        key: "seed-org",
        name: item.submittedBy ?? "법인 전체",
        headcount: "1",
        note: "",
        role: "법인",
        rates: toRateMap(item.currentOrgSubmission ?? item.currentRate),
      },
    ];
  }
  return [];
}

// ---------- 상위 집계 조직 (경영지원실 등) : 하위 조직 인원수 가중평균, 읽기 전용 + 확정 스냅샷 ----------
function ParentOrgDetail({ item, period, version }: { item: OrgReviewData; period: string; version: string }) {
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(item.confirmedThisPeriod);
  const [error, setError] = useState("");

  const pastRateHistory = item.rateHistory.filter((h) => h.quarter !== period);
  const computed = weightedAvgFromChildren(item.children);
  const total = totalOf(computed);
  const totalOk = Math.abs(total - 1) < 0.005 || total === 0;

  async function handleConfirm() {
    setError("");
    if (!totalIsValid(computed)) {
      setError("하위 조직 값이 아직 충분히 입력되지 않아 합계가 100%가 아닙니다.");
      return;
    }
    setConfirming(true);
    try {
      const res = await fetch("/api/admin/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId: item.org.id, period, version, rates: computed }),
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
      <div style={{ marginBottom: 14 }}>
        <div className="panel-title">
          {item.org.basis}{" "}
          <span className="status-badge" style={{ background: "#eff6ff", color: "#2563eb" }}>
            집계 조직
          </span>{" "}
          {confirmed ? (
            <span className="status-badge status-confirmed">확정됨 ({period})</span>
          ) : (
            <span className="status-badge" style={{ background: "#f1f5f9", color: "#64748b" }}>
              미확정
            </span>
          )}
        </div>
        <div className="panel-sub">
          {item.org.division} · 하위 조직({item.children.map((c) => c.org.basis).join(" + ")})의 인원수 가중평균으로 자동 계산됩니다. 하위 조직에서 직접 입력해주세요.
        </div>
      </div>

      <div className="tbl-scroll" style={{ marginBottom: 12 }}>
        <table className="rate-tbl">
          <RateTableHead />
          <tbody>
            {pastRateHistory.map((h) => (
              <ReadOnlyRateRow key={h.quarter} label={h.quarter} rec={h.rates} />
            ))}
            <ReadOnlyRateRow label={`${period} (자동계산)`} rec={toNumRec(computed)} />
          </tbody>
        </table>
      </div>
      {!totalOk && (
        <div className="field-hint" style={{ color: "#dc2626", marginBottom: 12 }}>
          ⚠ {period} 합계가 100%가 아닙니다 — 하위 조직 입력을 확인해주세요.
        </div>
      )}

      <div className="panel-sub" style={{ fontWeight: 700, color: "#1a202c", margin: "0 0 8px" }}>
        ■ 하위 조직 현황
      </div>
      <div className="tbl-scroll" style={{ marginBottom: 12 }}>
        <table className="rate-tbl">
          <RateTableHead />
          <tbody>
            {item.children.map((c) => (
              <ReadOnlyRateRow
                key={c.org.id}
                label={`${c.org.basis}${c.hasSubmission ? "" : " (미제출)"}`}
                rec={c.hasSubmission ? c.rollup : c.currentRate ?? toNumRec(emptyRates())}
              />
            ))}
          </tbody>
        </table>
      </div>

      {error && <div className="callout alert" style={{ marginBottom: 12 }}>{error}</div>}
      <button className="btn btn-primary btn-sm" disabled={confirming} onClick={handleConfirm}>
        {confirming ? "반영 중..." : "확정 (allocation_rate 반영)"}
      </button>
    </div>
  );
}

function OrgDetail({ item, period, version }: { item: OrgReviewData; period: string; version: string }) {
  const [orgUnlocked, setOrgUnlocked] = useState(false);
  const [personsUnlocked, setPersonsUnlocked] = useState(false);
  const [orgRates, setOrgRates] = useState<RateMap>(() => toRateMap(item.currentOrgSubmission ?? item.currentRate));
  const [persons, setPersons] = useState<PersonEditRow[]>(() => initialPersons(item));
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(item.confirmedThisPeriod && (!item.expat || item.expat.confirmedThisPeriod));
  const [error, setError] = useState("");

  const hasExpat = !!item.expat;
  const usesPersonTable = item.org.requires_person_detail || hasExpat;
  const pastRateHistory = item.rateHistory.filter((h) => h.quarter !== period);
  const pastPersonHistory = item.personHistory.filter((h) => h.period !== period);
  const pastExpatHistory = hasExpat ? item.expat!.rateHistory.filter((h) => h.quarter !== period) : [];
  const prevPeriod = getPreviousPeriod(period);
  const previousPersonsForOrg = prevPeriod ? item.personHistory.filter((h) => h.period === prevPeriod) : [];

  function loadPreviousPersons() {
    setPersons(
      previousPersonsForOrg.map((p, i) => ({
        key: `prev-${i}-${Date.now()}`,
        name: p.name,
        headcount: p.headcount != null ? String(p.headcount) : "1",
        note: p.note ?? "",
        role: p.role,
        rates: toRateMap(p.rates),
      }))
    );
  }

  const orgEditable = usesPersonTable ? false : confirmed ? orgUnlocked : true;
  const personsEditable = usesPersonTable ? (confirmed ? personsUnlocked : true) : false;

  const legalPersons = persons.filter((p) => p.role !== "주재원");
  const expatPersons = persons.filter((p) => p.role === "주재원");
  const computedOrgRates = usesPersonTable ? averageFromPersons(legalPersons) : orgRates;
  const computedExpatRates = hasExpat ? averageFromPersons(expatPersons) : null;

  function updateOrgRate(key: TargetKey, value: string) {
    setOrgRates((r) => ({ ...r, [key]: value }));
  }
  function updatePersonRate(key: string, target: TargetKey, value: string) {
    setPersons((list) => list.map((p) => (p.key === key ? { ...p, rates: { ...p.rates, [target]: value } } : p)));
  }
  function updatePerson(key: string, patch: Partial<PersonEditRow>) {
    setPersons((list) => list.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  }
  function addPerson() {
    setPersons((list) => [...list, { key: `${Date.now()}`, name: "", headcount: "1", note: "", role: "법인", rates: emptyRates() }]);
  }
  function removePerson(key: string) {
    setPersons((list) => list.filter((p) => p.key !== key));
  }

  async function handleConfirm() {
    setError("");
    if (usesPersonTable) {
      const invalid = persons.find((p) => p.name.trim() && !totalIsValid(p.rates));
      if (invalid) {
        setError(`'${invalid.name}'님의 비율 합계가 100%가 아닙니다.`);
        return;
      }
    } else if (!totalIsValid(orgRates)) {
      setError("조직 단위 배부율 합계가 100%가 아닙니다.");
      return;
    }
    setConfirming(true);
    try {
      const res = await fetch("/api/admin/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId: item.org.id, period, version, rates: computedOrgRates }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "확정 처리 중 오류가 발생했습니다.");

      if (hasExpat && computedExpatRates && totalOf(computedExpatRates) > 0) {
        const res2 = await fetch("/api/admin/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orgId: item.expat!.org.id, period, version, rates: computedExpatRates }),
        });
        const json2 = await res2.json();
        if (!res2.ok) throw new Error(json2.error || "주재원 확정 처리 중 오류가 발생했습니다.");
      }

      setConfirmed(true);
      setOrgUnlocked(false);
      setPersonsUnlocked(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setConfirming(false);
    }
  }

  const total = totalOf(computedOrgRates);
  const totalOk = Math.abs(total - 1) < 0.005 || total === 0;
  const expatTotal = computedExpatRates ? totalOf(computedExpatRates) : 0;
  const expatTotalOk = !computedExpatRates || expatTotal === 0 || Math.abs(expatTotal - 1) < 0.005;

  return (
    <div className="panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
        <div>
          <div className="panel-title">
            {item.org.basis}
            {hasExpat && <span className="status-badge" style={{ background: "#fef3c7", color: "#92400e", marginLeft: 6 }}>법인+주재원</span>}{" "}
            {confirmed ? (
              <span className="status-badge status-confirmed">확정됨 ({period})</span>
            ) : (
              <span className="status-badge" style={{ background: "#f1f5f9", color: "#64748b" }}>
                미확정
              </span>
            )}
          </div>
          <div className="panel-sub">
            {item.org.division} · {usesPersonTable ? "개인별 확인 필요" : "조직 단위"}
            {item.submittedBy ? ` · 제출자: ${item.submittedBy}` : ""}
            {item.latestSubmittedAt ? ` · ${new Date(item.latestSubmittedAt).toLocaleString("ko-KR")}` : ""}
          </div>
        </div>
      </div>

      <div className="panel-sub" style={{ fontWeight: 700, color: "#1a202c", margin: "0 0 8px" }}>
        ■ 조직별 리소스 배부율{hasExpat ? " (법인분)" : ""}
      </div>
      <div className="tbl-scroll" style={{ marginBottom: 12 }}>
        <table className="rate-tbl">
          <RateTableHead />
          <tbody>
            {pastRateHistory.map((h) => (
              <ReadOnlyRateRow key={h.quarter} label={h.quarter} rec={h.rates} />
            ))}
            {orgEditable ? (
              <EditableRateRow label={`${period} (입력중)`} rates={usesPersonTable ? computedOrgRates : orgRates} onChange={updateOrgRate} />
            ) : (
              <ReadOnlyRateRow label={`${period}${usesPersonTable ? " (자동계산)" : ""}`} rec={toNumRec(computedOrgRates)} />
            )}
          </tbody>
        </table>
      </div>
      {!totalOk && (
        <div className="field-hint" style={{ color: "#dc2626", marginBottom: 12 }}>
          ⚠ {period} 합계가 100%가 아닙니다.
        </div>
      )}

      {hasExpat && (
        <>
          <div className="panel-sub" style={{ fontWeight: 700, color: "#1a202c", margin: "0 0 8px" }}>
            ■ 주재원분 ({item.expat!.org.basis})
          </div>
          <div className="tbl-scroll" style={{ marginBottom: 12 }}>
            <table className="rate-tbl">
              <RateTableHead />
              <tbody>
                {pastExpatHistory.map((h) => (
                  <ReadOnlyRateRow key={h.quarter} label={h.quarter} rec={h.rates} />
                ))}
                <ReadOnlyRateRow label={`${period} (자동계산)`} rec={toNumRec(computedExpatRates ?? emptyRates())} />
              </tbody>
            </table>
          </div>
          {!expatTotalOk && (
            <div className="field-hint" style={{ color: "#dc2626", marginBottom: 12 }}>
              ⚠ 주재원 {period} 합계가 100%가 아닙니다 — 아래 표에서 '주재원' 구분 행을 확인해주세요.
            </div>
          )}
        </>
      )}

      {usesPersonTable && (
        <>
          <div className="panel-sub" style={{ fontWeight: 700, color: "#1a202c", margin: "0 0 8px" }}>
            ■ 개인별 리소스 배부율{hasExpat ? " (법인/주재원 함께)" : ""}
          </div>

          {(pastPersonHistory.length > 0 || pastExpatHistory.length > 0) && (
            <div className="tbl-scroll" style={{ marginBottom: 12 }}>
              <table className="rate-tbl">
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>이름</th>
                    <th>인원수</th>
                    {hasExpat && <th>구분</th>}
                    {TARGETS.map((t) => (
                      <th key={t.key} className={t.group === "humax" ? "grp-humax" : "grp-affiliate"}>
                        {t.label}
                      </th>
                    ))}
                    <th>TOTAL</th>
                    <th>코멘트</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    type Row = { name: string; period: string; headcount: number | null; rates: Record<TargetKey, number>; total: number; note: string | null; role: PersonRole };
                    const combined: Row[] = [
                      ...pastPersonHistory,
                      ...pastExpatHistory.map((h) => ({
                        name: `(${item.expat!.org.basis})`,
                        period: h.quarter,
                        headcount: 1,
                        rates: h.rates,
                        total: h.total,
                        note: null,
                        role: "주재원" as PersonRole,
                      })),
                    ].sort((a, b) => a.period.localeCompare(b.period) || a.name.localeCompare(b.name));

                    let lastPeriod: string | null = null;
                    return combined.map((p) => {
                      const newPeriod = p.period !== lastPeriod;
                      lastPeriod = p.period;
                      return (
                        <Fragment key={`${p.name}-${p.period}-${p.role}`}>
                          {newPeriod && (
                            <tr className="ro-row">
                              <td colSpan={PERSON_COLS - (hasExpat ? 0 : 1)} style={{ textAlign: "left", fontWeight: 700 }}>
                                {p.period}
                              </td>
                            </tr>
                          )}
                          <tr className="ro-row">
                            <td style={{ textAlign: "left" }}>{p.name}</td>
                            <td>{p.headcount ?? "-"}</td>
                            {hasExpat && <td>{p.role}</td>}
                            {TARGETS.map((t) => (
                              <td key={t.key}>{((p.rates[t.key] || 0) * 100).toFixed(1)}%</td>
                            ))}
                            <td className="total-col">{(p.total * 100).toFixed(1)}%</td>
                            <td>
                              {p.note && (
                                <button className="av-note-btn" type="button">
                                  i<span className="tip">{p.note}</span>
                                </button>
                              )}
                            </td>
                          </tr>
                        </Fragment>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
            <div className="field-hint" style={{ fontWeight: 700, color: personsEditable ? "#2563eb" : "#1a202c", margin: 0 }}>
              {period} {personsEditable ? "(입력중)" : "(확정됨)"}
            </div>
            {personsEditable && previousPersonsForOrg.length > 0 && (
              <button className="btn btn-secondary btn-sm" onClick={loadPreviousPersons}>
                전분기 데이터 끌고오기 ({previousPersonsForOrg.length}명)
              </button>
            )}
          </div>
          {personsEditable ? (
            <>
              <div className="tbl-scroll" style={{ marginBottom: 12 }}>
                <table className="rate-tbl">
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left" }}>이름</th>
                      <th>인원수</th>
                      {hasExpat && <th>구분</th>}
                      {TARGETS.map((t) => (
                        <th key={t.key} className={t.group === "humax" ? "grp-humax" : "grp-affiliate"}>
                          {t.label}
                        </th>
                      ))}
                      <th>TOTAL</th>
                      <th>코멘트</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {persons.map((p) => {
                      const pTotal = totalOf(p.rates);
                      const pOk = Math.abs(pTotal - 1) < 0.005 || pTotal === 0;
                      return (
                        <tr key={p.key}>
                          <td style={{ textAlign: "left" }}>
                            <input value={p.name} onChange={(e) => updatePerson(p.key, { name: e.target.value })} placeholder="이름" style={{ width: 100 }} />
                          </td>
                          <td>
                            <input
                              type="number"
                              min="0"
                              value={p.headcount}
                              onChange={(e) => updatePerson(p.key, { headcount: e.target.value })}
                              style={{ width: 44 }}
                            />
                          </td>
                          {hasExpat && (
                            <td>
                              <select value={p.role} onChange={(e) => updatePerson(p.key, { role: e.target.value as PersonRole })}>
                                <option value="법인">법인</option>
                                <option value="주재원">주재원</option>
                              </select>
                            </td>
                          )}
                          {TARGETS.map((t) => (
                            <td key={t.key}>
                              <div className="pct-input">
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  max="100"
                                  value={fractionToPercentInput(p.rates[t.key])}
                                  onChange={(e) => updatePersonRate(p.key, t.key, percentInputToFraction(e.target.value))}
                                />
                                <span>%</span>
                              </div>
                            </td>
                          ))}
                          <td className={`total-col ${pOk ? "total-ok" : "total-bad"}`}>{(pTotal * 100).toFixed(1)}%</td>
                          <td>
                            <input
                              value={p.note}
                              onChange={(e) => updatePerson(p.key, { note: e.target.value })}
                              placeholder="코멘트"
                              style={{ width: 120 }}
                            />
                          </td>
                          <td>
                            <button className="btn btn-danger btn-sm" onClick={() => removePerson(p.key)}>
                              삭제
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="person-row-actions">
                <button className="btn btn-secondary btn-sm" onClick={addPerson}>
                  + {hasExpat ? "인원" : "팀원"} 추가
                </button>
              </div>
            </>
          ) : (
            <div className="tbl-scroll" style={{ marginBottom: 12 }}>
              <table className="rate-tbl">
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>이름</th>
                    <th>인원수</th>
                    {hasExpat && <th>구분</th>}
                    {TARGETS.map((t) => (
                      <th key={t.key} className={t.group === "humax" ? "grp-humax" : "grp-affiliate"}>
                        {t.label}
                      </th>
                    ))}
                    <th>TOTAL</th>
                    <th>코멘트</th>
                  </tr>
                </thead>
                <tbody>
                  {persons.map((p) => (
                    <tr key={p.key} className="ro-row">
                      <td style={{ textAlign: "left" }}>{p.name}</td>
                      <td>{p.headcount ?? "-"}</td>
                      {hasExpat && <td>{p.role}</td>}
                      {TARGETS.map((t) => (
                        <td key={t.key}>{(Number(p.rates[t.key] || 0) * 100).toFixed(1)}%</td>
                      ))}
                      <td className="total-col">{(totalOf(p.rates) * 100).toFixed(1)}%</td>
                      <td>
                        {p.note && (
                          <button className="av-note-btn" type="button">
                            i<span className="tip">{p.note}</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {error && <div className="callout alert" style={{ marginTop: 12 }}>{error}</div>}

      <div style={{ marginTop: 14 }}>
        {confirmed && !(usesPersonTable ? personsUnlocked : orgUnlocked) ? (
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => (usesPersonTable ? setPersonsUnlocked(true) : setOrgUnlocked(true))}
          >
            재수정
          </button>
        ) : (
          <button className="btn btn-primary btn-sm" disabled={confirming} onClick={handleConfirm}>
            {confirming ? "반영 중..." : "확정 (allocation_rate 반영)"}
          </button>
        )}
      </div>
    </div>
  );
}

export default function ConfirmReview({
  period,
  version,
  data,
}: {
  period: string;
  version: string;
  data: OrgReviewData[];
}) {
  const [selectedId, setSelectedId] = useState<number | null>(data[0]?.org.id ?? null);
  const router = useRouter();

  const grouped = data.reduce<Record<string, OrgReviewData[]>>((acc, item) => {
    (acc[groupDivisionLabel(item.org.division)] ??= []).push(item);
    return acc;
  }, {});

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.push("/admin/login");
  }

  const selected = data.find((d) => d.org.id === selectedId) ?? null;

  return (
    <div className="page page-wide">
      <div className="topbar" style={{ marginBottom: 16, borderRadius: 12 }}>
        <div className="topbar-title">배부율 관리</div>
        <button className="btn btn-secondary btn-sm" onClick={logout}>
          로그아웃
        </button>
      </div>
      <AdminNav active="confirm" />

      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-title">조직/팀 선택 ({period})</div>
        <div className="panel-sub" style={{ marginBottom: 10 }}>
          조직을 선택하면 아래에서 분기별 이력과 이번 라운드 값을 검토·확정할 수 있습니다. 파란 배지가 붙은 조직은 하위 조직 값을 자동 집계하는 조직입니다.
        </div>
        {Object.entries(grouped).map(([division, items]) => (
          <div key={division} style={{ marginBottom: 10 }}>
            <span className="field-hint" style={{ marginRight: 8 }}>
              {division}
            </span>
            {items.map((item) => (
              <button
                key={item.org.id}
                type="button"
                className={`av-chip ${selectedId === item.org.id ? "active" : ""}`}
                style={{ marginRight: 6, marginBottom: 6 }}
                onClick={() => setSelectedId(item.org.id)}
              >
                {item.org.basis}
                {item.children.length > 0 ? " 📊" : ""}
                {item.expat ? " 🌐" : ""}
                {item.confirmedThisPeriod ? " ✓" : ""}
              </button>
            ))}
          </div>
        ))}
      </div>

      {selected && selected.children.length > 0 && (
        <ParentOrgDetail key={selected.org.id} item={selected} period={period} version={version} />
      )}
      {selected && selected.children.length === 0 && (
        <OrgDetail key={selected.org.id} item={selected} period={period} version={version} />
      )}
    </div>
  );
}
