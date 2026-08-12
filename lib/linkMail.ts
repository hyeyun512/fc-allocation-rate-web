/**
 * 조사 링크 안내 메일의 제목·본문과 주소 검증.
 *
 * **이 파일에는 실제 조직명이 하나도 없다.** `lang`과 `orgLabel`을 파라미터로 받는다 —
 * 조직명 목록이 든 lib/englishOrgs.ts를 여기서 import하면 클라이언트 번들에 실려
 * 담당자에게 다른 조직 이름이 노출된다(englishOrgs.ts 머리말의 규약).
 * 그래서 서버(라우트)가 언어와 표기를 계산해서 넘긴다.
 *
 * 전부 순수 함수라 /api/admin/selftest에서 그대로 검증한다.
 */

import { prettyQuarterLabel, parseQuarter } from "./quarter";

export type MailLang = "ko" | "en";

/* ─────────────────────────── 주소 ─────────────────────────── */

export function normalizeEmail(raw: string): string {
  return String(raw ?? "").trim().toLowerCase();
}

// 쉼표·세미콜론·공백을 명시적으로 거절한다 — 한 칸에 여러 명을 몰래 넣을 수 없게 해서
// "조직당 수신자 1명"이라는 규칙이 데이터 수준에서 깨지지 않게 한다.
const EMAIL_RE = /^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const EMAIL_FORBIDDEN = /[\s,;<>()[\]\\]/;

export function isValidEmail(email: string): boolean {
  const v = normalizeEmail(email);
  if (!v || v.length > 254) return false;
  if (EMAIL_FORBIDDEN.test(v)) return false;
  if (v.includes("..") || v.startsWith(".") || v.includes(".@") || v.startsWith("@")) return false;
  return EMAIL_RE.test(v);
}

/** allowed가 비어 있으면(사내 도메인을 아직 안 정했으면) 통과시킨다. */
export function isAllowedDomain(email: string, allowed: string[]): boolean {
  if (!allowed.length) return true;
  const domain = normalizeEmail(email).split("@")[1] ?? "";
  return allowed.some((d) => {
    const t = d.trim().toLowerCase().replace(/^@/, "");
    return t !== "" && (domain === t || domain.endsWith(`.${t}`));
  });
}

/** 쉼표로 구분한 환경변수를 도메인 목록으로. 값이 없으면 빈 배열(= 검사 안 함). */
export function parseAllowedDomains(raw: string | undefined): string[] {
  return String(raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/* ─────────────────────────── 마감 안내 ───────────────────────────
   본문에서 유일하게 사람이 자유롭게 적는 칸이다. 서버가 길이·제어문자·URL을 막는다 —
   메일 본문에 임의의 링크가 끼어들면 수신자가 어느 링크를 눌러야 하는지 알 수 없다. */

// 줄바꿈·탭 같은 제어문자만 막는다. **공백은 허용**한다 ("9월 30일까지"처럼 띄어 쓰는 게 자연스럽다).
function hasControlChar(v: string): boolean {
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c < 32 || c === 127) return true;
  }
  return false;
}

