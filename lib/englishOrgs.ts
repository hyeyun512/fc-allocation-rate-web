/**
 * 조사 링크를 **영어로** 내보내는 조직.
 *
 * HUK(영국 법인)와 HUK_주재원은 담당자가 영국인이라 화면 문구·표 머리글·코멘트가 모두 영어여야 한다.
 * 영어로 바꾸는 건 조사 링크(/submit/[token])뿐이다 — 관리자 화면(조사 현황·검토 및 확정·View)은 그대로 한국어다.
 *
 * 코멘트는 자유 입력이라 기계적으로 옮길 수 없다. 그래서 관리자 화면의 이 조직들에만 '코멘트(영문)' 칸을
 * 따로 두고(allocation_submissions.note_en), 링크에서는 그 글을 대신 보여준다.
 * 영문 칸이 비어 있으면 한국어 원문이 그대로 나간다.
 *
 * 이 모듈에는 실제 조직명이 들어 있으므로 **서버 컴포넌트/라우트에서만 import한다**.
 * 클라이언트 번들에 들어가면 담당자에게 다른 조직의 이름이 노출된다.
 * 화면 문구만 담은 lib/submitLang.ts는 조직명이 없어 클라이언트에서 써도 된다.
 */

import { SubmitLang } from "./submitLang";

/** 링크 화면을 영어로 보여줄 조직 (basis 기준). */
const ENGLISH_ORG_BASIS = ["HUK", "HUK_주재원"];

export function submitLangOf(basis: string): SubmitLang {
  return ENGLISH_ORG_BASIS.includes(basis) ? "en" : "ko";
}

/** 관리자 화면에서 '코멘트(영문)' 칸을 함께 받아야 하는 조직인지. */
export function needsEnglishNote(basis: string): boolean {
  return submitLangOf(basis) === "en";
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
  "관리자 수정 (검토및확정)": "Allocation team (updated)",
  // 예전 표기 — 이미 저장된 이력에 남아 있어 계속 옮겨준다.
  "관리자 확정 (검토및확정)": "Allocation team (updated)",
  "관리자 코멘트 (검토및확정)": "Allocation team (comment)",
};

export function submitterFor(name: string | null | undefined, lang: SubmitLang): string | null {
  if (!name) return null;
  if (lang !== "en") return name;
  return SUBMITTER_EN[name.trim()] ?? name;
}

/**
 * 링크에 보여줄 코멘트. 영어 링크에서는 영문 칸(note_en)을 쓰고, 비어 있으면 한국어 원문을 그대로 쓴다
 * (영문을 아직 안 적었다고 담당자가 값을 못 보는 일은 없어야 한다).
 */
export function noteFor(
  note: string | null | undefined,
  noteEn: string | null | undefined,
  lang: SubmitLang
): string | null {
  if (lang === "en" && noteEn && noteEn.trim()) return noteEn;
  return note ?? null;
}
