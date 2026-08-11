"use client";

import { Fragment, useState } from "react";
import { leaderFirst, sortForOrgPicker, DIVISION_ORDER } from "@/lib/orgOrder";
import type { ResolvedManager } from "@/lib/orgManager";

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
  /** 이번 분기 담당자 (없으면 지난 분기에서 이어받은 값). */
  manager: ResolvedManager;
  /** 하위 팀(예: 개발 그룹의 SW팀·HW팀). 조직 단위를 리소스배부율의 조직/팀 선택과 맞추려고 여기에 접어 넣는다. */
  children: SurveyOrgData[];
}

function submitUrlOf(token: string): string {
  return typeof window !== "undefined" ? `${window.location.origin}/submit/${token}` : `/submit/${token}`;
}

function SubmitBadge({ item }: { item: SurveyOrgData }) {
  return item.hasSubmission ? (
    <span className="status-badge status-pending">
      제출됨{item.personCount > 0 ? ` · ${item.personCount}명` : ""}
    </span>
  ) : (
    <span className="status-badge" style={{ background: "#f1f5f9", color: "#64748b" }}>
      미제출
    </span>
  );
}

/** 눌렀을 때 실제로 복사됐는지 알 수 있게 잠깐 '복사됨'으로 바뀐다. */
function CopyLinkButton({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn btn-secondary btn-sm"
      onClick={async () => {
        await navigator.clipboard?.writeText(submitUrlOf(token));
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "복사됨" : "복사"}
    </button>
  );
}

/**
 * 담당자 칸 — 코멘트 칸과 같은 방식이다(평소엔 글자만, 커서를 올리면 입력칸과 초록 체크가 드러난다).
 * 분기별로 저장하되 이번 분기에 적은 값이 없으면 지난 분기 담당자가 그대로 보인다 — 그대로 두면
 * 다음에도 이어서 보이고, 눌러 저장하면 이번 분기 값으로 굳는다.
 */
function ManagerCell({ item, period }: { item: SurveyOrgData; period: string }) {
  const [value, setValue] = useState(item.manager.name);
  const [saved, setSaved] = useState(item.manager.name);
  const [pinned, setPinned] = useState(false);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const dirty = value !== saved;

  async function commit() {
    if (!dirty) return;
    setState("saving");
    try {
      const res = await fetch("/api/admin/org-manager", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId: item.org.id, period, name: value }),
      });
      if (!res.ok) throw new Error();
      setSaved(value);
      setPinned(true);
      setState("saved");
      setTimeout(() => setState("idle"), 1500);
    } catch {
      setState("error");
    }
  }

  // 지난 분기에서 이어받았을 뿐 아직 이번 분기 값으로 굳지 않은 이름은 옅게 보여준다.
  // (한 번 저장하면 이번 분기 값이므로 pinned로 풀어준다 — 화면을 새로 읽기 전까지는 props가 그대로다.)
  const inherited = item.manager.inherited && !dirty && !pinned;

  return (
    <div className="comment-cell survey-manager">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
        placeholder="담당자"
        title={inherited ? `${item.manager.fromPeriod} 담당자를 이어받았습니다` : undefined}
        style={inherited ? { color: "#94a3b8" } : undefined}
      />
      <button
        type="button"
        className={`note-save-btn${dirty ? " is-dirty" : ""}`}
        title={dirty ? "저장하지 않은 변경이 있습니다 — 눌러서 저장" : "담당자 저장"}
        aria-label="담당자 저장"
        disabled={state === "saving"}
        onClick={commit}
      >
        ✓
      </button>
      <span className="survey-save-state" style={state === "error" ? { color: "#dc2626" } : undefined}>
        {state === "saving" ? "저장중" : state === "saved" ? "저장됨" : state === "error" ? "실패" : ""}
      </span>
    </div>
  );
}

