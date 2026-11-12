/**
 * 묶음 조사 링크 — 담당자 한 명이 여러 조직을 한 링크에서 검토·입력할 때 쓴다 (2026-11-12 사용자 요청).
 *
 * 링크 주소는 각 조직 링크 토큰을 이어 붙인 것(/submit/multi/<토큰>-<토큰>-…)이라 따로 저장할 것이 없다.
 * 열리는 범위도 각 조직 링크를 따로 연 것과 똑같다 — 토큰을 모르면 열리지 않는다.
 * 화면 위쪽의 조직 버튼 순서는 orgs에 적은 순서다.
 */
export interface LinkBundle {
  title: string;
  orgs: string[];
}

export const LINK_BUNDLES: LinkBundle[] = [
  {
    title: "검토 요청 묶음",
    orgs: ["Staff(휴맥스이브이)", "국내영업팀", "Platform개발팀", "사업 그룹", "개발 그룹", "Media그룹"],
  },
];

export const BUNDLE_TOKEN_SEPARATOR = "-";

export function bundlePathOf(tokens: string[]): string {
  return `/submit/multi/${tokens.join(BUNDLE_TOKEN_SEPARATOR)}`;
}
