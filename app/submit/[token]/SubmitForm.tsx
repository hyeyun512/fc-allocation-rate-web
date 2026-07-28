"use client";

import { useState } from "react";
import {
  TARGETS,
  TargetKey,
  sumTargets,
  fractionToPercentInput,
  percentInputToFraction,
} from "@/lib/targets";

type RateMap = Record<TargetKey, string>;

interface PersonRow {
  key: string;
  name: string;
  headcount: string;
  note: string;
  role: "법인" | "주재원";
  rates: RateMap;
}

interface OrgInfo {
  id: number;
  basis: string;
  division: string;
  type: string;
  manager_name: string | null;
  requires_person_detail: boolean;
}

export interface PreviousPersonRow {
  person_name: string;
  headcount: number | null;
  [key: string]: any; // TargetKey 컬럼들
}

function emptyRates(): RateMap {
  const r = {} as RateMap;
  TARGETS.forEach((t) => (r[t.key] = "0"));
  return r;
}

function ratesFromPrevious(previousRate: Record<TargetKey, number> | null): RateMap {
  const r = emptyRates();
  if (!previousRate) return r;
  TARGETS.forEach((t) => {
    const v = previousRate[t.key];
    if (v !== null && v !== undefined) r[t.key] = String(v);
  });
  return r;
}

function ratesFromRow(row: Record<string, any>): RateMap {
  const r = emptyRates();
  TARGETS.forEach((t) => {
    const v = row[t.key];
    if (v !== null && v !== undefined) r[t.key] = String(v);
  });
  return r;
}

function totalOf(rates: RateMap): number {
  const parsed = {} as Record<TargetKey, number>;
  TARGETS.forEach((t) => (parsed[t.key] = Number(rates[t.key]) || 0));
  return sumTargets(parsed);
}

// 합계가 0(미입력)이거나 100%에 근접해야 통과. "값은 있는데 100%가 아닌" 경우만 오류로 취급.
function totalIsValid(rates: RateMap): boolean {
  const total = totalOf(rates);
  return total === 0 || Math.abs(total - 1) < 0.005;
}