function OrgCell({ item, isChild }: { item: SurveyOrgData; isChild?: boolean }) {
  const children = item.children;
  const submittedChildren = children.filter((c) => c.hasSubmission).length;

  return (
    <>
      <div className="survey-org-name">
        {isChild && <span className="survey-org-branch">└</span>}
        {item.org.basis}{" "}
        {children.length > 0 ? (
          // 집계 조직은 자기가 제출하는 대상이 아니라 하위 조직 값을 모으는 자리다 — 진행 상황으로 보여준다.
          <span
            className={`status-badge${submittedChildren === children.length ? " status-pending" : ""}`}
            style={submittedChildren === children.length ? undefined : { background: "#f1f5f9", color: "#64748b" }}
          >
            하위 {submittedChildren}/{children.length}
          </span>
        ) : (
          <SubmitBadge item={item} />
        )}
      </div>
      <div className="survey-org-sub">
        {children.length > 0
          ? "하위 조직 값으로 자동 집계 · 링크 하나에 하위 조직이 모두 들어 있습니다"
          : item.hasSubmission && item.submittedBy
          ? `${item.submittedBy} 제출${
              item.latestSubmittedAt ? ` · ${new Date(item.latestSubmittedAt).toLocaleDateString("ko-KR")}` : ""
            }`
          : item.org.requires_person_detail
          ? "개인별 확인 필요"
          : "조직 단위"}
      </div>
    </>
  );
}

function DivisionTable({ title, items, period }: { title: string; items: SurveyOrgData[]; period: string }) {
  const submitting = items.flatMap((i) => (i.children.length > 0 ? i.children : [i]));
  const done = submitting.filter((d) => d.hasSubmission).length;

  return (
    <div className="panel survey-panel">
      <div className="survey-panel-head">
        <span className="survey-panel-title">{title}</span>
        <span className="survey-panel-count">
          {done}/{submitting.length} 제출
        </span>
      </div>
      <table className="survey-tbl">
        <thead>
          <tr>
            <th>조직</th>
            <th className="col-link">입력 링크 복사</th>
            <th className="col-manager">담당자</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <Fragment key={item.org.id}>
              <tr>
                <td className="col-org">
                  <OrgCell item={item} />
                </td>
                {/* 집계 조직은 링크가 하나다 — 그 링크 한 화면에서 하위 조직을 모두 입력한다. */}
                <td className="col-link">
                  <CopyLinkButton token={item.org.access_token} />
                </td>
                <td className="col-manager">
                  <ManagerCell item={item} period={period} />
                </td>
              </tr>
              {leaderFirst(item.children).map((c) => (
                <tr key={c.org.id} className="child-row">
                  <td className="col-org">
                    <OrgCell item={c} isChild />
                  </td>
                  <td className="col-link survey-inherit-link">↑</td>
                  <td className="col-manager">
                    <ManagerCell item={c} period={period} />
                  </td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
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
  // 본사 → 주재원 → 법인 순으로 표를 나눠 놓는다. 목록에 없는 구분이 생겨도 뒤에 붙여 빠지지 않게 한다.
  const divisions = [
    ...DIVISION_ORDER.filter((d) => grouped[d]),
    ...Object.keys(grouped).filter((d) => !DIVISION_ORDER.includes(d)),
  ];

  // 실제로 제출하는 단위(집계 조직은 빼고 하위 팀까지 펼친 것)로 진행 상황을 센다.
  const submitting = ordered.flatMap((i) => (i.children.length > 0 ? i.children : [i]));
  const submittedCount = submitting.filter((d) => d.hasSubmission).length;

  return (
    <div className="survey-wrap">
      <div className="panel survey-panel">
        <div className="panel-title">조사 현황 ({period})</div>
        <div className="callout info" style={{ margin: 0 }}>
          전체 {submitting.length}개 조직 중 <b>{submittedCount}</b>개 제출
        </div>
      </div>

      {divisions.map((division) => (
        <DivisionTable key={division} title={division} items={grouped[division]} period={period} />
      ))}
    </div>
  );
}
