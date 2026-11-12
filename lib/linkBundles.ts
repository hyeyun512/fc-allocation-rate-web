/**
 * 묶음 조사 링크 — 담당자 한 명이 여러 조직을 한 링크에서 검토·입력할 때 쓴다 (2026-11-12 사용자 요청).
 *
 * 링크 주소는 각 조직 링크 토큰을 이어 붙인 것(/submit/multi/<토큰>-<토큰>-…)이라 따로 저장할 것이 없다.
 * 열리는 범위도 각 조직 링크를 따로 연 것과 똑같다 — 토큰을 모르면 열리지 않는다.
 * 화면 위쪽의 조직 버튼 순서는 orgs에 적은 순서다.
 *
 * 묶음 링크에 든 조직(과 그 하위 팀)은 제출한 뒤에도 그 링크에서 계속 고칠 수 있다(관리자 허용 없이).
 * 대신 baselineAt 시점의 값과 달라진 칸은 빨갛게 보이고, 원래 값으로 되돌려 저장하면 풀린다.
 */
export interface LinkBundle {
  title: string;
  orgs: string[];
  /** 빨간 칸의 기준 시점 — 이 시각까지 저장된 값이 '처음 값'이다 (묶음 링크를 만든 시각). */
  baselineAt: string;
}

export const LINK_BUNDLES: LinkBundle[] = [
  {
    title: "검토 요청 묶음",
    orgs: ["Staff(휴맥스이브이)", "국내영업팀", "Platform개발팀", "사업 그룹", "개발 그룹", "Media그룹"],
    baselineAt: "2026-11-12T06:30:00Z",
  },
];

export const BUNDLE_TOKEN_SEPARATOR = "-";

export function bundlePathOf(tokens: string[]): string {
  return `/submit/multi/${tokens.join(BUNDLE_TOKEN_SEPARATOR)}`;
}

/** 이 조직(또는 그 상위 조직)이 든 묶음. */
export function bundleOfOrg(org: { basis: string; parent_basis?: string | null }): LinkBundle | null {
  return LINK_BUNDLES.find((b) => b.orgs.includes(org.basis) || (!!org.parent_basis && b.orgs.includes(org.parent_basis))) ?? null;
}

export function isBundleOrg(org: { basis: string; parent_basis?: string | null }): boolean {
  return !!bundleOfOrg(org);
}
