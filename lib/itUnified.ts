import { TARGETS, TargetKey } from "./targets";

/**
 * 26년 4Q IT사업부 규칙 (사용자 지시 2026-11-25).
 *
 * 1) IT사업부와 그 팀들은 조사값과 상관없이 배부율을 **IT 100%**로 통일한다.
 *    팀이 무엇을 적어 냈든 운영 표(allocation_rate)에는 IT 100%로 싣는다.
 *    통일 전 원본 조사값은 별도 엑셀(IT사업부_26년4Q_원본데이터(IT100%통일전)_261125.xlsx)에 보관했다.
 * 2) HKR(관계사제외)은 IT사업부를 **빼고** 본사 조직 평균을 낸다 — IT사업부가 없던 3Q와 같은 방식.
 *    그래서 HKR에는 IT사업부 몫(IT 배부)이 들어가지 않는다.
 *
 * 다른 기간에도 같은 규칙을 쓰려면 IT_UNIFIED_QUARTERS에 기간을 더한다.
 */
export const IT_DIVISION_BASIS = "IT사업부";
export const IT_UNIFIED_QUARTERS = ["2026-Q4"];

export function isItUnifiedIn(period: string): boolean {
  return IT_UNIFIED_QUARTERS.includes(period);
}

/** IT사업부 자신이거나 그 하위 팀인지. */
export function isItDivisionOrg(org: { basis: string; parent_basis?: string | null }): boolean {
  return org.basis === IT_DIVISION_BASIS || org.parent_basis === IT_DIVISION_BASIS;
}

/** 이 기간에 배부율을 IT 100%로 통일하는 조직인지. */
export function forcesItRate(org: { basis: string; parent_basis?: string | null }, period: string): boolean {
  return isItUnifiedIn(period) && isItDivisionOrg(org);
}

/** HKR(관계사제외) 평균에서 빼는 본사 최상위 조직인지. */
export function excludedFromHkr(basis: string, period: string): boolean {
  return isItUnifiedIn(period) && basis === IT_DIVISION_BASIS;
}

/** IT 100% 배부율 (나머지 대상은 0). */
export function itOnlyRates(): Record<TargetKey, number> {
  const r = {} as Record<TargetKey, number>;
  TARGETS.forEach((t) => (r[t.key] = t.key === "it" ? 1 : 0));
  return r;
}

/**
 * 27년 BP는 HKR(관계사제외)을 IT사업부 포함으로 두고, IT사업부만 뺀 같은 방식의 배부율을 하나 더 만든다
 * (사용자 지시 2026-11-27). 본사 최상위 조직 인원수 가중평균 → 계열사 제외 재정규화, 단 IT사업부는 평균에서 뺀다.
 */
export const HKR_EX_IT_BASIS = "HKR(관계사,IT제외)";
export const HKR_EX_IT_QUARTERS = ["2027-BP"];

export function hasHkrExIt(period: string): boolean {
  return HKR_EX_IT_QUARTERS.includes(period);
}
