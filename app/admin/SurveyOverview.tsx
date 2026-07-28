"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AdminNav from "./AdminNav";
import { groupDivisionLabel } from "@/lib/targets";

export interface SurveyOrgData {
  org: {
    id: number;
    basis: string;
    division: string;
    requires_person_detail: boolean;
    access_token: string;
  };
  hasSubmission: boolean;
  submittedBy: string | null;
  latestSubmittedAt: string | null;
  personCount: number;
}

function OrgRow({ item }: { item: SurveyOrgData }) {
  const submitUrl =
    typeof window !== "undefined" ? `${window.location.origin}/submit/${item.org.access_token}` : `/submit/${item.org.access_token}`;

  function copyLink() {
    navigator.clipboard?.writeText(submitUrl);
  }

  return (
    <div className="panel" style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div>
          <div className="list-item-title">
            {item.org.basis}{" "}
            {item.hasSubmission ? (
              <span className="status-badge status-pending">제출됨{item.personCount > 0 ? ` · 개인 ${item.personCount}명` : ""}</span>
            ) : (
              <span className="status-badge" style={{ background: "#f1f5f9", color: "#64748b" }}>
                미제출
              </span>
            )}
          </div>
          <div className="list-item-sub">
            {item.org.division} · {item.org.requires_person_detail ? "개인별 확인 필요" : "조직 단위"}
            {item.submittedBy ? ` · 제출자: ${item.submittedBy}` : ""}
            {item.latestSubmittedAt ? ` · ${new Date(item.latestSubmittedAt).toLocaleString("ko-KR")}` : ""}
          </div>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={copyLink}>
          입력 링크 복사
        </button>
      </div>
    </div>
  );
}

export default function SurveyOverview({
  period,
  version,
  data,
}: {
  period: string;
  version: string;
  data: SurveyOrgData[];
}) {
  const [periodInput, setPeriodInput] = useState(period);
  const [versionInput, setVersionInput] = useState(version);
  const [savingSettings, setSavingSettings] = useState(false);
  const router = useRouter();

  const grouped = data.reduce<Record<string, SurveyOrgData[]>>((acc, item) => {
    (acc[groupDivisionLabel(item.org.division)] ??= []).push(item);
    return acc;
  }, {});

  async function saveSettings() {
    setSavingSettings(true);
    await fetch("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ period: periodInput, version: versionInput }),
    });
    setSavingSettings(false);
    router.refresh();
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.push("/admin/login");
  }

  const submittedCount = data.filter((d) => d.hasSubmission).length;

  return (
    <div className="page">
      <div className="topbar" style={{ marginBottom: 16, borderRadius: 12 }}>
        <div className="topbar-title">배부율 관리</div>
        <button className="btn btn-secondary btn-sm" onClick={logout}>
          로그아웃
        </button>
      </div>
      <AdminNav active="survey" />

      <div className="panel">
        <div className="panel-title">현재 조사 라운드</div>
        <div className="field-row" style={{ gridTemplateColumns: "1fr 1fr auto", alignItems: "end" }}>
          <div className="field">
            <label>기간 (예: 2026-Q3)</label>
            <input value={periodInput} onChange={(e) => setPeriodInput(e.target.value)} />
          </div>
          <div className="field">
            <label>버전 (BP / Forecast)</label>
            <input value={versionInput} onChange={(e) => setVersionInput(e.target.value)} />
          </div>
          <button className="btn btn-secondary" disabled={savingSettings} onClick={saveSettings}>
            {savingSettings ? "저장 중..." : "저장"}
          </button>
        </div>
        <div className="field-hint" style={{ marginTop: 6 }}>
          이 값이 팀 입력 폼에 표시되고, 제출 데이터에 함께 저장됩니다. 다음 라운드를 열려면 여기서 기간을 바꾸세요.
        </div>
        <div className="callout info" style={{ marginTop: 14 }}>
          전체 {data.length}개 조직 중 <b>{submittedCount}</b>개 제출
        </div>
      </div>

      {Object.entries(grouped).map(([division, items]) => (
        <div key={division} style={{ marginBottom: 22 }}>
          <div className="panel-sub" style={{ fontWeight: 700, color: "#1a202c", marginBottom: 8 }}>
            {division}
          </div>
          {items.map((item) => (
            <OrgRow key={item.org.id} item={item} />
          ))}
        </div>
      ))}
    </div>
  );
}
