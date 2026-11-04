import { quarterRank } from "./quarter";

/**
 * 조직 존속 분기.
 *
 * 조직은 분기마다 생기고 없어진다. allocation_orgs.active는 "지금 쓰는지"만 나타내서
 * "1Q에는 있었고 2Q부터는 없다" 같은 걸 표현하지 못했다. 그 결과 없어진 조직이 이후 분기
 * 조사 목록·자동계산·View에 계속 나타났다.
 *
 * 여기 적힌 범위 밖 분기에서는 그 조직이 어디에도 나타나지 않는다.
 *   from 생략 → 처음부터 존재 · to 생략 → 지금도 존재
 * 조직이 실제로 생기거나 없어질 때만 이 표를 고치면 된다.
 */
export const ORG_LIFESPAN: Record<string, { from?: string; to?: string }> = {
  // 1Q에만 있던 조직 (2Q부터 없음)
  "Staff(CEO) 직속": { to: "2026-Q1" },
  // 2Q부터 인원이 없어 조사하지 않는 조직 (2Q·3Q에 인원 0으로 저장된 값은 DB에 남아 있지만 화면에는 싣지 않는다).
  HDG_주재원: { to: "2026-Q1" },
  HAU: { to: "2026-Q1" },
  // 2Q에만 있던 조직 (1Q에는 없었고 3Q부터 없음)
  사업협력팀: { from: "2026-Q2", to: "2026-Q2" },
  // 3Q까지 있던 조직 (4Q에 폐쇄 — 개발 그룹 하위)
  "Staff(개발)": { to: "2026-Q3" },
  // 26년 4Q에 새로 생긴 IT사업부와 그 팀들 — 그룹 링크 하나로 조사하고, 배부율은 팀마다 남긴다
  // (lib/confirmRate.ts의 TEAM_RATE_GROUPS).
  "IT사업부": { from: "2026-Q4" },
  "IT사업대표": { from: "2026-Q4" },
  "Staff(IT)": { from: "2026-Q4" },
  "ERP PI팀": { from: "2026-Q4" },
  "Infra팀": { from: "2026-Q4" },
  "개발팀": { from: "2026-Q4" },
  "MES팀": { from: "2026-Q4" },
  "준솔팀": { from: "2026-Q4" },
  "사업팀": { from: "2026-Q4" },
  "AI팀": { from: "2026-Q4" },
  "PM팀": { from: "2026-Q4" },
};

/**
 * 존속 기간 안이지만 특정 기간에만 빠지는 조직.
 * 27년 BP(사업계획)를 편성하지 않는 법인은 BP 배부율이 필요 없다(사용자 지시) — 26년 4Q까지와
 * 27년 분기 실적에는 그대로 나온다. 여기 적힌 기간에는 조사·검토·자동계산·View 어디에도 나오지 않는다.
 */
export const ORG_SKIP_PERIODS: Record<string, string[]> = {
  HUS: ["2027-BP"],
  HJP: ["2027-BP"],
  HUG: ["2027-BP"],
  HID: ["2027-BP"],
  HTR: ["2027-BP"],
};

/** "2026-Q1" → 20261, "2027-BP" → 20270 (분기 크기 비교용). 형식이 다르면 null. */
export function quarterKey(quarter: string): number | null {
  const rank = quarterRank(String(quarter));
  return rank < 0 ? null : rank;
}

/** 그 분기에 이 조직이 존재했는지. 표에 없는 조직은 항상 존재하는 것으로 본다. */
export function isOrgActiveIn(basis: string, quarter: string): boolean {
  if (ORG_SKIP_PERIODS[basis]?.includes(quarter)) return false;
  const span = ORG_LIFESPAN[basis];
  if (!span) return true;
  const q = quarterKey(quarter);
  if (q == null) return true;
  const from = span.from ? quarterKey(span.from) : null;
  const to = span.to ? quarterKey(span.to) : null;
  if (from != null && q < from) return false;
  if (to != null && q > to) return false;
  return true;
}
