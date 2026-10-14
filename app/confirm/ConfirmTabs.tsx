"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Nav from "../Nav";
import SurveyOverview, { SurveyOrgData } from "../SurveyOverview";
import { TargetColumns } from "@/components/RateParts";
import { roundLabel } from "@/lib/surveyPeriods";
import ConfirmReview, { OrgReviewData, RateHistoryEntry, ReviewRound } from "./ConfirmReview";
import ItPanel, { ItBasisRow } from "./ItPanel";
import SelfUsePanel, { SelfuseBasisRow } from "./SelfUsePanel";
import BuildingPanel, { BuildingBasisRow } from "./BuildingPanel";
import { usesBuildingBasis } from "@/lib/selfuseBasis";
import { quarterRank } from "@/lib/quarter";

type SubTab = "survey" | "resource" | "selfuse" | "it";

// 저장값(raw)은 기존 데이터와 동일한 "2026-Q1" 표기를 그대로 쓴다 — 화면 표기만 prettyQuarterLabel로 "2026-1Q"처럼 보여준다.
// 두 표기를 섞어 쓰면 같은 분기가 서로 다른 문자열로 저장되어 View 등에서 중복 분기로 보이는 문제가 생긴다.
// 26년 4Q와 27년 BP는 함께 조사한다 — 묶음 라운드 하나로 고른다(lib/surveyPeriods의 ROUND_GROUPS).
const QUARTER_OPTIONS = ["2026-Q1", "2026-Q2", "2026-Q3", "2026-Q4+2027-BP"];
const CUSTOM_OPTION = "__custom__";
const FIXED_VERSION = "Forecast";

