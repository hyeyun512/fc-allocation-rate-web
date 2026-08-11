/**
 * 조직 목록 표시 순서.
 *
 * '조사' 현황과 '검토 및 확정 > 리소스배부율'의 조직/팀 선택이 **같은 단위·같은 순서**로 보여야 하므로
 * 두 화면이 이 규칙을 함께 쓴다.
 *
 * 이 모듈에는 실제 조직명이 들어 있다 — 관리자 화면에서만 쓰고,
 * 담당자에게 나가는 조사 링크(/submit/[token]) 쪽에서는 import하지 않는다.
 */

// 배부율조사 로직 정의(엑셀 '1차. 조직 표기' 열) 순서 그대로 — 법인(1~12) · 주재원(13~16) · 본사(17~29).
export const ORG_ORDER = [
  "HUS", "HMX", "HUK", "HDG", "HUG", "HTR", "HBR", "HJP", "HTH", "HAU", "HID", "HSZ",
  "HBR_주재원", "HDG_주재원", "HSZ_주재원", "HUK_주재원",
  "Staff(휴맥스이브이)", "국내영업팀", "Platform개발팀", "사업협력팀", "사업 그룹", "개발 그룹", "SCM실", "Media그룹", "CEO", "지식재산팀", "Staff(CEO)", "경영지원실", "HR실",
];

export function orgOrderIndex(basis: string): number {
  const i = ORG_ORDER.indexOf(basis);
  return i === -1 ? ORG_ORDER.length : i;
}

// 조직장(그룹장·실장)은 목록에서 항상 맨 위에 보여준다. 표기에 띄어쓰기가 섞여 있어 공백은 무시하고 비교한다.
// 경영지원실장은 재무팀 팀장으로 기재하기로 해 별도 조직을 두지 않는다.
const LEADER_FIRST = ["개발그룹장", "사업그룹장"];
export function isLeaderOrg(basis: string): boolean {
  return LEADER_FIRST.includes(String(basis).replace(/\s/g, ""));
}

/** 조직장을 맨 위로 올리되, 나머지는 원래 순서를 유지한다. */
export function leaderFirst<T extends { org: { basis: string } }>(items: T[]): T[] {
  return [...items].sort((a, b) => Number(isLeaderOrg(b.org.basis)) - Number(isLeaderOrg(a.org.basis)));
}

/** 구분(division) 표시 순서 — 위에서부터 본사 → 주재원 → 법인. */
export const DIVISION_ORDER = ["본사", "주재원", "법인"];

export function divisionRank(division: string): number {
  const i = DIVISION_ORDER.indexOf(division);
  return i === -1 ? DIVISION_ORDER.length : i;
}

/** 조직/팀 선택에 노출하는 순서 — 구분(본사→주재원→법인) 먼저, 그 안에서 조직장 먼저, 그 다음 엑셀 표 순서. */
export function sortForOrgPicker<T extends { org: { basis: string; division: string } }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) =>
      divisionRank(a.org.division) - divisionRank(b.org.division) ||
      Number(isLeaderOrg(b.org.basis)) - Number(isLeaderOrg(a.org.basis)) ||
      orgOrderIndex(a.org.basis) - orgOrderIndex(b.org.basis)
  );
}
