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
   제목·본문은 관리자가 화면에서 직접 적는다. 분기·제출 기한도 손으로 적으므로 자리표시자는 두지 않는다 —
   딱 하나, **조직마다 달라지는 링크**만 서버가 채운다.

   본문은 서식(굵게·글자색·배경색)을 쓸 수 있어야 해서 HTML로 저장한다. 그런데 `mailto:`로 여는
   초안의 본문은 규격상 **평문만** 담을 수 있다(RFC 6068). 그래서 두 가지를 함께 만든다 —
   초안에는 평문을 넣어 두고, 서식이 살아 있는 HTML은 클립보드로 넘겨 붙여넣게 한다. */

/** 본문에서 링크 자리를 직접 정하고 싶을 때 쓰는 유일한 자리표시자. 없으면 본문 끝에 붙는다. */
export const LINK_PLACEHOLDER = "{링크}";

/** 메일 본문 기본 글꼴 — Outlook에서 그대로 보이도록 인라인 스타일로 넣는다. */
export const MAIL_FONT_CSS = "font-family:'맑은 고딕','Malgun Gothic',sans-serif;font-size:10pt";

const BLOCK_END = /<\/(p|div|li|h[1-6]|tr)\s*>/gi;
const BR = /<br\s*\/?>/gi;