export function isValidDeadline(s: string): boolean {
  const v = String(s ?? "");
  if (v.length === 0) return true; // 비워두면 마감 줄 자체를 빼므로 정상이다
  if (v.length > 40) return false;
  if (hasControlChar(v)) return false;
  if (/https?:\/\//i.test(v) || /www\./i.test(v)) return false;
  return true;
}

/* ─────────────────────────── 마스킹 ───────────────────────────
   로그에 주소·토큰 전체를 남기지 않는다. 토큰은 그 자체가 자격증명이라
   로그를 볼 수 있는 사람이 곧 그 조직의 입력 화면을 열 수 있게 된다. */

export function maskEmail(email: string): string {
  const v = normalizeEmail(email);
  const at = v.indexOf("@");
  if (at <= 0) return v ? "***" : "";
  return `${v[0]}***${v.slice(at)}`;
}

export function maskToken(token: string): string {
  const v = String(token ?? "");
  return v.length <= 4 ? "…" : `…${v.slice(-3)}`;
}

/* ─────────────────────────── 본문 ─────────────────────────── */

/* ── 문구 템플릿 ──
   조직마다 문구가 거의 같으므로 관리자가 화면에서 한 번 고쳐 두고 전 조직에 쓴다.
   영어 링크 조직(HUK 등)은 아래 영문 문구를 그대로 쓴다 — 한 벌만 고치면 되도록. */

export const MAIL_PLACEHOLDERS: { key: string; desc: string }[] = [
  { key: "{분기}", desc: "2026-3Q" },
  { key: "{분기숫자}", desc: "3 (‘3분기’처럼 쓸 때)" },
  { key: "{연도2}", desc: "26 (‘26년’처럼 쓸 때)" },
  { key: "{조직}", desc: "링크를 가진 조직 이름" },
  { key: "{담당자}", desc: "수신자 이름 (여러 명이면 함께)" },
  { key: "{링크}", desc: "조사 입력 링크 — 반드시 넣어야 합니다" },
  { key: "{마감}", desc: "제출 기한 (분기가 바뀌면 ‘재설정 필요’)" },
  { key: "{범위안내}", desc: "이 링크가 어디까지 여는지 자동 안내" },
];

/** 제출 기한을 아직 이번 분기 것으로 정하지 않았을 때 본문에 대신 들어가는 말. */
export const DEADLINE_UNSET = "재설정 필요";

/* 기본 문구는 실제로 쓰던 협조요청 메일에서 가져왔다.
   분기와 제출 기한만 자리표시자로 바꿔, 분기가 넘어가면 저절로 따라가고 기한은 다시 묻게 했다. */
export const DEFAULT_MAIL_SUBJECT = "[협조요청] 부서별 투입리소스 작성 ({연도2}년 {분기숫자}Q)";

export const DEFAULT_MAIL_BODY = [
  "안녕하세요,",
  "경영지원실 주혜윤입니다.",
  "",
  "고정비 실적 보고를 위해 부서별 리소스 현황 작성 요청 드립니다.",
  "아래 링크 접속하시어 {분기숫자}분기 리소스 배부율 작성 후 ‘제출하기’ 버튼 클릭하시면 완료됩니다.",
  "",
  "{링크}",
  "",
  "· 제출 기한: {마감}",
  "{범위안내}",
  "",
  "감사합니다.",
].join("\n");

/**
 * 자리표시자를 채운다. **값이 빈 자리표시자가 든 줄은 통째로 뺀다** —
 * 마감을 비웠을 때 "· 입력 마감:" 만 남는 걸 막으려는 규칙이다.
 */
export function renderMailTemplate(tpl: string, vars: Record<string, string>): string {
  const keys = Object.keys(vars);
  return String(tpl ?? "")
    .split("\n")
    .map((line) => {
      const used = keys.filter((k) => line.includes(k));
      if (used.some((k) => vars[k] === "")) return null;
      return used.reduce((s, k) => s.split(k).join(vars[k]), line);
    })
    .filter((l): l is string => l !== null)
    .join("\n");
}

/** 저장 전 검사. 문제가 없으면 null. */
export function mailTemplateProblem(subject: string, body: string): string | null {
  const s = String(subject ?? "").trim();
  const b = String(body ?? "").trim();
  if (!s) return "제목을 입력해 주세요.";
  if (s.length > 200) return "제목이 너무 깁니다 (200자 이내).";
  if (s.includes("\n")) return "제목은 한 줄이어야 합니다.";
  if (!b) return "본문을 입력해 주세요.";
  if (b.length > 4000) return "본문이 너무 깁니다 (4000자 이내).";
  // 링크가 빠지면 담당자가 아무것도 할 수 없는 메일이 나간다 — 이것만은 막는다.
  if (!b.includes("{링크}")) return "본문에 {링크}가 있어야 합니다. 링크가 없으면 담당자가 입력할 수 없습니다.";
  return null;
}

export interface LinkMailInput {
  /** 링크를 소유한 조직의 표기 — 메일 한 통이 이 링크 하나를 안내하므로 제목도 이 조직 이름이다. */
  orgLabel: string;
  /** 수신자 이름들. 같은 링크를 쓰는 담당자는 한 통에 함께 넣는다(서로 수신인으로 보인다). */
  recipientNames: string[];
  period: string;
  url: string;
  lang: MailLang;
  deadline?: string;
  /**
   * 이 링크를 열면 소유 조직 말고 하위 조직도 보이는지.
   * true면 "전용"이라 쓸 수 없다 — 하위 팀 값까지 함께 열린다.
   */
  opensOthers: boolean;
  /** 관리자가 화면에서 고친 문구. 없으면 기본 문구를 쓴다. (영어 조직에는 적용하지 않는다.) */
  subjectTemplate?: string | null;
  bodyTemplate?: string | null;
}

export interface LinkMail {
  subject: string;
  body: string;
}

export function buildLinkMail(input: LinkMailInput): LinkMail {
  const q = prettyQuarterLabel(input.period);
  const names = (input.recipientNames ?? []).map((n) => String(n ?? "").trim()).filter(Boolean);
  const deadline = String(input.deadline ?? "").trim();
  const { orgLabel, opensOthers } = input;

  if (input.lang === "en") {
    const lines = [
      names.length ? `Hello ${names.join(", ")},` : "Hello,",
      "",
      `Please complete the ${q} resource allocation survey for ${orgLabel} using the link below.`,
      "",
      input.url,
      "",
    ];
    if (deadline) lines.push(`- Due: ${deadline}`);
    lines.push(
      opensOthers
        ? `- This link opens the input screen for ${orgLabel} and all of its sub-teams.`
        : `- This link is unique to ${orgLabel}.`
    );
    lines.push("- Please do not forward it. Reply to this email if you have any questions.", "", "Thank you.");
    return {
      subject: `[Resource Allocation] ${q} survey input request - ${orgLabel}`,
      body: lines.join("\n"),
    };
  }

  const parsed = parseQuarter(input.period);
  const vars: Record<string, string> = {
    "{분기}": q,
    "{분기숫자}": parsed.year ? String(parsed.q) : "",
    "{연도2}": parsed.year ? String(parsed.year).slice(-2) : "",
    "{조직}": orgLabel,
    "{담당자}": names.map((n) => `${n}님`).join(", "),
    "{링크}": input.url,
    // 기한을 아직 이번 분기 것으로 정하지 않았으면 줄을 지우지 않고 눈에 띄게 남긴다 —
    // 조용히 사라지면 기한 없는 메일이 나간 걸 아무도 모른다.
    "{마감}": deadline || DEADLINE_UNSET,
    "{범위안내}": opensOthers
      ? `· 이 링크는 ${orgLabel}과 그 하위 조직 전체의 입력·열람 화면입니다.`
      : `· 이 링크는 ${orgLabel} 전용입니다.`,
  };

  const subjectTpl = input.subjectTemplate?.trim() ? input.subjectTemplate : DEFAULT_MAIL_SUBJECT;
  const bodyTpl = input.bodyTemplate?.trim() ? input.bodyTemplate : DEFAULT_MAIL_BODY;

  return {
    subject: renderMailTemplate(subjectTpl, vars),
    body: renderMailTemplate(bodyTpl, vars),
  };
}

/**
 * Outlook 초안을 여는 mailto: URL.
 * 관리자 PC의 기본 메일 앱이 Outlook 데스크톱임을 확인하고 이 방식으로 정했다.
 */
export function mailtoUrl(to: string | string[], subject: string, body: string): string {
  // 주소는 하나씩 인코딩하고 구분자 쉼표는 그대로 둔다 — 쉼표까지 %2C로 바꾸면
  // Outlook이 전체를 주소 하나로 읽어 수신인이 깨진다.
  // @는 주소의 일부라 인코딩하지 않는다(메일 주소에서는 그대로 두는 것이 관례이고 호환성도 낫다).
  const list = (Array.isArray(to) ? to : [to])
    .map((a) => encodeURIComponent(a).replace(/%40/g, "@"))
    .join(",");
  return `mailto:${list}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
