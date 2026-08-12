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

/* ── 문구 ──
   제목·본문은 관리자가 화면에서 직접 적는다. 분기·제출 기한 같은 것도 그때그때 손으로 적으므로
   자리표시자는 두지 않는다 — 딱 하나, **조직마다 달라지는 링크**만 서버가 채운다.

   영어로 나가는 조직(HUK 등)은 담당자가 한국어를 읽지 못하므로 아래 영문 문구를 그대로 쓴다. */

/** 본문에서 링크 자리를 직접 정하고 싶을 때 쓰는 유일한 자리표시자. 없으면 본문 끝에 붙인다. */
export const LINK_PLACEHOLDER = "{링크}";

/** 본문에 링크를 넣는다. 자리표시자가 있으면 그 자리에, 없으면 끝에. */
export function insertLink(body: string, url: string): string {
  const b = String(body ?? "");
  if (b.includes(LINK_PLACEHOLDER)) return b.split(LINK_PLACEHOLDER).join(url);
  return `${b.trimEnd()}\n\n${url}`;
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
  return null;
}

export interface LinkMailInput {
  /** 링크를 소유한 조직의 표기 — 영문 기본 문구에서만 쓴다. */
  orgLabel: string;
  url: string;
  lang: MailLang;
  /** 관리자가 이번 분기에 적어 둔 문구. 한국어 조직은 이게 없으면 메일을 만들지 않는다. */
  subject?: string | null;
  body?: string | null;
}

export interface LinkMail {
  subject: string;
  body: string;
}

/**
 * 보낼 메일 한 통을 만든다. 적어 둔 문구가 없으면 null —
 * 빈 메일을 내보내느니 화면에서 "문구를 먼저 저장하라"고 말하는 편이 낫다.
 */
export function buildLinkMail(input: LinkMailInput): LinkMail | null {
  if (input.lang === "en") {
    // 영문은 코드에 한 벌 둔다. 관리자가 한국어로 적은 문구를 영국 담당자에게 보낼 수는 없다.
    return {
      subject: `[Resource Allocation] Survey input request - ${input.orgLabel}`,
      body: [
        "Hello,",
        "",
        `Please complete the resource allocation survey for ${input.orgLabel} using the link below.`,
        "",
        input.url,
        "",
        "Please do not forward this link. Reply to this email if you have any questions.",
        "",
        "Thank you.",
      ].join("\n"),
    };
  }

  const subject = String(input.subject ?? "").trim();
  const body = String(input.body ?? "").trim();
  if (!subject || !body) return null;

  return { subject, body: insertLink(body, input.url) };
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
