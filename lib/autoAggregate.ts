import { TARGETS, TargetKey, sumTargets } from "./targets";
import { latestByPerson, computeRollup, countedPersonRows, SubmissionRow } from "./rollup";
import { ensureFixedRates } from "./fixedRates";

/**
 * 자동계산 조직(상위 집계 조직 · HKR)의 배부율을 서버에서 다시 계산해 allocation_rate에 반영한다.
 *
 * 예전에는 화면에 '저장' 버튼을 두고 담당자가 직접 눌러야 반영됐는데, 값 자체가 하위 조직에서
 * 파생되는 것이라 누르는 걸 잊으면 조용히 누락됐다. 이제 하위 조직을 확정/제출할 때마다
 * 이 함수가 함께 돌아 자동으로 최신값을 남긴다.
 *
 * 계산식은 화면(ConfirmReview.tsx)의 weightedAvgFromChildren / computeHkr과 동일하게 맞춰뒀다.
 */

const AFFILIATE_KEYS: TargetKey[] = [
  "h_mobility",
  "h_ev",
  "hiparking",
  "peoplecar",
  "winercom",
  "holdings",
  "h_networks",
];

/**
 * 값을 직접 입력받지 않고 다른 조직의 값을 그대로 따라가는 조직.
 * 사업총괄대표는 사업그룹장과 같은 배부율을 쓰므로 별도로 입력받지 않는다.
 */
export const MIRROR_RULES: { from: string; to: string }[] = [{ from: "사업그룹장", to: "사업총괄대표" }];

/**
 * 검토·확정 화면에서 **입력란만** 감출 조직 (값이 자동으로 채워지므로).
 * 상위 조직 가중평균에는 그대로 포함된다 — 실제로 존재하는 자리이기 때문이다.
 */
export const HIDDEN_IN_CONFIRM = MIRROR_RULES.map((r) => r.to);

/** 미러 조직은 한 사람이 앉는 자리라 인원수를 항상 1명으로 센다. */
export const MIRROR_HEADCOUNT = 1;

/** basis가 다른 조직 값을 따라가는 자리라면 그 원본 조직명을 돌려준다. */
export function mirrorSourceOf(basis: string): string | null {
  return MIRROR_RULES.find((r) => r.to === basis)?.from ?? null;
}

type Rec = Record<TargetKey, number>;

function zeroRec(): Rec {
  const r = {} as Rec;
  TARGETS.forEach((t) => (r[t.key] = 0));
  return r;
}

function toRec(row: Record<string, any> | null): Rec {
  const r = zeroRec();
  if (!row) return r;
  TARGETS.forEach((t) => (r[t.key] = Number(row[t.key]) || 0));
  return r;
}

interface OrgState {
  rate: Rec;
  weight: number;
  hasSubmission: boolean;
}

/**
 * 조직 하나의 **이번 분기** 값과 인원 가중치.
 *
 * 예전에는 이번 분기 입력이 없으면 지난 분기 확정값을 끌어다 썼는데, 그러면 화면의 분기별 표와
 * 자동계산 값이 서로 맞지 않았다(1Q 계산에 2Q 값이 섞여 들어감). 이번 분기 값만 쓴다 —
 * 제출이 있으면 그 롤업, 없으면 이번 분기 확정값(집계 조직처럼 파생된 값), 그것도 없으면 0.
 */
function buildOrgState(org: any, subs: SubmissionRow[], rateRows: any[], period: string): OrgState {
  const orgSubs = subs.filter((s) => s.org_id === org.id);
  const deduped = latestByPerson(orgSubs);
  const orgLevelRow = deduped.find((r) => r.person_name === null) ?? null;
  const personRows = deduped.filter((r) => r.person_name !== null);
  // 값이 전부 0인 저장(행을 다 지웠거나 0%)은 제출로 보지 않는다 — 화면 판정과 같은 기준.
  const hasSubmission =
    (Number(orgLevelRow?.total) || 0) > 0 || personRows.some((p) => (Number(p.total) || 0) > 0);

  // 전 항목 0%인 행은 '지우고 저장한' 흔적이라 값으로 쓰지 않는다.
  const thisQuarterRate =
    rateRows.find(
      (r) =>
        r.quarter === period &&
        r.basis === org.basis &&
        r.division === org.division &&
        r.type === org.type &&
        (Number(r.total) || 0) > 0
    ) ?? null;

  const rate = hasSubmission ? (computeRollup(orgLevelRow, personRows) as Rec) : toRec(thisQuarterRate);
  // 가중치는 실제 입력된 인원수 (팀 수가 아니라 인원 비율로 가중해야 한다).
  // 개인별 입력 조직은 값이 채워진 개인 행 수(한 행 = 한 명), 조직 단위 입력 조직은 조직 인원수 값을 쓴다.
  const fromPersons = countedPersonRows(personRows).length;
  const weight = fromPersons > 0 ? fromPersons : Number(orgLevelRow?.headcount) || 0;

  return { rate, weight, hasSubmission };
}

