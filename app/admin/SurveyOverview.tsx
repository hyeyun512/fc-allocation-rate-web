"use client";

import { Fragment, useMemo, useState } from "react";
import { leaderFirst, sortForOrgPicker, DIVISION_ORDER } from "@/lib/orgOrder";
import { useEffect, useRef } from "react";
import { isValidEmail, mailTemplateProblem, LINK_PLACEHOLDER, MAIL_FONT_CSS } from "@/lib/linkMail";
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
  /** 이번 분기 담당자 이름·메일 (없으면 지난 분기에서 이어받은 값). */
  manager: ResolvedManager;
  /** 링크 화면 언어에 맞춘 조직 표기 — 서버가 계산해 내려준다(조직명 목록을 클라이언트에 두지 않으려고). */
  orgLabel: string;
  /** 이 조직의 담당자에게 보낼 링크의 토큰. 하위 팀은 상위 조직 토큰을 쓴다. */
  linkToken: string;
  /** 이 조직이 링크 주인인지 — 복사 버튼과 발송(✉)이 붙는 행. */
  isTokenOwner: boolean;
  /** 제출한 링크를 다시 열어줬는지. 열어주면 담당자가 한 번 더 제출할 수 있다. */
  editAllowed: boolean;
  /** 하위 팀(예: 개발 그룹의 SW팀·HW팀). 조직 단위를 리소스배부율의 조직/팀 선택과 맞추려고 여기에 접어 넣는다. */
  children: SurveyOrgData[];
}

/** 담당자 칸 하나의 편집 상태. 저장된 값과 편집 중인 값을 나눠 들고 있어야 '저장 안 함'을 표시할 수 있다. */
interface CellState {
  name: string;
  savedName: string;
  email: string;
  savedEmail: string;
  /** 이번 분기에 사람이 확인하지 않은 주소인지 — DB의 email_set_period에서 오므로 새로고침해도 유지된다. */
  emailInherited: boolean;
  emailFromPeriod: string | null;
  /** 이번 세션에서 이름을 바꿔 저장했는지 — 주소도 확인하라고 노란 테두리를 띄우는 조건. */
  nameChanged: boolean;
  status: "idle" | "saving" | "saved" | "error";
}

type CellMap = Record<number, CellState>;

function flatten(items: SurveyOrgData[]): SurveyOrgData[] {
  return items.flatMap((i) => [i, ...i.children]);
}

