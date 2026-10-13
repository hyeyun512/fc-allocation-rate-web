import { prettyQuarterLabel } from "./quarter";

/**
 * 조사 라운드 — 한 번에 함께 조사하는 기간 묶음.
 *
 * 보통 라운드는 기간 하나다(allocation_settings.current_period = "2026-Q3").
 * 26년 4Q와 27년 BP처럼 두 기간을 동시에 조사하면 담당자는 링크 하나에서 둘 다 입력해야 하므로,
 * 그런 라운드는 묶음 이름("2026-Q4+2027-BP")을 current_period에 저장하고 여기서 기간으로 풀어 쓴다.
 * 링크에는 기간별 탭이 생기고, 관리자 검토 화면은 묶음 안에서 기간을 골라 하나씩 본다.
 *
 * 저장값은 실제 데이터의 기간(allocation_rate.quarter 등)이 아니다 — 데이터에는 항상 풀린 기간 하나가 들어간다.
 */
export const ROUND_GROUPS: Record<string, string[]> = {
  "2026-Q4+2027-BP": ["2026-Q4", "2027-BP"],
};

/** 라운드에 들어 있는 기간들 (묶음이 아니면 그 기간 하나). */
export function roundPeriods(round: string | null | undefined): string[] {
  if (!round) return [];
  return ROUND_GROUPS[round] ?? [round];
}

/** 화면 표기: "2026-Q4+2027-BP" → "2026-4Q & 2027-BP". */
export function roundLabel(round: string): string {
  return roundPeriods(round).map(prettyQuarterLabel).join(" & ");
}

/** 조사 링크에 여는 기간 — 지금 라운드를 풀어 쓴 것. */
export function surveyPeriodsOf(settings: { current_period?: string | null } | null): string[] {
  return roundPeriods(settings?.current_period);
}

/**
 * 요청에 실린 기간을 검증한다. 지금 라운드의 기간이 아니면 null.
 * 기간을 싣지 않은 요청(배포 전에 열어 둔 화면)은 라운드의 첫 기간으로 본다.
 */
export function resolveSurveyPeriod(settings: { current_period?: string | null } | null, requested: unknown): string | null {
  const open = surveyPeriodsOf(settings);
  if (requested == null || requested === "") return open[0] ?? null;
  const p = String(requested);
  return open.includes(p) ? p : null;
}