function weightedAvg(states: OrgState[]): Rec {
  const r = zeroRec();
  if (states.length === 0) return r;
  const totalW = states.reduce((a, s) => a + s.weight, 0);
  // 아무도 인원수를 적지 않았으면 균등 평균으로 물러난다.
  const useWeights = totalW > 0;
  const divisor = useWeights ? totalW : states.length;
  TARGETS.forEach((t) => {
    const weighted = states.reduce((sum, s) => sum + (s.rate[t.key] || 0) * (useWeights ? s.weight : 1), 0);
    r[t.key] = divisor > 0 ? weighted / divisor : 0;
  });
  return r;
}

/** 본사 가중평균에서 계열사 배부분을 빼고 나머지로 재정규화 (HKR). */
function renormalizeExcludingAffiliates(avg: Rec): Rec {
  const humaxSum = TARGETS.reduce(
    (sum, t) => (AFFILIATE_KEYS.includes(t.key) ? sum : sum + (avg[t.key] || 0)),
    0
  );
  const r = zeroRec();
  TARGETS.forEach((t) => {
    r[t.key] = AFFILIATE_KEYS.includes(t.key) ? 0 : humaxSum > 0 ? (avg[t.key] || 0) / humaxSum : 0;
  });
  return r;
}

/** 그 분기에 계산할 근거가 없어진 자동계산 행을 지운다 (입력한 적 없는 분기가 목록에 남지 않도록). */
async function deleteRate(supabase: any, key: { quarter: string; type: string; division: string; basis: string }) {
  const { error } = await supabase
    .from("allocation_rate")
    .delete()
    .eq("quarter", key.quarter)
    .eq("type", key.type)
    .eq("division", key.division)
    .eq("basis", key.basis);
  return error;
}

async function upsertRate(
  supabase: any,
  row: { quarter: string; type: string; division: string; basis: string; rates: Rec; version?: string }
) {
  // 하위 조직에 아직 입력이 없으면 합이 0이 된다. 0%짜리 확정 행을 남기면 실제로는 미입력인데
  // 확정된 것처럼 보이므로, 남아 있던 행이 있으면 지우고 새로 쓰지는 않는다.
  if (sumTargets(row.rates) <= 0) return deleteRate(supabase, row);

  const { error } = await supabase.from("allocation_rate").upsert(
    {
      quarter: row.quarter,
      type: row.type,
      division: row.division,
      basis: row.basis,
      ...row.rates,
      total: sumTargets(row.rates),
      update_flag: true,
      note: `자동계산 반영 (${row.version ?? ""}) - ${new Date().toISOString()}`,
    },
    { onConflict: "quarter,type,division,basis" }
  );
  return error;
}

/**
 * 상위 집계 조직 + HKR을 다시 계산해 저장한다.
 * 실패해도 호출한 저장 자체는 이미 끝난 상태이므로, 오류는 문자열 배열로 돌려주고 예외는 던지지 않는다.
 */
