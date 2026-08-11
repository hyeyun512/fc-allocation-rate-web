"use client";

import { leaderFirst, sortForOrgPicker } from "@/lib/orgOrder";

export interface SurveyOrgData {
  org: {
    id: number;
    basis: string;
    division: string;
    requires_person_detail: boolean;
    access_token: string;
    parent_basis: string | null;
  };
  hasSubmission: boolean;
  submittedBy: string | null;
  latestSubmittedAt: string | null;
  personCount: number;
  /** 하위 팀(예: 개발 그룹의 SW팀·HW팀). 조직 단위를 리소스배부율의 조직/팀 선택과 맞추려고 여기에 접어 넣는다. */
  children: SurveyOrgData[];
}

function submitUrlOf(token: string): string {
  return typeof window !== "undefined" ? `${window.location.origin}/submit/${token}` : `/submit/${token}`;
}

function SubmitBadge({ item }: { item: SurveyOrgData }) {
  return item.hasSubmission ? (
    <span className="status-badge status-pending">
      제출됨{item.personCount > 0 ? ` · 개인 ${item.personCount}명` : ""}
    </span>
  ) : (
    <span className="status-badge" style={{ background: "#f1f5f9", color: "#64748b" }}>
      미제출
    </span>
  );
}

function CopyLinkButton({ token }: { token: string }) {
  return (
    <button className="btn btn-secondary btn-sm" onClick={() => navigator.clipboard?.writeText(submitUrlOf(token))}>
      입력 링크 복사
    </button>
  );
}

function SubInfo({ item }: { item: SurveyOrgData }) {
  return (
    <>
      {item.org.requires_person_detail ? "개인별 확인 필요" : "조직 단위"}
      {item.submittedBy ? ` · 제출자: ${item.submittedBy}` : ""}
      {item.latestSubmittedAt ? ` · ${new Date(item.latestSubmittedAt).toLocaleString("ko-KR")}` : ""}
    </>
  );
}

function OrgRow({ item }: { item: SurveyOrgData }) {
  const children = leaderFirst(item.children);
  const submittedChildren = children.filter((c) => c.hasSubmission).length;

  return (
    <div className="panel" style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div>
          <div className="list-item-title">
            {item.org.basis}{" "}
            {children.length > 0 ? (
              // 집계 조직은 자기가 제출하는 대상이 아니라 하위 조직 값을 모으는 자리다 — 진행 상황으로 보여준다.
              <span
                className={`status-badge${submittedChildren === children.length ? " status-pending" : ""}`}
                style={submittedChildren === children.length ? undefined : { background: "#f1f5f9", color: "#64748b" }}
              >
                하위 조직 {submittedChildren}/{children.length} 제출
              </span>
            ) : (
              <SubmitBadge item={item} />
            )}
          </div>
          <div className="list-item-sub">
            {item.org.division} ·{" "}
            {children.length > 0 ? "하위 조직 값으로 자동 집계 — 링크 하나에 하위 조직이 모두 들어 있습니다" : <SubInfo item={item} />}
          </div>
        </div>
        {/* 집계 조직은 링크가 하나다 — 그 링크 한 화면에서 하위 조직을 모두 입력한다. */}
        <CopyLinkButton token={item.org.access_token} />
      </div>

      {children.length > 0 && (
        <div style={{ marginTop: 10, borderTop: "0.5px solid #f1f5f9", paddingTop: 10 }}>
          {children.map((c) => (
            <div key={c.org.id} style={{ padding: "6px 0" }}>
              <div className="list-item-title" style={{ fontSize: 13.5 }}>
                {c.org.basis} <SubmitBadge item={c} />
              </div>
              <div className="list-item-sub">
                <SubInfo item={c} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SurveyOverview({ period, data }: { period: string; data: SurveyOrgData[] }) {
  // 리소스배부율의 조직/팀 선택과 같은 순서(본사 → 주재원 → 법인, 그 안에서 조직장 먼저 → 엑셀 표 순서).
  const ordered = sortForOrgPicker(data);
  const grouped = ordered.reduce<Record<string, SurveyOrgData[]>>((acc, item) => {
    (acc[item.org.division] ??= []).push(item);
    return acc;
  }, {});

  // 실제로 제출하는 단위(집계 조직은 빼고 하위 팀까지 펼친 것)로 진행 상황을 센다.
  const submitting = ordered.flatMap((i) => (i.children.length > 0 ? i.children : [i]));
  const submittedCount = submitting.filter((d) => d.hasSubmission).length;

  return (
    <div>
      <div className="panel">
        <div className="panel-title">조사 현황 ({period})</div>
        <div className="callout info">
          전체 {submitting.length}개 조직 중 <b>{submittedCount}</b>개 제출
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