function initialCells(items: SurveyOrgData[]): CellMap {
  const map: CellMap = {};
  flatten(items).forEach((i) => {
    map[i.org.id] = {
      name: i.manager.name,
      savedName: i.manager.name,
      email: i.manager.email,
      savedEmail: i.manager.email,
      emailInherited: i.manager.emailInherited,
      emailFromPeriod: i.manager.emailFromPeriod,
      nameChanged: false,
      status: "idle",
    };
  });
  return map;
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

/**
 * 제출한 링크는 담당자가 임의로 고칠 수 없다. 값이 바뀌어야 할 때만 여기서 한 번 열어준다.
 * 담당자가 다시 제출하면 서버가 표식을 지워 곧바로 다시 잠긴다.
 */
function UnlockButton({ item, period }: { item: SurveyOrgData; period: string }) {
  const [allowed, setAllowed] = useState(item.editAllowed);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/submit-unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId: item.org.id, period, allow: !allowed }),
      });
      if (res.ok) setAllowed(!allowed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className={`unlock-btn${allowed ? " is-open" : ""}`}
      disabled={busy}
      title={
        allowed
          ? "담당자가 다시 제출할 수 있는 상태입니다 — 눌러서 다시 잠급니다"
          : "담당자가 링크에서 다시 제출할 수 있게 한 번 열어줍니다"
      }
      onClick={toggle}
    >
      {allowed ? "수정 허용됨" : "수정 허용"}
    </button>
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

/* ─────────────────── 발송 확인창 ───────────────────
   링크는 그 자체가 자격증명이고 상위 조직 링크는 하위 팀 전체를 열어버린다.
   그래서 보내기 전에 **무엇이 열리는지**와 **누구에게 가는지**를 전부 보여준다. */

interface Candidate {
  orgId: number;
  label: string;
  name: string;
  email: string;
  inherited: boolean;
  fromPeriod: string | null;
}

interface SendState {
  owner: SurveyOrgData;
  candidates: Candidate[];
  checked: Record<number, boolean>;
  opensOthers: boolean;
  childLabels: string[];
  /** 서버가 만들어준 초안 — 같은 링크를 쓰는 담당자는 한 통에 함께 넣으므로 하나뿐이다. */
  draft: { to: string[]; subject: string; body: string; bodyHtml: string; url: string; eml: string | null; emlFileName: string } | null;
  /** 서식 본문을 클립보드에 넣었는지. .eml을 못 만들어 평문 초안으로 물러섰을 때만 쓴다. */
  copied: boolean;
  phase: "confirm" | "ready" | "sending" | "error";
  message: string;
}

/** 서식 있는 본문을 클립보드에 넣는다. HTML 방식이 막히면 평문으로라도 넣는다. */
async function copyRichText(html: string, text: string): Promise<boolean> {
  try {
    const anyNav = navigator as any;
    if (anyNav.clipboard?.write && typeof ClipboardItem !== "undefined") {
      await anyNav.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
      return true;
    }
    await navigator.clipboard?.writeText(text);
    return false;
  } catch {
    return false;
  }
}

function openDraft(url: string) {
  // window.open은 팝업 차단에 걸리기 쉽다. 앵커 클릭은 mailto 핸들러(Outlook)로 바로 넘어간다.
  const a = document.createElement("a");
  a.href = url;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/** 서식이 살아 있는 초안(.eml)을 파일로 내려준다. */
function downloadEml(eml: string, filename: string) {
  // 브라우저가 Outlook을 직접 띄울 방법은 없다. 메시지 한 통을 파일로 내려주고 사람이 열게 한다 —
  // .eml 기본 프로그램이 Outlook이면 X-Unsent 헤더 덕분에 곧바로 [보내기] 있는 초안 창이 뜬다.
  const blob = new Blob([eml], { type: "message/rfc822" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function SendDialog({
  state,
  setState,
  period,
  onClose,
}: {
  state: SendState;
  setState: (s: SendState) => void;
  period: string;
  onClose: () => void;
}) {
  const chosen = state.candidates.filter((c) => state.checked[c.orgId]);
  const inheritedChosen = chosen.filter((c) => c.inherited);

  async function prepare() {
    setState({ ...state, phase: "sending", message: "" });
    try {
      const res = await fetch("/api/admin/send-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgIds: [state.owner.org.id],
          period,
          recipientOrgIds: chosen.map((c) => c.orgId),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setState({ ...state, phase: "error", message: json?.error ?? "초안을 만들지 못했습니다." });
        return;
      }
      const result = json.results?.[0];
      if (!result?.mailtoUrl) {
        setState({ ...state, phase: "error", message: "보낼 수 있는 주소가 없습니다." });
        return;
      }
      const draft = {
        to: result.to as string[],
        subject: result.subject,
        body: result.body,
        bodyHtml: result.bodyHtml,
        url: result.mailtoUrl,
        eml: (result.eml as string | null) ?? null,
        emlFileName: (result.emlFileName as string) ?? "배부율조사.eml",
      };
      // .eml 초안은 서식이 그대로 살아 있으므로 클립보드를 건드리지 않는다.
      // 초안 파일을 만들지 못한 경우에만 평문 mailto로 물러서고, 그때만 서식 본문을 클립보드로 넘긴다.
      let copied = false;
      if (draft.eml) {
        downloadEml(draft.eml, draft.emlFileName);
      } else {
        copied = await copyRichText(draft.bodyHtml, draft.body);
        openDraft(draft.url);
      }
      setState({ ...state, draft, copied, phase: "ready", message: "" });
    } catch {
      setState({ ...state, phase: "error", message: "초안을 만들지 못했습니다." });
    }
  }

  return (
    <div className="send-backdrop" role="dialog" aria-modal="true" aria-label="조사 링크 발송">
      <div className="send-dialog">
        {state.phase === "ready" && state.draft ? (
          <>
            <div className="send-title">
              {state.draft.eml ? "Outlook 초안 파일을 내려받았습니다" : "Outlook 초안을 열었습니다"}
            </div>
            {state.draft.eml ? (
              <p className="send-lead">
                내려받은 <b>{state.draft.emlFileName}</b> 을(를) 열면 <b>화면에서 작성한 서식 그대로</b>{" "}
                Outlook 초안이 열립니다.
                <br />
                확인 후 <b>[보내기]</b>를 눌러 주세요. 아직 발송되지 않았습니다.
              </p>
            ) : state.copied ? (
              <p className="send-lead">
                초안 파일을 만들지 못해 서식 없는 초안을 열었습니다. 서식(굵게·색)을 살리려면 본문에서{" "}
                <b>Ctrl+A → Ctrl+V</b> 하세요 — 서식 있는 본문을 클립보드에 넣어 두었습니다.
                <br />
                확인 후 <b>[보내기]</b>를 눌러 주세요. 아직 발송되지 않았습니다.
              </p>
            ) : (
              <p className="send-lead">
                내용을 확인하고 <b>[보내기]</b>를 눌러 주세요. 초안을 열었을 뿐 아직 발송되지 않았습니다.
              </p>
            )}
            <div className="send-sub">수신인 {state.draft.to.length}명</div>
            <ul className="send-list">
              {state.draft.to.map((addr) => (
                <li key={addr}>
                  <code>{addr}</code>
                </li>
              ))}
            </ul>
            <div className="send-sub">보낸 내용</div>
            <div className="send-preview">
              <b>{state.draft.subject}</b>
              <pre>{state.draft.body}</pre>
            </div>
            <div className="send-actions">
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => copyRichText(state.draft!.bodyHtml, state.draft!.body)}
              >
                서식 본문 다시 복사
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() =>
                  state.draft!.eml
                    ? downloadEml(state.draft!.eml!, state.draft!.emlFileName)
                    : openDraft(state.draft!.url)
                }
              >
                {state.draft!.eml ? "초안 파일 다시 받기" : "초안 다시 열기"}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={onClose}>
                닫기
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="send-title">{state.owner.org.basis}의 조사 링크를 보냅니다</div>
            {state.opensOthers && (
              <p className="send-warn">
                ⚠ 이 링크는 <b>{state.owner.org.basis}</b>
                {state.childLabels.length > 0 && <> 와 하위 {state.childLabels.length}개 팀({state.childLabels.join(", ")})</>} 전체를
                입력·열람할 수 있습니다.
              </p>
            )}
            <div className="send-sub">수신인 — 체크한 사람이 한 통의 수신인으로 함께 들어갑니다</div>
            <ul className="send-picks">
              {state.candidates.map((c) => (
                <li key={c.orgId}>
                  <label>
                    <input
                      type="checkbox"
                      checked={!!state.checked[c.orgId]}
                      onChange={(e) =>
                        setState({ ...state, checked: { ...state.checked, [c.orgId]: e.target.checked } })
                      }
                    />
                    <span className="send-pick-org">{c.label}</span>
                    <span className="send-pick-name">{c.name || "(이름 없음)"}</span>
                    <code>{c.email}</code>
                  </label>
                </li>
              ))}
            </ul>
            {inheritedChosen.length > 0 && (
              <p className="send-warn">
                ※ {inheritedChosen.map((c) => c.email).join(", ")} 는 {inheritedChosen[0].fromPeriod}에 저장된
                주소입니다. 맞는지 확인해 주세요.
              </p>
            )}
            <p className="send-lead">
              Outlook 초안 파일(.eml)을 내려받습니다. 파일을 열면 화면에서 작성한 서식 그대로 초안이 열립니다.
            </p>
            {state.phase === "error" && <p className="send-error">{state.message}</p>}
            <div className="send-actions">
              <button
                className="btn btn-primary btn-sm"
                disabled={chosen.length === 0 || state.phase === "sending"}
                onClick={prepare}
              >
                {state.phase === "sending" ? "초안 만드는 중..." : `초안 파일 만들기 (수신인 ${chosen.length}명)`}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={onClose}>
                취소
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ─────────────────── 담당자 칸 ───────────────────
   코멘트 칸과 같은 방식이다(평소엔 글자만, 커서를 올리면 입력칸과 초록 체크가 드러난다).
   이름 줄과 메일 줄을 두 줄로 쌓되, 발송(✉)은 **링크 주인 행에만** 둔다 —
   하위 행마다 발송 버튼을 두면 관리자는 '이 사람 하나에게'라고 인식하지만
   실제로는 같은 광역 토큰이 여러 번 나간다. */

function ManagerCell({
  item,
  cell,
  patch,
  save,
  canSend,
  sendHint,
  onSend,
}: {
  item: SurveyOrgData;
  cell: CellState;
  patch: (next: Partial<CellState>) => void;
  save: (field: "name" | "email") => void;
  canSend: boolean;
  sendHint: string;
  onSend: () => void;
}) {
  const nameDirty = cell.name !== cell.savedName;
  const emailDirty = cell.email !== cell.savedEmail;
  // 지난 분기에서 이어받았을 뿐 아직 이번 분기 값으로 굳지 않은 이름은 옅게 보여준다.
  const nameInherited = item.manager.nameInherited && !nameDirty && cell.savedName === item.manager.name;
  // 이름을 바꿔 저장했는데 주소는 그대로면 주소도 확인하라고 눈에 걸리게 둔다.
  const needsReview = !emailDirty && cell.savedEmail !== "" && (cell.emailInherited || cell.nameChanged);

  return (
    <div className="survey-manager-stack">
      <div className="comment-cell survey-manager-name">
        <input
          value={cell.name}
          onChange={(e) => patch({ name: e.target.value })}
          onBlur={() => save("name")}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save("name");
            }
          }}
          placeholder="담당자"
          title={nameInherited ? `${item.manager.nameFromPeriod} 담당자를 이어받았습니다` : undefined}
          style={nameInherited ? { color: "#94a3b8" } : undefined}
        />
        <button
          type="button"
          className={`note-save-btn${nameDirty ? " is-dirty" : ""}`}
          title={nameDirty ? "저장하지 않은 변경이 있습니다 — 눌러서 저장" : "담당자 저장"}
          aria-label="담당자 저장"
          disabled={cell.status === "saving"}
          onClick={() => save("name")}
        >
          ✓
        </button>
        <span className="survey-save-state" style={cell.status === "error" ? { color: "#dc2626" } : undefined}>
          {cell.status === "saving" ? "저장중" : cell.status === "saved" ? "저장됨" : cell.status === "error" ? "실패" : ""}
        </span>
      </div>

      <div className={`comment-cell survey-manager-mail${needsReview ? " needs-review" : ""}`}>
        <input
          value={cell.email}
          onChange={(e) => patch({ email: e.target.value })}
          onBlur={() => save("email")}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save("email");
            }
          }}
          placeholder="Outlook 메일"
          title={
            needsReview
              ? cell.nameChanged
                ? "담당자가 바뀌었습니다 — 주소도 확인해 주세요"
                : `${cell.emailFromPeriod}에 저장된 주소입니다 — 맞는지 확인해 주세요`
              : cell.email || undefined
          }
        />
        <button
          type="button"
          className={`note-save-btn${emailDirty ? " is-dirty" : ""}`}
          title={emailDirty ? "저장하지 않은 변경이 있습니다 — 눌러서 저장" : "메일 저장"}
          aria-label="메일 저장"
          disabled={cell.status === "saving"}
          onClick={() => save("email")}
        >
          ✓
        </button>
        {item.isTokenOwner ? (
          <button
            type="button"
            className="survey-send-btn"
            title={sendHint}
            aria-label="조사 링크 메일 초안 열기"
            disabled={!canSend}
            onClick={onSend}
          >
            ✉
          </button>
        ) : (
          <span className="survey-send-slot" title="상위 조직 발송에 포함됩니다">
            ↑
          </span>
        )}
      </div>
    </div>
  );
}

function OrgCell({ item, isChild, period }: { item: SurveyOrgData; isChild?: boolean; period: string }) {
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
          <>
            <SubmitBadge item={item} />
            {item.hasSubmission && <UnlockButton item={item} period={period} />}
          </>
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

function DivisionTable({
  title,
  items,
  period,
  cells,
  patch,
  save,
  onSend,
  hasTemplate,
}: {
  title: string;
  items: SurveyOrgData[];
  period: string;
  cells: CellMap;
  patch: (orgId: number, next: Partial<CellState>) => void;
  save: (orgId: number, field: "name" | "email") => void;
  onSend: (owner: SurveyOrgData) => void;
  hasTemplate: boolean;
}) {
  const submitting = items.flatMap((i) => (i.children.length > 0 ? i.children : [i]));
  const done = submitting.filter((d) => d.hasSubmission).length;

  /** 이 링크로 보낼 수 있는 사람이 하나라도 있는지 — 주소가 하위 행에 있을 수도 있다. */
  function sendability(owner: SurveyOrgData): { canSend: boolean; hint: string } {
    const scope = [owner, ...owner.children];
    const dirty = scope.some((o) => {
      const c = cells[o.org.id];
      return c && (c.email !== c.savedEmail || c.name !== c.savedName);
    });
    if (dirty) return { canSend: false, hint: "저장하지 않은 변경이 있습니다 — 먼저 저장해 주세요" };
    const usable = scope.filter((o) => {
      const c = cells[o.org.id];
      return c && c.savedEmail !== "" && isValidEmail(c.savedEmail);
    });
    if (usable.length === 0) return { canSend: false, hint: "이 링크로 보낼 메일 주소가 아직 없습니다" };
    if (!hasTemplate) return { canSend: false, hint: "메일 제목·본문을 먼저 저장해 주세요" };
    return { canSend: true, hint: `조사 링크 메일 초안 열기 (보낼 수 있는 담당자 ${usable.length}명)` };
  }

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
            <th className="col-manager">담당자 · Outlook 메일</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const { canSend, hint } = sendability(item);
            return (
              <Fragment key={item.org.id}>
                <tr>
                  <td className="col-org">
                    <OrgCell item={item} period={period} />
                  </td>
                  {/* 집계 조직은 링크가 하나다 — 그 링크 한 화면에서 하위 조직을 모두 입력한다. */}
                  <td className="col-link">
                    <CopyLinkButton token={item.linkToken} />
                  </td>
                  <td className="col-manager">
                    {cells[item.org.id] && (
                      <ManagerCell
                        item={item}
                        cell={cells[item.org.id]}
                        patch={(n) => patch(item.org.id, n)}
                        save={(f) => save(item.org.id, f)}
                        canSend={canSend}
                        sendHint={hint}
                        onSend={() => onSend(item)}
                      />
                    )}
                  </td>
                </tr>
                {leaderFirst(item.children).map((c) => (
                  <tr key={c.org.id} className="child-row">
                    <td className="col-org">
                      <OrgCell item={c} isChild period={period} />
                    </td>
                    <td className="col-link survey-inherit-link">↑</td>
                    <td className="col-manager">
                      {cells[c.org.id] && (
                        <ManagerCell
                          item={c}
                          cell={cells[c.org.id]}
                          patch={(n) => patch(c.org.id, n)}
                          save={(f) => save(c.org.id, f)}
                          canSend={false}
                          sendHint=""
                          onSend={() => {}}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ─────────────────── 메일 문구 ───────────────────
   제목 한 줄과 본문 한 칸. 분기·제출 기한도 손으로 적으므로 자리표시자는 두지 않았다.
   본문은 서식(굵게·글자색·배경색)을 쓸 수 있어야 해서 contenteditable로 받아 HTML로 저장한다.
   글꼴은 Outlook에서 그대로 보이도록 맑은 고딕 10pt를 인라인으로 고정한다. */

const SWATCHES = ["#1a202c", "#dc2626", "#2563eb", "#16a34a", "#b45309"];
const HILITES = ["#fef08a", "#bbf7d0", "#bfdbfe", "#fecaca", "transparent"];

function MailTemplateEditor({
  initialSubject,
  initialBody,
  period,
  hasPreviousMail,
  onSaved,
}: {
  initialSubject: string;
  initialBody: string;
  period: string;
  hasPreviousMail: boolean;
  onSaved: (subject: string, bodyHtml: string) => void;
}) {
  const [subject, setSubject] = useState(initialSubject);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);

  // 편집기 안의 HTML은 React가 아니라 브라우저가 들고 있다. 처음 한 번만 채워 넣는다 —
  // 매 렌더마다 덮어쓰면 타이핑 중 커서가 맨 앞으로 튄다.
  useEffect(() => {
    if (bodyRef.current && bodyRef.current.innerHTML === "") {
      bodyRef.current.innerHTML = initialBody;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function exec(cmd: string, value?: string) {
    bodyRef.current?.focus();
    document.execCommand(cmd, false, value);
  }

  async function loadPrevious() {
    setError("");
    setNotice("");
    setState("saving");
    try {
      const res = await fetch("/api/admin/mail-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ only: "previous", period }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? "이전 분기 문구를 불러오지 못했습니다.");
        setState("error");
        return;
      }
      setSubject(json.subject ?? "");
      if (bodyRef.current) bodyRef.current.innerHTML = json.body ?? "";
      setState("idle");
      setNotice(`${json.period} 문구를 가져왔습니다. 분기와 제출 기한을 고친 뒤 저장해 주세요.`);
    } catch {
      setError("이전 분기 문구를 불러오지 못했습니다.");
      setState("error");
    }
  }

  async function save() {
    const bodyHtml = bodyRef.current?.innerHTML ?? "";
    const problem = mailTemplateProblem(subject, bodyHtml);
    if (problem) {
      setError(problem);
      setState("error");
      return;
    }
    setState("saving");
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/admin/mail-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, body: bodyHtml, period }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? "저장하지 못했습니다.");
        setState("error");
        return;
      }
      onSaved(subject, bodyHtml);
      setState("saved");
      setTimeout(() => setState("idle"), 1500);
    } catch {
      setError("저장하지 못했습니다.");
      setState("error");
    }
  }

  return (
    <div className="mail-tpl">
      <div className="mail-tpl-head">
        <span className="mail-tpl-title">메일 제목 · 본문</span>
        {hasPreviousMail && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={loadPrevious} disabled={state === "saving"}>
            전분기 메일 불러오기
          </button>
        )}
      </div>

      {notice && <p className="mail-tpl-ok">{notice}</p>}

      <label className="mail-tpl-label">제목</label>
      <input
        className="mail-tpl-input"
        value={subject}
        placeholder="예: [협조요청] 부서별 투입리소스 작성 (26년 3Q)"
        onChange={(e) => setSubject(e.target.value)}
      />

      <label className="mail-tpl-label">본문</label>
      <div className="mail-tpl-toolbar">
        <button type="button" title="굵게" className="is-bold" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("bold")}>
          가
        </button>
        <span className="mail-tpl-sep" />
        <span className="mail-tpl-swatches">
          글자
          {SWATCHES.map((color) => (
            <button
              key={color}
              type="button"
              title={`글자색 ${color}`}
              style={{ background: color }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => exec("foreColor", color)}
            />
          ))}
        </span>
        <span className="mail-tpl-sep" />
        <span className="mail-tpl-swatches">
          배경
          {HILITES.map((color) => (
            <button
              key={color}
              type="button"
              title={color === "transparent" ? "배경 없음" : `배경색 ${color}`}
              className={color === "transparent" ? "is-none" : undefined}
              style={color === "transparent" ? undefined : { background: color }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => exec("hiliteColor", color)}
            />
          ))}
        </span>
        <span className="mail-tpl-sep" />
        <button type="button" title="서식 지우기" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("removeFormat")}>
          서식 지우기
        </button>
      </div>
      <div
        ref={bodyRef}
        className="mail-tpl-body"
        contentEditable
        suppressContentEditableWarning
        data-placeholder="메일 본문을 적어 주세요. 조사 링크는 본문 끝에 자동으로 붙습니다."
      />
      <p className="field-hint">
        글꼴은 <b>맑은 고딕 10pt</b>로 나갑니다. 링크 위치를 정하려면 본문에 {LINK_PLACEHOLDER} 를 적으세요.
      </p>

      {error && <p className="send-error">{error}</p>}
      <div className="mail-tpl-actions">
        <button className="btn btn-primary btn-sm" disabled={state === "saving"} onClick={save}>
          {state === "saving" ? "저장 중..." : state === "saved" ? "저장됨" : "문구 저장"}
        </button>
      </div>
    </div>
  );
}

export default function SurveyOverview({
  period,
  data,
  mailSubject,
  mailBody,
  hasPreviousMail,
}: {
  period: string;
  data: SurveyOrgData[];
  mailSubject: string;
  mailBody: string;
  /** 이전 분기에 저장해 둔 문구가 있는지 — 있을 때만 불러오기 버튼을 보여준다. */
  hasPreviousMail: boolean;
}) {
  // 담당자 칸 상태는 행이 아니라 **화면 전체**가 들고 있다. 발송 버튼은 링크 주인 행에 있는데
  // 주소는 하위 행에 입력될 수 있어(HR실·Staff(CEO)) 행 안에 상태를 가두면 버튼이 갱신되지 않는다.
  const [cells, setCells] = useState<CellMap>(() => initialCells(data));
  const [send, setSend] = useState<SendState | null>(null);
  // 문구를 저장하기 전에는 ✉를 눌러도 보낼 게 없다 — 버튼을 막고 이유를 알려준다.
  const [hasTemplate, setHasTemplate] = useState(mailSubject.trim() !== "" && mailBody.trim() !== "");
  function patch(orgId: number, next: Partial<CellState>) {
    setCells((prev) => ({ ...prev, [orgId]: { ...prev[orgId], ...next } }));
  }

  async function save(orgId: number, field: "name" | "email") {
    const cell = cells[orgId];
    if (!cell) return;
    const dirty = field === "name" ? cell.name !== cell.savedName : cell.email !== cell.savedEmail;
    if (!dirty) return;

    patch(orgId, { status: "saving" });
    try {
      const res = await fetch("/api/admin/org-manager", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // 손댄 칸만 보낸다 — 서버가 나머지 칸의 값과 '출처'를 그대로 이어 붙인다.
        body: JSON.stringify(
          field === "name"
            ? { orgId, period, name: cell.name }
            : { orgId, period, email: cell.email }
        ),
      });
      const json = await res.json();
      if (!res.ok) {
        patch(orgId, { status: "error" });
        return;
      }
      patch(orgId, {
        status: "saved",
        savedName: json.name ?? cell.name,
        name: json.name ?? cell.name,
        savedEmail: json.email ?? cell.email,
        email: json.email ?? cell.email,
        emailInherited: !!json.emailInherited,
        emailFromPeriod: json.emailFromPeriod ?? null,
        // 이름을 바꾸면 '주소도 확인하세요' 표시를 켜고, 주소를 새로 넣으면 끈다 —
        // 방금 직접 적은 주소한테까지 확인하라고 하면 그 표시를 아무도 안 믿게 된다.
        nameChanged:
          field === "name"
            ? cell.savedName !== cell.name && cell.savedName !== ""
            : false,
      });
      setTimeout(() => patch(orgId, { status: "idle" }), 1500);
    } catch {
      patch(orgId, { status: "error" });
    }
  }

  function openSend(owner: SurveyOrgData) {
    const scope = [owner, ...owner.children];
    const candidates: Candidate[] = scope
      .filter((o) => {
        const c = cells[o.org.id];
        return c && c.savedEmail !== "" && isValidEmail(c.savedEmail);
      })
      .map((o) => {
        const c = cells[o.org.id];
        return {
          orgId: o.org.id,
          label: o.org.basis,
          name: c.savedName,
          email: c.savedEmail,
          inherited: c.emailInherited,
          fromPeriod: c.emailFromPeriod,
        };
      });

    // 기본 체크: 링크 주인에게 주소가 있으면 그 한 사람, 없으면(HR실처럼) 범위 안 전원.
    const ownerHasEmail = candidates.some((c) => c.orgId === owner.org.id);
    const checked: Record<number, boolean> = {};
    candidates.forEach((c) => {
      checked[c.orgId] = ownerHasEmail ? c.orgId === owner.org.id : true;
    });

    setSend({
      owner,
      candidates,
      checked,
      opensOthers: owner.children.length > 0,
      childLabels: owner.children.map((c) => c.org.basis),
      draft: null,
      copied: false,
      phase: "confirm",
      message: "",
    });
  }

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

  // 담당자는 적혀 있는데 메일이 없는 곳 — 발송이 막히는 유일한 이유라 상시 눈에 보이게 둔다.
  const missingEmail = useMemo(
    () =>
      flatten(ordered).filter((i) => {
        const c = cells[i.org.id];
        return c && c.savedName.trim() !== "" && c.savedEmail === "";
      }).length,
    [ordered, cells]
  );

  return (
    <div className="survey-wrap">
      <div className="panel survey-panel">
        <div className="panel-title">조사 현황 ({period})</div>
        <MailTemplateEditor
          initialSubject={mailSubject}
          initialBody={mailBody}
          period={period}
          hasPreviousMail={hasPreviousMail}
          onSaved={() => setHasTemplate(true)}
        />
      </div>

      {divisions.map((division) => (
        <DivisionTable
          key={division}
          title={division}
          items={grouped[division]}
          period={period}
          cells={cells}
          patch={patch}
          save={save}
          onSend={openSend}
          hasTemplate={hasTemplate}
        />
      ))}

      {send && (
        <SendDialog state={send} setState={setSend} period={period} onClose={() => setSend(null)} />
      )}
    </div>
  );
}
