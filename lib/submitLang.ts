/**
 * 조사 링크(/submit/[token]) 화면의 문구 — 한국어 / 영어.
 *
 * 해외 법인 중에는 담당자가 현지인이라 화면 전체가 영어로 보여야 하는 조직이 있다.
 * **어떤 조직이 영어인지는 이 모듈에 두지 않는다** — 조직명은 서버 전용 모듈(lib/englishOrgs.ts)에만 두고,
 * 이 모듈에는 조직명이 없는 화면 문구만 담아 공개 링크 번들에 들어가도 다른 조직명이 새지 않게 한다.
 *
 * 관리자 화면도 같은 표 컴포넌트(@/components/RateParts)를 쓰므로 기본값은 항상 "ko"다 —
 * lang을 넘기지 않으면 지금까지와 똑같이 한국어로 보인다.
 */

import { TargetDef } from "./targets";

export type SubmitLang = "ko" | "en";

const KO = {
  /** 날짜·시각 표기 로캘. */
  locale: "ko-KR",

  /** 브라우저 탭 제목 — 루트 레이아웃의 한국어 제목을 링크 화면에서 덮어쓴다. */
  pageTitle: "고정비 배부율 조사",
  pageDescription: "조직별 고정비 배부율 조사/취합 웹",

  // ── 표 공통 (RateParts) ─────────────────────────────────────────────
  colHeadcount: "인원수",
  colName: "이름",
  colRole: "구분",
  colComment: "코멘트",
  roleLegal: "법인",
  roleExpat: "주재원",
  headcountValue: (n: number) => `${n}명`,
  clearRow: "입력값 지우기",
  deleteRow: "행 삭제",
  addPerson: (hasExpat: boolean) => `+ ${hasExpat ? "인원" : "팀원"} 추가`,
  quarterConfirmed: (q: string) => `${q} (확정됨)`,

  // ── 조직 입력 구역 (SubmitForm) ─────────────────────────────────────
  divisionLabel: (d: string) => d,
  badgeSubmitted: (period: string) => `제출됨 (${period})`,
  badgeNotSubmitted: "미제출",
  unitPersonDetail: "개인별 확인 필요",
  unitOrgLevel: "조직 단위",
  submitterPrefix: "제출자: ",
  inputterLabel: "입력자 (책임자/담당자 이름) *",
  namePlaceholder: "이름",
  justSubmittedTitle: "제출이 완료되었습니다.",
  justSubmittedBody: " 담당자 검토 후 최종 반영됩니다. 수정이 필요하면 아래 '수정하기'를 눌러 다시 제출하실 수 있습니다.",
  sectionOrgRate: "■ 조직별 리소스 배부율",
  sectionPersonRate: "■ 개인별 리소스 배부율",
  personHint:
    "관계사·계열사(H.Mobility~H.Networks)에 청구되는 조직이라 개인별 확인이 필요합니다. 팀원별로 행을 추가해 입력해주세요. 위 조직 단위 값은 아래 행들의 평균으로 자동 계산됩니다.",
  loadPrev: "전분기 데이터 끌고오기",
  loadPrevPersons: (n: number) => `전분기 데이터 끌고오기 (${n}명)`,
  quarterEditing: (q: string) => `${q} (입력중)`,
  quarterAuto: (q: string) => `${q} (자동계산)`,
  quarterSubmitted: (q: string) => `${q} (제출됨)`,
  totalWarning: (q: string) => `⚠ ${q} 합계가 100%가 아닙니다. 각 항목의 비율 합이 100%가 되도록 입력해주세요.`,
  btnEdit: "수정하기",
  btnSubmit: "제출하기",
  btnSubmitting: "제출 중...",
  draftSaving: "임시저장 중...",
  draftFailed: "임시저장 실패 — 네트워크를 확인해주세요",
  draftSaved: (time: string) => `임시저장됨 ${time} (제출 전까지 담당자에게 보이지 않습니다)`,
  draftIdle: "입력하면 자동으로 임시저장됩니다 (제출 전까지 담당자에게 보이지 않습니다)",
  errNoName: "입력자 이름을 적어주세요.",
  errPersonTotal: (name: string) => `'${name}'님의 비율 합계가 100%가 아닙니다. 확인 후 다시 제출해주세요.`,
  errOrgTotal: "조직 단위 배부율 합계가 100%가 아닙니다. 확인 후 다시 제출해주세요.",
  errSubmit: "제출 중 오류가 발생했습니다.",
  errDraft: "임시저장 실패",

  // ── 집계 조직 화면 (ParentSummary) ──────────────────────────────────
  badgeAggregate: "집계 조직",
  childProgress: (done: number, total: number) => `하위 조직 ${done}/${total} 제출`,
  parentSub: (names: string) => `하위 조직(${names})의 인원수 가중평균으로 자동 계산됩니다. 아래에서 하위 조직별로 입력해주세요.`,
  mirrorNote: (basis: string, source: string, headcount: number) =>
    `※ ${basis}은(는) ${source}과(와) 동일한 배부율을 적용하며, 인원수 ${headcount}명으로 위 가중평균에 포함됩니다. 별도 입력란은 두지 않습니다.`,
  parentFooter: "아래 하위 조직을 제출하면 이 값도 자동으로 다시 계산되어 반영됩니다.",
  childSectionTitle: (n: number) => `■ 하위 조직 개별 입력 (${n}개)`,
};

