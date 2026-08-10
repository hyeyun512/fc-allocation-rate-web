import { TARGETS, TargetKey, sumTargets } from "./targets";
import { latestByPerson, computeRollup, countedPersonRows, SubmissionRow } from "./rollup";

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

/** 검토·확정 화면에서는 감추고 View에서만 보여줄 조직 (값이 자동으로 채워지는 조직). */
export const HIDDEN_IN_CONFIRM = MIRROR_RULES.map((r) => r.to);

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

/** 조직 하나의 이번 분기 값(제출이 있으면 롤업, 없으면 마지막 확정값)과 인원 가중치. */
function buildOrgState(org: any, subs: SubmissionRow[], rateRows: any[]): OrgState {
  const orgSubs = subs.filter((s) => s.org_id === org.id);
  const deduped = latestByPerson(orgSubs);
  const orgLevelRow = deduped.find((r) => r.person_name === null) ?? null;
  const personRows = deduped.filter((r) => r.person_name !== null);
  const hasSubmission = !!orgLevelRow || personRows.length > 0;

  // 전 항목 0%인 행은 '지우고 저장한' 흔적이라 마지막 확정값으로 쓰지 않는다.
  const own = rateRows.filter(
    (r) =>
      r.basis === org.basis &&
      r.division === org.division &&
      r.type === org.type &&
      (Number(r.total) || 0) > 0
  );
  const lastRate = own.length ? own[own.length - 1] : null;

  const rate = hasSubmission ? (computeRollup(orgLevelRow, personRows) as Rec) : toRec(lastRate);
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

async function upsertRate(
  supabase: any,
  row: { quarter: string; type: string; division: string; basis: string; rates: Rec; version?: string }
) {
  // 하위 조직에 아직 입력이 없으면 합이 0이 된다. 그 상태를 저장하면 0%짜리 확정 행이 생겨
  // 실제로는 미입력인데 확정된 것처럼 보이므로 건너뛴다.
  if (sumTargets(row.rates) <= 0) return null;

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
  orgs.forEach((o: any) => stateById.set(o.id, buildOrgState(o, submissions, rates)));

  // 1) 하위 조직을 가진 상위 집계 조직 (예: 경영지원실 = 재무팀 + Staff(경영지원))
  //    사업총괄대표처럼 다른 조직 값을 복사해 오는 조직은 평균에서 뺀다 —
  //    사업그룹장 값을 그대로 쓰는 것이라 같이 세면 그룹장이 두 번 반영된다.
  for (const parent of orgs) {
    const children = orgs.filter(
      (o: any) => o.parent_basis === parent.basis && !HIDDEN_IN_CONFIRM.includes(o.basis)
    );
    if (children.length === 0) continue;
    const avg = weightedAvg(children.map((c: any) => stateById.get(c.id)!).filter(Boolean));
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

  // 2) 다른 조직 값을 그대로 따라가는 조직 (사업총괄대표 ← 사업그룹장)
  for (const rule of MIRROR_RULES) {
    const src = orgs.find((o: any) => o.basis === rule.from);
    const dst = orgs.find((o: any) => o.basis === rule.to);
    if (!src || !dst) continue;
    const srcState = stateById.get(src.id);
    if (!srcState) continue;
    const err = await upsertRate(supabase, {
      quarter: period,
      type: dst.type,
      division: dst.division,
      basis: dst.basis,
      rates: srcState.rate,
      version,
    });
    if (err) problems.push(`${dst.basis}: ${err.message}`);
  }

  // 3) HKR(관계사제외) = 본사 최상위 조직들의 가중평균 → 계열사 제외 재정규화
  const honsa = orgs.filter((o: any) => o.division === "본사" && !o.parent_basis);
  if (honsa.length) {
    const hkr = renormalizeExcludingAffiliates(
      weightedAvg(honsa.map((o: any) => stateById.get(o.id)!).filter(Boolean))
    );
    const err = await upsertRate(supabase, {
      quarter: period,
      type: "리소스배부율",
      division: "본사",
      basis: "HKR(관계사제외)",
      rates: hkr,
      version,
    });
    if (err) problems.push(`HKR(관계사제외): ${err.message}`);
  }

  return problems;
}