// 팀 구성원별 비율의 인원수 가중평균 -> 조직 단위 배부율(읽기 전용 표시값)
function averageFromPersons(persons: PersonRow[]): RateMap {
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

function RateTable({
  rates,
  onChange,
  readOnly,
}: {
  rates: RateMap;
  onChange: (key: TargetKey, value: string) => void;
  readOnly?: boolean;
}) {
  const total = totalOf(rates);
  const ok = Math.abs(total - 1) < 0.005 || total === 0;
  return (
    <div className="tbl-scroll">
      <table className="rate-tbl">
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
        <tbody>
          <tr>
            <td>비율</td>
            {TARGETS.map((t) => (
              <td key={t.key}>
                <div className="pct-input">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    disabled={readOnly}
                    value={fractionToPercentInput(rates[t.key])}
                    onChange={(e) => onChange(t.key, percentInputToFraction(e.target.value))}
                  />
                  <span>%</span>
                </div>
              </td>
            ))}
            <td className={`total-col ${ok ? "total-ok" : "total-bad"}`}>{(total * 100).toFixed(1)}%</td>
          </tr>
        </tbody>
      </table>
      {!ok && (
        <div className="field-hint" style={{ color: "#dc2626" }}>
          ⚠ 합계가 100%가 아닙니다. 각 항목의 비율 합이 100%가 되도록 입력해주세요.
        </div>
      )}
    </div>
  );
}

export default function SubmitForm({
  token,
  org,
  period,
  version,
  previousRate,
  previousPersons,
  hasExpat,
}: {
  token: string;
  org: OrgInfo;
  period: string;
  version: string;
  previousRate: Record<TargetKey, number> | null;
  previousPersons: PreviousPersonRow[];
  hasExpat: boolean;
}) {
  const [submittedBy, setSubmittedBy] = useState(org.manager_name ?? "");
  const [headcount, setHeadcount] = useState("");
  const [note, setNote] = useState("");
  const [orgRates, setOrgRates] = useState<RateMap>(() => ratesFromPrevious(previousRate));
  const [persons, setPersons] = useState<PersonRow[]>(() => {
    // 개인별 추적은 안 하지만 주재원과 하나로 관리되는 조직(HBR/HDG/HUK 등)은
    // '법인 전체'를 나타내는 행 하나로 시작해서 주재원 행을 추가할 수 있게 한다.
    if (!org.requires_person_detail && hasExpat) {
      return [
        {
          key: "seed-org",
          name: org.manager_name ?? "법인 전체",
          headcount: "1",
          note: "",
          role: "법인",
          rates: ratesFromPrevious(previousRate),
        },
      ];
    }
    return [];
  });
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const prevHasValue = previousRate ? totalOf(ratesFromPrevious(previousRate)) > 0 : false;
  // 법인+주재원이 하나로 관리되는 조직(hasExpat)이거나 개인별 확인이 필요한 조직은
  // 팀 구성원별 표에서 입력을 받고, 조직 단위 배부율은 그 값들의 인원수 가중평균으로 자동 계산됨.
  const usesPersonTable = org.requires_person_detail || hasExpat;
  const legalPersons = persons.filter((p) => p.role !== "주재원");
  const expatPersons = persons.filter((p) => p.role === "주재원");
  const displayOrgRates = usesPersonTable ? averageFromPersons(legalPersons) : orgRates;
  const displayExpatRates = hasExpat ? averageFromPersons(expatPersons) : null;

  function updateOrgRate(key: TargetKey, value: string) {
    setOrgRates((r) => ({ ...r, [key]: value }));
  }

  function loadPreviousOrgRates() {
    setOrgRates(ratesFromPrevious(previousRate));
  }

  function loadPreviousPersons() {
    setPersons(
      previousPersons.map((p, i) => ({
        key: `prev-${i}-${Date.now()}`,
        name: p.person_name,
        headcount: p.headcount != null ? String(p.headcount) : "1",
        note: (p.note as string) ?? "",
        role: p.sub_team === "주재원" ? "주재원" : "법인",
        rates: ratesFromRow(p),
      }))
    );
  }

  function addPerson() {
    setPersons((list) => [
      ...list,
      { key: `${Date.now()}-${list.length}`, name: "", headcount: "1", note: "", role: "법인", rates: emptyRates() },
    ]);
  }

  function removePerson(key: string) {
    setPersons((list) => list.filter((p) => p.key !== key));
  }

  function updatePerson(key: string, patch: Partial<PersonRow>) {
    setPersons((list) => list.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  }

  function updatePersonRate(key: string, target: TargetKey, value: string) {
    setPersons((list) =>
      list.map((p) => (p.key === key ? { ...p, rates: { ...p.rates, [target]: value } } : p))
    );
  }

  async function handleSubmit() {
    if (!submittedBy.trim()) {
      setErrorMsg("입력자 이름을 적어주세요.");
      setStatus("error");
      return;
    }

    if (usesPersonTable) {
      const invalidPerson = persons.find((p) => p.name.trim() && !totalIsValid(p.rates));
      if (invalidPerson) {
        setErrorMsg(`'${invalidPerson.name}'님의 비율 합계가 100%가 아닙니다. 확인 후 다시 제출해주세요.`);
        setStatus("error");
        return;
      }
    } else if (!totalIsValid(orgRates)) {
      setErrorMsg("조직 단위 배부율 합계가 100%가 아닙니다. 확인 후 다시 제출해주세요.");
      setStatus("error");
      return;
    }

    setStatus("submitting");
    setErrorMsg("");
    try {
      const res = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          submittedBy,
          headcount: headcount ? Number(headcount) : null,
          note,
          orgRates: displayOrgRates,
          persons: persons.map((p) => ({
            name: p.name,
            headcount: p.headcount ? Number(p.headcount) : null,
            note: p.note,
            subTeam: p.role === "주재원" ? "주재원" : null,
            rates: p.rates,
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "제출 중 오류가 발생했습니다.");
      setStatus("success");
    } catch (e: any) {
      setStatus("error");
      setErrorMsg(e.message || "제출 중 오류가 발생했습니다.");
    }
  }

  if (status === "success") {
    return (
      <div className="page page-narrow">
        <div className="panel">
          <div className="callout success">
            <b>제출이 완료되었습니다.</b> 담당자 검토 후 최종 반영됩니다. 수정이 필요하면 이 링크로 다시 접속해서 재제출하실 수 있습니다.
          </div>
          <button className="btn btn-secondary" onClick={() => setStatus("idle")}>
            다시 입력하기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="panel">
        <div className="panel-title">
          {org.basis} 배부율 입력 <span className="tag">{period} · {version}</span>
        </div>
        <div className="panel-sub">
          구분: {org.division} / {org.type}
          {!usesPersonTable && previousRate && prevHasValue
            ? " · 직전 확정값이 미리 채워져 있습니다. 변경된 부분만 수정해주세요."
            : ""}
        </div>

        <div className="field-row" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div className="field">
            <label>입력자 (책임자/담당자 이름) *</label>
            <input value={submittedBy} onChange={(e) => setSubmittedBy(e.target.value)} placeholder="예: 이용길 팀장님" />
          </div>
          <div className="field">
            <label>조직 전체 인원수</label>
            <input type="number" min="0" value={headcount} onChange={(e) => setHeadcount(e.target.value)} placeholder="예: 3" />
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4, marginBottom: 8 }}>
          <div className="panel-sub" style={{ margin: 0 }}>
            ■ 조직 단위 배부율 (단위: %){hasExpat && " · 법인분"}
            {usesPersonTable && " — 아래 표의 '법인' 행 값의 평균으로 자동 계산됩니다"}
          </div>
          {!usesPersonTable && previousRate && (
            <button className="btn btn-secondary btn-sm" onClick={loadPreviousOrgRates}>
              전분기 값 불러오기
            </button>
          )}
        </div>
        <RateTable rates={displayOrgRates} onChange={updateOrgRate} readOnly={usesPersonTable} />

        {hasExpat && displayExpatRates && (
          <>
            <div className="panel-sub" style={{ margin: "10px 0 8px" }}>
              ■ 주재원분 (자동 계산 참고용)
            </div>
            <RateTable rates={displayExpatRates} onChange={() => {}} readOnly />
          </>
        )}

        <div className="field" style={{ marginTop: 14 }}>
          <label>비고 (특이사항이 있으면 적어주세요)</label>
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>

      {usesPersonTable && (
        <div className="panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
            <div>
              <div className="panel-title">■ {org.requires_person_detail ? "팀 구성원별" : ""} 배부율{hasExpat ? " (법인/주재원 함께 입력)" : ""}</div>
              <div className="panel-sub">
                {hasExpat
                  ? "법인과 주재원을 한 표에서 같이 입력합니다. 각 행의 '구분'에서 법인/주재원을 선택해주세요."
                  : "관계사·계열사(H.Mobility~H.Networks)에 청구되는 조직이라 개인별 확인이 필요합니다. 팀원별로 행을 추가해 입력해주세요."}
              </div>
            </div>
            {previousPersons.length > 0 && (
              <button className="btn btn-secondary btn-sm" onClick={loadPreviousPersons}>
                전분기 데이터 끌고오기 ({previousPersons.length}명)
              </button>
            )}
          </div>
          {persons.map((p) => (
            <div key={p.key} style={{ marginBottom: 14, paddingBottom: 14, borderBottom: "0.5px solid #f1f5f9" }}>
              <div className="field-row" style={{ gridTemplateColumns: hasExpat ? "1.3fr 1fr 1fr 1.7fr auto" : "1.5fr 1fr 2fr auto", alignItems: "end" }}>
                <div className="field">
                  <label>이름</label>
                  <input value={p.name} onChange={(e) => updatePerson(p.key, { name: e.target.value })} placeholder="이름" />
                </div>
                <div className="field">
                  <label>인원수</label>
                  <input type="number" min="0" value={p.headcount} onChange={(e) => updatePerson(p.key, { headcount: e.target.value })} />
                </div>
                {hasExpat && (
                  <div className="field">
                    <label>구분</label>
                    <select value={p.role} onChange={(e) => updatePerson(p.key, { role: e.target.value as "법인" | "주재원" })}>
                      <option value="법인">법인</option>
                      <option value="주재원">주재원</option>
                    </select>
                  </div>
                )}
                <div className="field">
                  <label>코멘트</label>
                  <input value={p.note} onChange={(e) => updatePerson(p.key, { note: e.target.value })} placeholder="담당 업무, 특이사항 등" />
                </div>
                <button className="btn btn-danger btn-sm" onClick={() => removePerson(p.key)}>
                  삭제
                </button>
              </div>
              <RateTable rates={p.rates} onChange={(k, v) => updatePersonRate(p.key, k, v)} />
            </div>
          ))}
          <div className="person-row-actions">
            <button className="btn btn-secondary btn-sm" onClick={addPerson}>
              + {hasExpat ? "인원" : "팀원"} 추가
            </button>
          </div>
        </div>
      )}

      {status === "error" && <div className="callout alert">{errorMsg}</div>}

      <button className="btn btn-primary" disabled={status === "submitting"} onClick={handleSubmit}>
        {status === "submitting" ? "제출 중..." : "제출하기"}
      </button>
    </div>
  );
}
