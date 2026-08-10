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
  // 2Q에만 있던 조직 (1Q에는 없었고 3Q부터 없음)
  사업협력팀: { from: "2026-Q2", to: "2026-Q2" },
};

/** "2026-Q1" → 20261 (분기 크기 비교용). 형식이 다르면 null. */
export function quarterKey(quarter: string): number | null {
  const m = /^(\d{4})-Q([1-4])$/.exec(String(quarter).trim());
  return m ? Number(m[1]) * 10 + Number(m[2]) : null;
}

/** 그 분기에 이 조직이 존재했는지. 표에 없는 조직은 항상 존재하는 것으로 본다. */
export function isOrgActiveIn(basis: string, quarter: string): boolean {
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