/** 검토 화면에 나오는 분기 전부 — 하위·주재원 조직의 이력까지 훑는다 (보일 배부 대상 열을 정하는 데 쓴다). */
function shownPeriods(periods: string[], orgs: OrgReviewData[], hkrHistory: RateHistoryEntry[]): string[] {
  const out = [...periods, ...hkrHistory.map((h) => h.quarter)];
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
  periods,
  round,
  version,
  mailSubject,
  mailBody,
  hasPreviousMail,
  surveyData,
  reviewRounds,
  hkrHistory,
  itHistory,
  selfuseHistory,
  buildingHistory,
}: {
  /**
   * 지금 라운드의 기간들 (기간 순서대로). 묶음 라운드(26년 4Q & 27년 BP)면 둘이고,
   * 검토·확정도 두 기간을 한 화면에서 함께 한다 — 표마다 기간별 행이 붙는다.
   */
  periods: string[];
  /** 지금 라운드 — 기간 하나이거나 묶음("2026-Q4+2027-BP"). 조사 링크는 라운드의 기간을 모두 연다. */
  round: string;
  version: string;
  /** 조사 링크 안내 메일 문구 (비어 있으면 기본 문구). */
  mailSubject: string;
  mailBody: string;
  /** 이전 분기에 저장해 둔 문구가 있는지 — 있을 때만 불러오기 버튼을 보여준다. */
  hasPreviousMail: boolean;
  surveyData: SurveyOrgData[];
  /** 기간마다의 리소스배부율 검토 데이터 (periods와 같은 순서). */
  reviewRounds: ReviewRound[];
  hkrHistory: RateHistoryEntry[];
  itHistory: ItBasisRow[];
  selfuseHistory: SelfuseBasisRow[];
  /** 27년 BP~ 건물(분당)/건물(용인) 기준정보 이력. */
  buildingHistory: BuildingBasisRow[];
}) {
  // 처음 열리는 탭은 언제나 맨 앞 탭이다. 순서를 바꾸면 첫 화면도 따라오게 두어,
  // 탭 목록과 기본값이 따로 놀지 않게 한다.
  const [subTab, setSubTab] = useState<SubTab>(SUB_TABS[0].key);
  // 자가사용(건물)을 쓰는 기간(~26년 4Q)과 건물(분당)/건물(용인)을 쓰는 기간(27년 BP~)으로 나눈다.
  const selfusePeriods = periods.filter((p) => !usesBuildingBasis(p));
  const buildingPeriods = periods.filter(usesBuildingBasis);
  const hasBuilding = buildingPeriods.length > 0;
  // 한 라운드(4Q+BP)가 두 표로 갈리면, 표 하나 안의 여러 기간과 같은 규칙 — 열린 기간을 모두 고쳐야 저장 —
  // 을 표를 건너 지키도록 서로 아직 고치지 않은 기간을 알려 준다. 기간이 하나뿐인 라운드는 상관없다.
  const splitSelfuse = selfusePeriods.length > 0 && hasBuilding;
  const [selfuseUntouched, setSelfuseUntouched] = useState<string[]>([]);
  const [buildingUntouched, setBuildingUntouched] = useState<string[]>([]);
  // 건물 기준정보에 이어 쓸 용인 재료비 비중 — 건물 기간 바로 앞의 확정된 자가사용 기준정보 (예: 2026-Q4).
  const materialSource =
    hasBuilding
      ? selfuseHistory
          .filter((h) => quarterRank(h.quarter) >= 0 && quarterRank(h.quarter) < quarterRank(buildingPeriods[0]))
          .sort((a, b) => quarterRank(a.quarter) - quarterRank(b.quarter))
          .pop() ?? null
      : null;
  const [periodInput, setPeriodInput] = useState(round);
  const [customPeriod, setCustomPeriod] = useState(!QUARTER_OPTIONS.includes(round));
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
      body: JSON.stringify({
        period: periodInput,
        version: FIXED_VERSION,
      }),
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
                  {roundLabel(q)}
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
          여기서 지정한 기간이 아래 조사/리소스배부율/자가사용(건물)/IT 전체에 적용되고, 조사 링크에도 이 기간이 열립니다.
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
            {/* 27년 BP가 끼면 이 탭에서 건물(분당)/건물(용인)도 받는다 — 이름에 함께 드러낸다. */}
            {t.key === "selfuse" && hasBuilding ? "자가사용·건물" : t.label}
          </button>
        ))}
      </div>

      {subTab === "survey" && (
        <SurveyOverview
          periods={periods}
          data={surveyData}
          mailSubject={mailSubject}
          mailBody={mailBody}
          hasPreviousMail={hasPreviousMail}
        />
      )}
      {/* 보일 배부 대상 열은 라운드의 기간 모두를 기준으로 — 4Q·BP 둘 다 없는 홀딩스는 감추고, 4Q에 남은 건물은 그린다. */}
      {subTab === "resource" && (
        <TargetColumns
          periods={shownPeriods(periods, reviewRounds.flatMap((r) => r.data), hkrHistory)}
          current={periods}
        >
          <ConfirmReview rounds={reviewRounds} version={version} hkrHistory={hkrHistory} />
        </TargetColumns>
      )}
      {subTab === "selfuse" && (
        <TargetColumns
          periods={[...periods, ...selfuseHistory.map((h) => h.quarter), ...buildingHistory.map((h) => h.quarter)]}
          current={periods}
        >
          {/* 26년 4Q까지는 자가사용(건물), 27년 BP부터는 건물(분당)/건물(용인) — 받는 값이 달라 표를 나눈다.
              BP만 있는 라운드에서는 자가사용 표 자체를 그리지 않는다. */}
          {selfusePeriods.length > 0 && (
            <SelfUsePanel
              key={selfusePeriods.join("+")}
              periods={selfusePeriods}
              history={selfuseHistory}
              onUntouchedChange={setSelfuseUntouched}
              partnerUntouched={splitSelfuse ? buildingUntouched : undefined}
            />
          )}
          {hasBuilding && (
            <BuildingPanel
              key={buildingPeriods.join("+")}
              periods={buildingPeriods}
              history={buildingHistory}
              materialSource={materialSource}
              onUntouchedChange={setBuildingUntouched}
              partnerUntouched={splitSelfuse ? selfuseUntouched : undefined}
            />
          )}
        </TargetColumns>
      )}
      {subTab === "it" && (
        <TargetColumns periods={[...periods, ...itHistory.map((h) => h.quarter)]} current={periods}>
          <ItPanel key={periods.join("+")} periods={periods} history={itHistory} />
        </TargetColumns>
      )}
    </div>
  );
}
