"use client";

import { Fragment, useMemo, useState } from "react";
import { leaderFirst, sortForOrgPicker, DIVISION_ORDER } from "@/lib/orgOrder";
import {
  isValidEmail,
  renderMailTemplate,
  mailTemplateProblem,
  MAIL_PLACEHOLDERS,
  DEFAULT_MAIL_SUBJECT,
  DEFAULT_MAIL_BODY,
  DEADLINE_UNSET,
} from "@/lib/linkMail";
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
  draft: { to: string[]; subject: string; body: string; url: string } | null;
  phase: "confirm" | "ready" | "sending" | "error";
  message: string;
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

function SendDialog({
  state,
  setState,
  period,
  deadline,
  onClose,
}: {
  state: SendState;
  setState: (s: SendState) => void;
  period: string;
  deadline: string;
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
      const draft = { to: result.to as string[], subject: result.subject, body: result.body, url: result.mailtoUrl };
      // 확인창에서 이미 한 번 확인했으므로 클릭을 또 요구하지 않는다.
      openDraft(draft.url);
      setState({ ...state, draft, phase: "ready", message: "" });
    } catch {
      setState({ ...state, phase: "error", message: "초안을 만들지 못했습니다." });
    }
  }

  return (
    <div className="send-backdrop" role="dialog" aria-modal="true" aria-label="조사 링크 발송">
      <div className="send-dialog">
        {state.phase === "ready" && state.draft ? (
          <>
            <div className="send-title">Outlook 초안을 열었습니다</div>
            <p className="send-lead">
              내용을 확인하고 <b>[보내기]</b>를 눌러 주세요. 초안을 열었을 뿐 아직 발송되지 않았습니다.
            </p>
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
              <button className="btn btn-secondary btn-sm" onClick={() => openDraft(state.draft!.url)}>
                초안 다시 열기
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
            <p className="send-lead">Outlook 초안이 열립니다. 확인 후 [보내기]를 눌러 주세요.</p>
            {state.phase === "error" && <p className="send-error">{state.message}</p>}
            <div className="send-actions">
              <button
                className="btn btn-primary btn-sm"
                disabled={chosen.length === 0 || state.phase === "sending"}
                onClick={prepare}
              >
                {state.phase === "sending" ? "초안 만드는 중..." : `초안 열기 (수신인 ${chosen.length}명)`}
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

function DivisionTable({
  title,
  items,
  cells,
  patch,
  save,
  onSend,
}: {
  title: string;
  items: SurveyOrgData[];
  cells: CellMap;
  patch: (orgId: number, next: Partial<CellState>) => void;
  save: (orgId: number, field: "name" | "email") => void;
  onSend: (owner: SurveyOrgData) => void;
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
                    <OrgCell item={item} />
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
                      <OrgCell item={c} isChild />
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

/* ─────────────────── 메일 문구 편집 ───────────────────
   조직마다 문구가 거의 같아서 여기서 한 번 고쳐 두고 전 조직에 쓴다.
   영어 링크 조직(HUK 등)은 코드의 영문 문구를 그대로 쓴다. */

function MailTemplateEditor({
  initialSubject,
  initialBody,
  period,
  deadline,
}: {
  initialSubject: string;
  initialBody: string;
  period: string;
  deadline: string;
}) {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState(initialSubject || DEFAULT_MAIL_SUBJECT);
  const [body, setBody] = useState(initialBody || DEFAULT_MAIL_BODY);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");

  // 자리표시자가 실제로 어떻게 채워지는지 눈으로 보고 고칠 수 있게 예시로 미리 보여준다.
  const preview = useMemo(() => {
    const m = /^(\d{4})-Q(\d)$/.exec(period);
    const vars: Record<string, string> = {
      "{분기}": m ? `${m[1]}-${m[2]}Q` : period,
      "{분기숫자}": m ? m[2] : "",
      "{연도2}": m ? m[1].slice(-2) : "",
      "{조직}": "HR실",
      "{담당자}": "이채아 팀장님, 최광수 팀장님",
      "{링크}": "https://…/submit/c4bab112da0eaa7a04",
      "{마감}": deadline || DEADLINE_UNSET,
      "{범위안내}": "· 이 링크는 HR실과 그 하위 조직 전체의 입력·열람 화면입니다.",
    };
    return { subject: renderMailTemplate(subject, vars), body: renderMailTemplate(body, vars) };
  }, [subject, body, period, deadline]);

  async function save(reset = false) {
    const problem = reset ? null : mailTemplateProblem(subject, body);
    if (problem) {
      setError(problem);
      setState("error");
      return;
    }
    setState("saving");
    setError("");
    try {
      const res = await fetch("/api/admin/mail-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reset ? { reset: true } : { subject, body }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? "저장하지 못했습니다.");
        setState("error");
        return;
      }
      if (reset) {
        setSubject(DEFAULT_MAIL_SUBJECT);
        setBody(DEFAULT_MAIL_BODY);
      }
      setState("saved");
      setTimeout(() => setState("idle"), 1500);
    } catch {
      setError("저장하지 못했습니다.");
      setState("error");
    }
  }

  return (
    <div className="mail-tpl">
      <button type="button" className="mail-tpl-toggle" onClick={() => setOpen(!open)}>
        {open ? "▾" : "▸"} 메일 문구 {open ? "" : "— 제목·본문을 여기서 고칩니다"}
      </button>

      {open && (
        <div className="mail-tpl-body">
          <div className="mail-tpl-keys">
            {MAIL_PLACEHOLDERS.map((p) => (
              <button
                key={p.key}
                type="button"
                title={p.desc}
                onClick={() => setBody((b) => `${b}${p.key}`)}
              >
                {p.key}
              </button>
            ))}
          </div>
          <div className="field-hint" style={{ marginBottom: 8 }}>
            자리표시자를 누르면 본문 끝에 붙습니다. <b>값이 빈 자리표시자가 든 줄은 통째로 빠집니다</b> — 마감을
            비우면 마감 줄이 사라집니다. 영어로 나가는 조직(HUK)은 이 문구 대신 영문 기본 문구를 씁니다.
          </div>

          <label className="mail-tpl-label">제목</label>
          <input className="mail-tpl-input" value={subject} onChange={(e) => setSubject(e.target.value)} />

          <label className="mail-tpl-label">본문</label>
          <textarea className="mail-tpl-area" rows={13} value={body} onChange={(e) => setBody(e.target.value)} />

          <label className="mail-tpl-label">미리보기 (HR실 예시)</label>
          <div className="send-preview">
            <b>{preview.subject}</b>
            <pre>{preview.body}</pre>
          </div>

          {error && <p className="send-error">{error}</p>}
          <div className="mail-tpl-actions">
            <button className="btn btn-primary btn-sm" disabled={state === "saving"} onClick={() => save(false)}>
              {state === "saving" ? "저장 중..." : state === "saved" ? "저장됨" : "문구 저장"}
            </button>
            <button className="btn btn-secondary btn-sm" disabled={state === "saving"} onClick={() => save(true)}>
              기본 문구로 되돌리기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SurveyOverview({
  period,
  data,
  mailSubject,
  mailBody,
  initialDeadline,
}: {
  period: string;
  data: SurveyOrgData[];
  mailSubject: string;
  mailBody: string;
  /** 이번 분기에 정해 둔 제출 기한. 분기가 바뀌었으면 서버가 빈 값으로 내려준다. */
  initialDeadline: string;
}) {
  // 담당자 칸 상태는 행이 아니라 **화면 전체**가 들고 있다. 발송 버튼은 링크 주인 행에 있는데
  // 주소는 하위 행에 입력될 수 있어(HR실·Staff(CEO)) 행 안에 상태를 가두면 버튼이 갱신되지 않는다.
  const [cells, setCells] = useState<CellMap>(() => initialCells(data));
  const [send, setSend] = useState<SendState | null>(null);
  // 제출 기한은 DB에 분기와 함께 저장한다. 분기가 바뀌면 지난 기한은 무효가 되어 빈 값으로 내려오고,
  // 메일에는 '재설정 필요'가 찍혀 기한 없는 메일이 조용히 나가는 걸 막는다.
  const [deadline, setDeadline] = useState(initialDeadline);
  const [deadlineSaved, setDeadlineSaved] = useState(initialDeadline);
  const [deadlineState, setDeadlineState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function saveDeadline() {
    if (deadline === deadlineSaved) return;
    setDeadlineState("saving");
    try {
      const res = await fetch("/api/admin/mail-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ only: "deadline", deadline, period }),
      });
      if (!res.ok) throw new Error();
      setDeadlineSaved(deadline);
      setDeadlineState("saved");
      setTimeout(() => setDeadlineState("idle"), 1500);
    } catch {
      setDeadlineState("error");
    }
  }

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
        nameChanged: field === "name" ? cell.savedName !== cell.name && cell.savedName !== "" : cell.nameChanged,
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
        <div className="callout info" style={{ margin: 0 }}>
          전체 {submitting.length}개 조직 중 <b>{submittedCount}</b>개 제출
          {missingEmail > 0 && (
            <>
              {" · "}
              <b>메일 미등록 {missingEmail}곳</b>
            </>
          )}
        </div>
        <div className="survey-deadline">
          <label htmlFor="survey-deadline-input">제출 기한</label>
          <input
            id="survey-deadline-input"
            className={deadlineSaved === "" ? "needs-set" : undefined}
            value={deadline}
            maxLength={40}
            placeholder="예: 8/14(금)"
            onChange={(e) => setDeadline(e.target.value)}
            onBlur={saveDeadline}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                saveDeadline();
              }
            }}
          />
          <span className="survey-save-state" style={deadlineState === "error" ? { color: "#dc2626" } : undefined}>
            {deadlineState === "saving"
              ? "저장중"
              : deadlineState === "saved"
              ? "저장됨"
              : deadlineState === "error"
              ? "실패"
              : deadlineSaved === ""
              ? "메일에 ‘재설정 필요’로 나갑니다"
              : ""}
          </span>
        </div>
        <MailTemplateEditor
          initialSubject={mailSubject}
          initialBody={mailBody}
          period={period}
          deadline={deadlineSaved}
        />
      </div>

      {divisions.map((division) => (
        <DivisionTable
          key={division}
          title={division}
          items={grouped[division]}
          cells={cells}
          patch={patch}
          save={save}
          onSend={openSend}
        />
      ))}

      {send && (
        <SendDialog
          state={send}
          setState={setSend}
          period={period}
          deadline={deadline}
          onClose={() => setSend(null)}
        />
      )}
    </div>
  );
}