export type SubmitStrings = typeof KO;

const EN: SubmitStrings = {
  locale: "en-GB",

  pageTitle: "Fixed Cost Allocation Survey",
  pageDescription: "Fixed cost allocation rates by organisation",

  colHeadcount: "Headcount",
  colName: "Name",
  colRole: "Type",
  colComment: "Comment",
  roleLegal: "Local",
  roleExpat: "Expatriate",
  headcountValue: (n: number) => String(n),
  clearRow: "Clear this row",
  deleteRow: "Delete row",
  addPerson: () => "+ Add person",
  quarterConfirmed: (q: string) => `${q} (confirmed)`,

  divisionLabel: (d: string) =>
    d === "법인" ? "Subsidiary" : d === "주재원" ? "Expatriates" : d === "본사" ? "Head office" : d,
  badgeSubmitted: (period: string) => `Submitted (${period})`,
  badgeNotSubmitted: "Not submitted",
  unitPersonDetail: "Person-by-person entry required",
  unitOrgLevel: "Organisation level",
  submitterPrefix: "Submitted by: ",
  inputterLabel: "Completed by (name of the person in charge) *",
  namePlaceholder: "Name",
  justSubmittedTitle: "Your submission has been received.",
  justSubmittedBody:
    " It will be finalised once the allocation team has reviewed it. If you need to change anything, click 'Edit' below and submit again.",
  sectionOrgRate: "■ Resource allocation rate — organisation",
  sectionPersonRate: "■ Resource allocation rate — by person",
  personHint:
    "This organisation is charged to the affiliates (H.Mobility–H.Networks), so a person-by-person breakdown is required. Add one row per team member. The organisation-level figures above are calculated automatically as the average of the rows below.",
  loadPrev: "Copy last quarter's figures",
  loadPrevPersons: (n: number) => `Copy last quarter's figures (${n} ${n === 1 ? "person" : "people"})`,
  quarterEditing: (q: string) => `${q} (in progress)`,
  quarterAuto: (q: string) => `${q} (calculated)`,
  quarterSubmitted: (q: string) => `${q} (submitted)`,
  totalWarning: (q: string) => `⚠ The ${q} figures do not add up to 100%. Please adjust them so the total is exactly 100%.`,
  btnEdit: "Edit",
  btnSubmit: "Submit",
  btnSubmitting: "Submitting...",
  draftSaving: "Saving draft...",
  draftFailed: "Could not save the draft — please check your connection",
  draftSaved: (time: string) => `Draft saved at ${time} (not visible to the allocation team until you submit)`,
  draftIdle: "Your entries are saved as a draft automatically (not visible to the allocation team until you submit)",
  errNoName: "Please enter your name.",
  errPersonTotal: (name: string) => `${name}'s figures do not add up to 100%. Please check and submit again.`,
  errOrgTotal: "The organisation-level figures do not add up to 100%. Please check and submit again.",
  errSubmit: "Something went wrong while submitting.",
  errDraft: "Could not save the draft",

  badgeAggregate: "Aggregated organisation",
  childProgress: (done: number, total: number) => `${done}/${total} sub-organisations submitted`,
  parentSub: (names: string) =>
    `Calculated automatically as the headcount-weighted average of the sub-organisations (${names}). Please fill in each sub-organisation below.`,
  mirrorNote: (basis: string, source: string, headcount: number) =>
    `* ${basis} uses the same allocation rate as ${source} and is included in the weighted average above with a headcount of ${headcount}. No separate entry is required.`,
  parentFooter: "These figures are recalculated automatically each time a sub-organisation below is submitted.",
  childSectionTitle: (n: number) => `■ Sub-organisation entries (${n})`,
};

export function submitStrings(lang: SubmitLang = "ko"): SubmitStrings {
  return lang === "en" ? EN : KO;
}

/** 배부 대상(13개 열) 표기 — 영어 링크에서는 영문 표기를 쓴다. */
export function targetLabel(target: TargetDef, lang: SubmitLang = "ko"): string {
  return lang === "en" ? target.labelEn : target.label;
}
