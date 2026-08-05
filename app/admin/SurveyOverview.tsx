"use client";

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

export default function SurveyOverview({ period, data }: { period: string; data: SurveyOrgData[] }) {
  const grouped = data.reduce<Record<string, SurveyOrgData[]>>((acc, item) => {
    (acc[groupDivisionLabel(item.org.division)] ??= []).push(item);
    return acc;
  }, {});

  const submittedCount = data.filter((d) => d.hasSubmission).length;

  return (
    <div>
      <div className="panel">
        <div className="panel-title">조사 현황 ({period})</div>
        <div className="callout info">
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
