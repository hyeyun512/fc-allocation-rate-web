/**
 * 조사 링크를 **영어로** 내보내는 조직.
 *
 * HUK(영국 법인)와 HUK_주재원은 담당자가 영국인이라 화면 문구·표 머리글·코멘트가 모두 영어여야 한다.
 * 영어로 바꾸는 건 조사 링크(/submit/[token])뿐이다 — 관리자 화면(조사 현황·검토 및 확정·View)은 그대로 한국어다.
 *
 * 이 모듈에는 실제 조직명과 과거 코멘트가 들어 있으므로 **서버 컴포넌트에서만 import한다**
 * (app/submit/[token]/page.tsx). 클라이언트 번들에 들어가면 담당자에게 다른 조직의 이름과 코멘트가 노출된다.
 * 화면 문구만 담은 lib/submitLang.ts는 조직명이 없어 클라이언트에서 써도 된다.
 */

import { SubmitLang } from "./submitLang";

/** 링크 화면을 영어로 보여줄 조직 (basis 기준). */
const ENGLISH_ORG_BASIS = ["HUK", "HUK_주재원"];

export function submitLangOf(basis: string): SubmitLang {
  return ENGLISH_ORG_BASIS.includes(basis) ? "en" : "ko";
}

/** 조직명에 한글이 섞여 있으면(예: HUK_주재원) 영어 링크에서는 영문 표기로 바꿔 보여준다. */
const ENGLISH_ORG_LABEL: Record<string, string> = {
  HUK_주재원: "HUK Expatriates",
};

export function orgLabelFor(basis: string, lang: SubmitLang): string {
  if (lang !== "en") return basis;
  return ENGLISH_ORG_LABEL[basis] ?? basis;
}

/**
 * 관리자 화면이 자동으로 남기는 제출자 표기 (api/admin/confirm, api/admin/org-note).
 * 담당자가 사람 이름 대신 이 문구를 보게 되므로 영어 링크에서는 영어로 바꿔준다.
 */
const SUBMITTER_EN: Record<string, string> = {
  "관리자 확정 (검토및확정)": "Allocation team (confirmed)",
  "관리자 코멘트 (검토및확정)": "Allocation team (comment)",
};

export function submitterFor(name: string | null | undefined, lang: SubmitLang): string | null {
  if (!name) return null;
  if (lang !== "en") return name;
  return SUBMITTER_EN[name.trim()] ?? name;
}

/**
 * 손으로 옮겨둔 코멘트 번역.
 *
 * 코멘트는 기계 번역(lib/noteTranslate.ts)으로 자동으로 영어가 되지만, 번역이 어색해서
 * 문구를 확정해두고 싶은 코멘트는 여기에 적어두면 기계 번역보다 **먼저** 쓰인다.
 * 키는 공백을 하나로 줄여서 맞춘다(줄바꿈·중복 공백 차이로 어긋나지 않게).
 */
const NOTE_EN: Record<string, string> = {
  "[STB] Aura STB 품질 이슈로 투입 증가 (I Wedia엔지니어 투입 2Q까지 지속 예상, 김종순의 경우 STB 투입률 100%임), HDG STB매출 1H 지속으로 조사나 계약직 고용상태(비용HUK부담), HDG 세무조사 진행중 / [EVCS] 2H 매출 예상":
    "[STB] Increased effort due to Aura STB quality issues (iWedia engineers expected to stay engaged through Q2; Jongsoon Kim is 100% allocated to STB). HDG STB sales continue through 1H, so Jyothsana remains on a fixed-term contract (cost borne by HUK); an HDG tax audit is under way. / [EVCS] Revenue expected in 2H",
};

/**
 * 사람 이름 표기 — 기계 번역이 이름을 제각각 옮기지 않도록 정해둔 표기를 알려준다.
 * (한글 이름이 실제로는 현지 이름인 경우가 있어 로마자로 옮기면 엉뚱해진다. 예: 조사나 → Jyothsana)
 */
export const PERSON_NAME_EN: Record<string, string> = {
  조사나: "Jyothsana",
  김종순: "Jongsoon Kim",
  김정욱: "Jungwook Kim",
};

const NOTE_EN_NORMALIZED = new Map(Object.entries(NOTE_EN).map(([ko, en]) => [ko.replace(/\s+/g, " ").trim(), en]));

/** 손으로 확정해둔 번역이 있으면 돌려준다 (없으면 null — 기계 번역으로 넘어간다). */
export function manualNoteEn(note: string): string | null {
  return NOTE_EN_NORMALIZED.get(note.replace(/\s+/g, " ").trim()) ?? null;
}
