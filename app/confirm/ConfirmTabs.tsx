"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Nav from "../Nav";
import SurveyOverview, { SurveyOrgData } from "../SurveyOverview";
import { prettyQuarterLabel } from "@/lib/quarter";
import { TargetColumns } from "@/components/RateParts";
import ConfirmReview, { OrgReviewData, RateHistoryEntry } from "./ConfirmReview";
import ItPanel, { ItBasisRow } from "./ItPanel";
import SelfUsePanel, { SelfuseBasisRow } from "./SelfUsePanel";

type SubTab = "survey" | "resource" | "selfuse" | "it";

// 저장값(raw)은 기존 데이터와 동일한 "2026-Q1" 표기를 그대로 쓴다 — 화면 표기만 prettyQuarterLabel로 "2026-1Q"처럼 보여준다.
// 두 표기를 섞어 쓰면 같은 분기가 서로 다른 문자열로 저장되어 View 등에서 중복 분기로 보이는 문제가 생긴다.
// 연간 예산(BP) 라운드는 "2027-BP"로 저장한다 — lib/quarter가 그 해 1Q 앞, 전년 4Q 뒤로 정렬한다.
const QUARTER_OPTIONS = ["2026-Q1", "2026-Q2", "2026-Q3", "2026-Q4", "2027-BP"];
const CUSTOM_OPTION = "__custom__";
const FIXED_VERSION = "Forecast";

/** 검토 화면에 나오는 분기 전부 — 하위·주재원 조직의 이력까지 훑는다 (보일 배부 대상 열을 정하는 데 쓴다). */
function shownPeriods(period: string, orgs: OrgReviewData[], hkrHistory: RateHistoryEntry[]): string[] {
  const out = [period, ...hkrHistory.map((h) => h.quarter)];
  const walk = (o: OrgReviewData | null) => {
    if (!o) return;
    o.rateHistory.forEach((h) => out.push(h.quarter));
    o.personHistory.forEach((h) => out.push(h.period));
    walk(o.expat);
    o.children.forEach(walk);
  };
  orgs.forEach(walk);
  return Array.from(new Set(out));
}

const SUB_TABS: { key: SubTab; label: string }[] = [
  { key: "resource", label: "리소스배부율" },
  { key: "selfuse", label: "자가사용(건물)" },
  { key: "it", label: "IT" },
  { key: "survey", label: "조사" },
];

export default function ConfirmTabs({
  period,
  version,
  mailSubject,
  mailBody,
  hasPreviousMail,
  surveyData,
  resourceData,
  hkrHistory,
  hkrConfirmedThisPeriod,
  itHeadcount,
  itSap,
  itHistory,
  selfuse,
  selfuseHistory,
}: {
  period: string;
  version: string;
  /** 조사 링크 안내 메일 문구 (비어 있으면 기본 문구). */
  mailSubject: string;
  mailBody: string;
  /** 이전 분기에 저장해 둔 문구가 있는지 — 있을 때만 불러오기 버튼을 보여준다. */
  hasPreviousMail: boolean;
  surveyData: SurveyOrgData[];
  resourceData: OrgReviewData[];
  hkrHistory: RateHistoryEntry[];
  hkrConfirmedThisPeriod: boolean;
  itHeadcount: ItBasisRow | null;
  itSap: ItBasisRow | null;
  itHistory: ItBasisRow[];
  selfuse: SelfuseBasisRow | null;
  selfuseHistory: SelfuseBasisRow[];
}) {
  // 처음 열리는 탭은 언제나 맨 앞 탭이다. 순서를 바꾸면 첫 화면도 따라오게 두어,
  // 탭 목록과 기본값이 따로 놀지 않게 한다.
  const [subTab, setSubTab] = useState<SubTab>(SUB_TABS[0].key);
  const [periodInput, setPeriodInput] = useState(period);
  const [customPeriod, setCustomPeriod] = useState(!QUARTER_OPTIONS.includes(period));
  const [savingSettings, setSavingSettings] = useState(false);
  const router = useRouter();

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    // 클라이언트 라우터로 옮기면 방금 본 검토 화면의 RSC 응답이 캐시에 남아 뒤로가기로 다시 보인다.
    // 로그아웃은 탭에 아무것도 남기지 않아야 하므로 문서 요청을 새로 보낸다.
    window.location.replace("/login");
  }

  function handlePeriodSelect(value: string) {
    if (value === CUSTOM_OPTION) {
      setCustomPeriod(true);
      return;
    }
    setCustomPeriod(false);
    setPeriodInput(value);
  }

  async function saveSettings() {
    setSavingSettings(true);
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ period: periodInput, version: FIXED_VERSION }),
    });
    setSavingSettings(false);
    router.refresh();
  }

  return (
    <div className="page page-wide">
      <div className="topbar" style={{ marginBottom: 16, borderRadius: 12 }}>
        <div className="topbar-title">배부율 관리</div>
        <button className="btn btn-secondary btn-sm" onClick={logout}>
          로그아웃
        </button>
      </div>
      <Nav active="confirm" />

      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-title">검토 및 확정 — 현재 라운드</div>
        <div className="field-row" style={{ gridTemplateColumns: customPeriod ? "1fr 1fr auto" : "1fr auto", alignItems: "end" }}>
          <div className="field">
            <label>기간</label>
            <select value={customPeriod ? CUSTOM_OPTION : periodInput} onChange={(e) => handlePeriodSelect(e.target.value)}>
              {QUARTER_OPTIONS.map((q) => (
                <option key={q} value={q}>
                  {prettyQuarterLabel(q)}
                </option>
              ))}
              <option value={CUSTOM_OPTION}>직접 입력...</option>
            </select>
          </div>
          {customPeriod && (
            <div className="field">
              <label>직접 입력</label>
              <input value={periodInput} onChange={(e) => setPeriodInput(e.target.value)} placeholder="예: 2026-Q1(청구)" />
            </div>
          )}
          <button className="btn btn-secondary" disabled={savingSettings} onClick={saveSettings}>
            {savingSettings ? "선택 중..." : "선택"}
          </button>
        </div>
        <div className="field-hint" style={{ marginTop: 6 }}>
          여기서 지정한 기간이 아래 조사/리소스배부율/자가사용(건물)/IT 전체에 적용됩니다. 조사 링크·제출 데이터에도 이 값이 함께 저장됩니다.
        </div>
      </div>

      <div className="admin-subtabs">
        {SUB_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`admin-subtab ${subTab === t.key ? "active" : ""}`}
            onClick={() => setSubTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {subTab === "survey" && (
        <SurveyOverview
          period={period}
          data={surveyData}
          mailSubject={mailSubject}
          mailBody={mailBody}
          hasPreviousMail={hasPreviousMail}
        />
      )}
      {subTab === "resource" && (
        <TargetColumns periods={shownPeriods(period, resourceData, hkrHistory)} current={period}>
          <ConfirmReview period={period} version={version} data={resourceData} hkrHistory={hkrHistory} hkrConfirmedThisPeriod={hkrConfirmedThisPeriod} />
        </TargetColumns>
      )}
      {subTab === "selfuse" && (
        <TargetColumns periods={[period, ...selfuseHistory.map((h) => h.quarter)]} current={period}>
          <SelfUsePanel key={period} period={period} initial={selfuse} history={selfuseHistory} />
        </TargetColumns>
      )}
      {subTab === "it" && (
        <TargetColumns periods={[period, ...itHistory.map((h) => h.quarter)]} current={period}>
          <ItPanel key={period} period={period} initialHeadcount={itHeadcount} initialSap={itSap} history={itHistory} />
        </TargetColumns>
      )}
    </div>
  );
}