/** HTML 본문을 평문으로. 초안(mailto)에는 평문만 들어가므로 서식을 걷어낸 형태가 필요하다. */
export function htmlToPlainText(html: string): string {
  return String(html ?? "")
    .replace(BR, "\n")
    .replace(BLOCK_END, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ 	]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** 본문(HTML)에 링크를 넣는다. 자리표시자가 있으면 그 자리에, 없으면 끝에. */
export function insertLinkHtml(bodyHtml: string, url: string): string {
  const anchor = `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`;
  const b = String(bodyHtml ?? "");
  if (b.includes(LINK_PLACEHOLDER)) return b.split(LINK_PLACEHOLDER).join(anchor);
  return `${b}<div>&nbsp;</div><div>${anchor}</div>`;
}

/** 평문 본문에 링크를 넣는다. */
export function insertLink(body: string, url: string): string {
  const b = String(body ?? "");
  if (b.includes(LINK_PLACEHOLDER)) return b.split(LINK_PLACEHOLDER).join(url);
  return `${b.trimEnd()}\n\n${url}`;
}

/** Outlook에 붙여넣을 수 있도록 기본 글꼴을 입힌 조각으로 감싼다. */
export function wrapMailHtml(bodyHtml: string): string {
  return `<div style="${MAIL_FONT_CSS}">${bodyHtml}</div>`;
}

/** 저장 전 검사. 문제가 없으면 null. */
export function mailTemplateProblem(subject: string, bodyHtml: string): string | null {
  const s = String(subject ?? "").trim();
  const plain = htmlToPlainText(bodyHtml);
  if (!s) return "제목을 입력해 주세요.";
  if (s.length > 200) return "제목이 너무 깁니다 (200자 이내).";
  if (s.includes("\n")) return "제목은 한 줄이어야 합니다.";
  if (!plain) return "본문을 입력해 주세요.";
  if (String(bodyHtml ?? "").length > 20000) return "본문이 너무 깁니다.";
  return null;
}

export interface LinkMailInput {
  /** 링크를 소유한 조직의 표기 — 영문 기본 문구에서만 쓴다. */
  orgLabel: string;
  url: string;
  lang: MailLang;
  /** 관리자가 이번 분기에 적어 둔 문구(본문은 HTML). 한국어 조직은 이게 없으면 메일을 만들지 않는다. */
  subject?: string | null;
  bodyHtml?: string | null;
}

export interface LinkMail {
  subject: string;
  /** 초안(mailto)에 넣을 평문. */
  text: string;
  /** 클립보드로 넘겨 붙여넣을 서식 있는 본문. */
  html: string;
}

/**
 * 보낼 메일 한 통을 만든다. 적어 둔 문구가 없으면 null —
 * 빈 메일을 내보내느니 화면에서 "문구를 먼저 저장하라"고 말하는 편이 낫다.
 */
export function buildLinkMail(input: LinkMailInput): LinkMail | null {
  if (input.lang === "en") {
    // 영문은 코드에 한 벌 둔다. 관리자가 한국어로 적은 문구를 영국 담당자에게 보낼 수는 없다.
    const lines = [
      "Hello,",
      "",
      `Please complete the resource allocation survey for ${input.orgLabel} using the link below.`,
      "",
      input.url,
      "",
      "Please do not forward this link. Reply to this email if you have any questions.",
      "",
      "Thank you.",
    ];
    return {
      subject: `[Resource Allocation] Survey input request - ${input.orgLabel}`,
      text: lines.join("\n"),
      html: wrapMailHtml(lines.map((l) => `<div>${l === "" ? "&nbsp;" : escapeHtml(l)}</div>`).join("")),
    };
  }

  const subject = String(input.subject ?? "").trim();
  const bodyHtml = String(input.bodyHtml ?? "");
  if (!subject || !htmlToPlainText(bodyHtml)) return null;

  const html = wrapMailHtml(insertLinkHtml(bodyHtml, input.url));
  return { subject, text: insertLink(htmlToPlainText(bodyHtml), input.url), html };
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

/* ─────────────────────── Outlook 초안 파일(.eml) ───────────────────────
   `mailto:`는 규격상 본문에 **평문만** 담을 수 있어(RFC 6068) 굵게·글자색이 전부 날아간다.
   그래서 메시지 한 통을 통째로 만들어 파일로 내려준다 — 열면 Outlook이 초안 창으로 띄운다.
   `X-Unsent: 1`이 그 표식이다. 이 헤더가 없으면 '받은 메일'처럼 열려 [보내기] 버튼이 없다. */

/** 브라우저·서버 양쪽에서 도는 base64. 이 파일은 클라이언트 번들에도 실리므로 Buffer를 쓸 수 없다. */
function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/**
 * 헤더에 한글을 담기 위한 RFC 2047 인코딩(`=?UTF-8?B?...?=`).
 * 인코딩된 낱말 하나가 75자를 넘으면 안 되므로 나눠 담고 접는다.
 * 글자가 중간에서 잘리면 깨지므로 바이트가 아니라 **글자 단위**로 세면서 나눈다.
 */
export function encodeMimeWord(text: string): string {
  const s = String(text ?? "");
  if (!s) return "";
  // ASCII뿐이면 그대로 둔다 — 굳이 인코딩하면 사람이 읽기만 어려워진다.
  if (!/[^\x20-\x7e]/.test(s)) return s;

  const enc = new TextEncoder();
  const chunks: string[] = [];
  let cur = "";
  let curBytes = 0;
  for (const ch of s) {
    const n = enc.encode(ch).length;
    if (cur && curBytes + n > 45) {
      chunks.push(cur);
      cur = "";
      curBytes = 0;
    }
    cur += ch;
    curBytes += n;
  }
  if (cur) chunks.push(cur);
  return chunks.map((part) => `=?UTF-8?B?${toBase64(enc.encode(part))}?=`).join("\r\n ");
}

/** 본문 HTML을 Outlook이 안정적으로 읽는 문서 형태로 감싼다. */
function mailHtmlDocument(bodyHtml: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${bodyHtml}</body></html>`;
}

export interface EmlInput {
  to: string[];
  subject: string;
  /** 서식이 살아 있는 본문 (buildLinkMail의 html). */
  html: string;
}

/** Outlook이 '보내지 않은 초안'으로 여는 .eml 한 통. */
export function buildEml({ to, subject, html }: EmlInput): string {
  const b64 = toBase64(new TextEncoder().encode(mailHtmlDocument(html)));
  // base64 본문은 한 줄 76자로 접는다 (RFC 2045).
  const body = (b64.match(/.{1,76}/g) ?? []).join("\r\n");
  const headers = [
    `To: ${to.join(", ")}`,
    `Subject: ${encodeMimeWord(subject)}`,
    "X-Unsent: 1",
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ];
  return `${headers.join("\r\n")}\r\n\r\n${body}\r\n`;
}

/** 내려받을 파일 이름. 파일 이름에 못 쓰는 글자를 걷어낸다. */
export function emlFileName(orgLabel: string): string {
  const safe = String(orgLabel ?? "").replace(/[\/:*?"<>|]/g, "_").trim() || "조사링크";
  return `배부율조사_${safe}.eml`;
}