export async function recomputeAggregates(
  supabase: any,
  period: string,
  version?: string
): Promise<string[]> {
  const problems: string[] = [];

  // 고정비율은 조사로 받는 값이 아니라 정의상 고정된 비율이라 분기마다 그대로 복제한다.
  problems.push(...(await ensureFixedRates(supabase, period)));

  const { data: orgs } = await supabase.from("allocation_orgs").select("*").eq("active", true);
  if (!orgs?.length) return problems;

  const { data: subs } = await supabase
    .from("allocation_submissions")
    .select("*")
    .eq("period", period)
    .order("submitted_at", { ascending: false });

  const { data: rateRows } = await supabase
    .from("allocation_rate")
    .select("*")
    .order("quarter", { ascending: true });

  const submissions = (subs ?? []) as SubmissionRow[];
  const rates = rateRows ?? [];

  const stateById = new Map<number, OrgState>();
  orgs.forEach((o: any) => stateById.set(o.id, buildOrgState(o, submissions, rates, period)));

  // 미러 조직(사업총괄대표)은 직접 입력받지 않으므로 원본 조직(사업그룹장) 값을 그대로 쓰고,
  // 인원수는 1명으로 잡는다. 아래 상위 조직 가중평균에도 이 상태로 참여한다.
  for (const rule of MIRROR_RULES) {
    const src = orgs.find((o: any) => o.basis === rule.from);
    const dst = orgs.find((o: any) => o.basis === rule.to);
    const srcState = src ? stateById.get(src.id) : null;
    if (!dst || !srcState) continue;
    stateById.set(dst.id, {
      rate: srcState.rate,
      weight: MIRROR_HEADCOUNT,
      hasSubmission: srcState.hasSubmission,
    });
  }

  // 집계 조직은 자기 인원을 따로 갖지 않으므로 하위 조직 인원수를 합쳐 가중치로 쓴다.
  // (그대로 두면 인원수 0으로 잡혀 HKR 같은 상위 평균에서 통째로 빠진다 — 화면 계산과 동일하게 맞춘다.)
  const weightOf = (org: any): number => {
    const children = orgs.filter((o: any) => o.parent_basis === org.basis);
    if (children.length === 0) return stateById.get(org.id)?.weight ?? 0;
    return children.reduce((s: number, ch: any) => s + weightOf(ch), 0);
  };
  for (const o of orgs) {
    if (!orgs.some((x: any) => x.parent_basis === o.basis)) continue;
    const st = stateById.get(o.id);
    if (st) stateById.set(o.id, { ...st, weight: weightOf(o) });
  }

  // 1) 하위 조직을 가진 상위 집계 조직 (예: 경영지원실 = 재무팀 + Staff(경영지원))
  for (const parent of orgs) {
    const children = orgs.filter((o: any) => o.parent_basis === parent.basis);
    if (children.length === 0) continue;
    const childStates: OrgState[] = children.map((c: any) => stateById.get(c.id)!).filter(Boolean);
    // 이번 분기에 아무 하위 조직도 입력하지 않았으면 계산할 근거가 없다 —
    // 남아 있던 행이 있으면 지운다 (입력한 적 없는 분기가 목록에 남지 않도록).
    if (!childStates.some((s) => s.hasSubmission)) {
      await deleteRate(supabase, {
        quarter: period,
        type: parent.type,
        division: parent.division,
        basis: parent.basis,
      });
      continue;
    }
    const avg = weightedAvg(childStates);
    const err = await upsertRate(supabase, {
      quarter: period,
      type: parent.type,
      division: parent.division,
      basis: parent.basis,
      rates: avg,
      version,
    });
    if (err) problems.push(`${parent.basis}: ${err.message}`);
  }

  // 2) 다른 조직 값을 그대로 따라가는 조직의 배부율을 기록 (사업총괄대표 ← 사업그룹장)
  for (const rule of MIRROR_RULES) {
    const dst = orgs.find((o: any) => o.basis === rule.to);
    const dstState = dst ? stateById.get(dst.id) : null;
    // 원본 조직이 이번 분기에 입력하지 않았으면 복사할 값이 없다
    // (지난 분기 확정값이 이번 분기 값으로 둔갑하는 걸 막는다). 남아 있던 행은 지운다.
    if (!dst) continue;
    if (!dstState?.hasSubmission) {
      await deleteRate(supabase, { quarter: period, type: dst.type, division: dst.division, basis: dst.basis });
      continue;
    }
    const err = await upsertRate(supabase, {
      quarter: period,
      type: dst.type,
      division: dst.division,
      basis: dst.basis,
      rates: dstState.rate,
      version,
    });
    if (err) problems.push(`${dst.basis}: ${err.message}`);
  }

  // 3) HKR(관계사제외) = 본사 최상위 조직들의 가중평균 → 계열사 제외 재정규화
  const honsa = orgs.filter((o: any) => o.division === "본사" && !o.parent_basis);
  const honsaStates: OrgState[] = honsa.map((o: any) => stateById.get(o.id)!).filter(Boolean);
  // 상위 집계 조직과 같은 기준 — 이번 분기에 입력한 본사 조직이 하나도 없으면 기록하지 않고,
  // 남아 있던 행이 있으면 지운다 (입력한 적 없는 분기가 목록에 남지 않도록).
  const hkrKey = { quarter: period, type: "리소스배부율", division: "본사", basis: "HKR(관계사제외)" };
  if (honsaStates.some((s) => s.hasSubmission)) {
    const hkr = renormalizeExcludingAffiliates(weightedAvg(honsaStates));
    const err = await upsertRate(supabase, { ...hkrKey, rates: hkr, version });
    if (err) problems.push(`HKR(관계사제외): ${err.message}`);
  } else {
    const err = await deleteRate(supabase, hkrKey);
    if (err) problems.push(`HKR(관계사제외) 정리: ${err.message}`);
  }

  return problems;
}
