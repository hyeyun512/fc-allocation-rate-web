import { TargetKey, sumTargets, normalizeTargets, RATE_TOTAL_TOLERANCE } from "./targets";

/**
 * 조직 하나의 배부율을 운영 표(allocation_rate)에 반영한다.
 *
 * 예전에는 담당자가 링크에서 '제출'을 하고, 관리자가 화면에서 '확정'을 눌러야 비로소 여기에 값이 들어왔다.
 * 두 단계를 나눠 두니 제출은 됐는데 확정을 잊어 값이 반영되지 않는 일이 생겼다.
 * 이제 **제출이 곧 반영**이다 — 링크 제출과 관리자 저장이 모두 이 함수를 지나간다.
 *
 * 배부율 표에 남는 값은 항상 합계 100%여야 한다. 입력 단계에서 ±0.5%p까지 허용한 오차가
 * 여기까지 흘러오므로, 저장 직전에 비율을 유지한 채 100%로 맞춘다.
 * (제출 이력 allocation_submissions에는 입력한 값을 그대로 남긴다 — 무엇을 적었는지 추적해야 한다.)
 */

export interface RateOrg {
  type: string;
  division: string;
  basis: string;
  /** 상위 조직이 있는 하위 팀인지. 있으면 배부율 표에 싣지 않는다. */
  parent_basis?: string | null;
}

export interface ApplyRateResult {
  error: string | null;
  /** 100%로 맞추면서 값이 실제로 달라졌으면 그 원래 합계 (화면에 알려주기 위함). */
  correctedFrom: number | null;
}

// 나눗셈에서 생기는 부동소수점 찌꺼기(1e-16 수준)까지 알리면 잡음이라 그보다 큰 것만 센다.
const CORRECTION_NOTICE_THRESHOLD = 1e-9;

export async function applyOrgRate(
  supabase: any,
  org: RateOrg,
  period: string,
  parsed: Record<TargetKey, number>,
  noteLabel: string
): Promise<ApplyRateResult> {
  // 하위 팀(SW팀·HW팀·재무팀 등)은 배부율 표에 싣지 않는다.
  // 그 값은 상위 조직(개발 그룹·경영지원실) 한 줄에 인원수 가중평균으로 이미 들어가 있어,
  // 따로 실으면 같은 인원이 두 줄로 잡힌다. View가 하위 팀을 걸러 보여주던 것을
  // 화면이 아니라 저장 단계에서 지키게 한 것이다 — 표를 그대로 읽는 쪽(fc-2 등)도 중복되지 않는다.
  // 제출한 값 자체는 allocation_submissions에 그대로 남고, 상위 조직 계산도 그 표를 쓴다.
  if (org.parent_basis) {
    const { error } = await supabase
      .from("allocation_rate")
      .delete()
      .eq("quarter", period)
      .eq("type", org.type)
      .eq("division", org.division)
      .eq("basis", org.basis);
    return { error: error?.message ?? null, correctedFrom: null };
  }

  // 값을 다 지우고 저장한 경우(합계 0)에는 0%짜리 행을 남기지 않고 아예 지운다.
  // 예전에는 0으로 덮어썼는데, 그러면 입력한 적 없는 분기가 배부율 목록에 계속 남았다.
  if (sumTargets(parsed) <= 0) {
    const { error } = await supabase
      .from("allocation_rate")
      .delete()
      .eq("quarter", period)
      .eq("type", org.type)
      .eq("division", org.division)
      .eq("basis", org.basis);
    return { error: error?.message ?? null, correctedFrom: null };
  }

  const enteredTotal = sumTargets(parsed);
  const normalized = normalizeTargets(parsed);

  // 화면 검증이 ±0.5%p까지만 통과시키므로 그보다 큰 편차는 정상 경로로는 오지 않는다.
  // 그런데도 들어왔다면 입력 실수일 가능성이 크다 — 100%로 맞춰 저장하되 흔적은 로그에 남긴다.
  if (Math.abs(enteredTotal - 1) > RATE_TOTAL_TOLERANCE) {
    console.warn(
      `[allocation] 합계 이상: ${period} ${org.basis} 입력 ${(enteredTotal * 100).toFixed(4)}% -> 100%로 보정해 저장`
    );
  }

  const { error } = await supabase.from("allocation_rate").upsert(
    {
      quarter: period,
      type: org.type,
      division: org.division,
      basis: org.basis,
      ...normalized,
      total: sumTargets(normalized),
      update_flag: true,
      note: `${noteLabel} - ${new Date().toISOString()}`,
    },
    { onConflict: "quarter,type,division,basis" }
  );

  return {
    error: error?.message ?? null,
    correctedFrom: Math.abs(enteredTotal - 1) > CORRECTION_NOTICE_THRESHOLD ? enteredTotal : null,
  };
}
