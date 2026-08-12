"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AdminNav from "../AdminNav";
import SurveyOverview, { SurveyOrgData } from "../SurveyOverview";
import { prettyQuarterLabel } from "@/lib/quarter";
import ConfirmReview, { OrgReviewData, RateHistoryEntry } from "./ConfirmReview";
import ItPanel, { ItBasisRow } from "./ItPanel";
import SelfUsePanel, { SelfuseBasisRow } from "./SelfUsePanel";

type SubTab = "survey" | "resource" | "selfuse" | "it";

// 저장값(raw)은 기존 데이터와 동일한 "2026-Q1" 표기를 그대로 쓴다 — 화면 표기만 prettyQuarterLabel로 "2026-1Q"처럼 보여준다.
// 두 표기를 섞어 쓰면 같은 분기가 서로 다른 문자열로 저장되어 View 등에서 중복 분기로 보이는 문제가 생긴다.
const QUARTER_OPTIONS = ["2026-Q1", "2026-Q2", "2026-Q3", "2026-Q4"];
const CUSTOM_OPTION = "__custom__";
const FIXED_VERSION = "Forecast";

const SUB_TABS: { key: SubTab; label: string }[] = [
  { key: "survey", label: "조사" },
  { key: "resource", label: "리소스배부율" },
  { key: "selfuse", label: "자가사용(건물)" },
  { key: "it", label: "IT" },
];

export default function ConfirmTabs({
  period,
  version,
  mailSubject,
  mailBody,
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
  const [subTab, setSubTab] = useState<SubTab>("survey");
  const [periodInput, setPeriodInput] = useState(period);
  const [customPeriod, setCustomPeriod] = useState(!QUARTER_OPTIONS.includes(period));
  const [savingSettings, setSavingSettings] = useState(false);
  const router = useRouter();

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.push("/admin/login");
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
    await fetch("/api/admin/settings", {
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
      <AdminNav active="confirm" />

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
        <span className="admin-subtabs-label">검토 및 확정</span>
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
        <SurveyOverview period={period} data={surveyData} mailSubject={mailSubject} mailBody={mailBody} />
      )}
      {subTab === "resource" && (
        <ConfirmReview period={period} version={version} data={resourceData} hkrHistory={hkrHistory} hkrConfirmedThisPeriod={hkrConfirmedThisPeriod} />
      )}
      {subTab === "selfuse" && <SelfUsePanel key={period} period={period} initial={selfuse} history={selfuseHistory} />}
      {subTab === "it" && <ItPanel key={period} period={period} initialHeadcount={itHeadcount} initialSap={itSap} history={itHistory} />}
    </div>
  );
}
