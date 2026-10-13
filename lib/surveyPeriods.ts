import { sortQuarters } from "./quarter";

/**
 * 조사 링크에 여는 기간.
 *
 * 관리자 화면의 '현재 라운드'(current_period)는 관리자가 검토하는 기간 하나다. 그런데 26년 4Q와
 * 27년 BP처럼 두 기간을 동시에 조사하면 담당자는 링크 하나에서 둘 다 입력해야 한다.
 * 그래서 링크에 여는 기간은 따로 둔다(allocation_settings.survey_periods).
 *
 * 비어 있거나 컬럼이 아직 없으면 예전처럼 current_period 하나만 연다 —
 * 설정을 따로 하지 않은 라운드는 지금까지와 똑같이 동작한다.
 */
export function surveyPeriodsOf(settings: { current_period?: string | null; survey_periods?: string[] | null } | null): string[] {
  const list = (settings?.survey_periods ?? []).map((p) => String(p).trim()).filter(Boolean);
  if (list.length > 0) return sortQuarters(Array.from(new Set(list)));
  return settings?.current_period ? [settings.current_period] : [];
}

/**
 * 요청에 실린 기간을 검증한다. 링크에 열린 기간이 아니면 null.
 * 기간을 싣지 않은 요청(배포 전에 열어 둔 화면)은 첫 번째로 열린 기간으로 본다.
 */
export function resolveSurveyPeriod(
  settings: { current_period?: string | null; survey_periods?: string[] | null } | null,
  requested: unknown
): string | null {
  const open = surveyPeriodsOf(settings);
  if (requested == null || requested === "") return settings?.current_period ?? open[0] ?? null;
  const p = String(requested);
  return open.includes(p) ? p : null;
}
