import { TARGETS, TargetKey, sumTargets, normalizeTargets, stripInactiveTargets, toDbTargets } from "./targets";
import { latestByPerson, computeRollup, countedPersonRows, SubmissionRow } from "./rollup";
import { ensureFixedRates } from "./fixedRates";
import { isOrgActiveIn } from "./orgLifespan";
import { keepsTeamRates } from "./confirmRate";
import {
  EVCS_AVERAGE_ORGS,
  EvcsAverage,
  usesBuildingBasis,
  computeBuildingRates,
  buildingInputFromPayload,
  BUILDING_TYPE,
} from "./selfuseBasis";

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
export const HIDDEN_IN_CONFIRM: string[] = [];

/** 미러 조직은 한 사람이 앉는 자리라 인원수를 항상 1명으로 센다. */
export const MIRROR_HEADCOUNT = 1;

/** basis가 다른 조직 값을 따라가는 자리라면 그 원본 조직명을 돌려준다. */
export function mirrorSourceOf(basis: string): string | null {
  return MIRROR_RULES.find((r) => r.to === basis)?.from ?? null;
}

/**
 * 값을 직접 입력받지 않고 같은 그룹의 나머지 팀 평균을 쓰는 조직 (26년 4Q~, 사용자 지시).
 * IT사업대표·Staff(IT)는 IT사업부의 다른 팀들의 **인원수 가중평균**으로 자동 계산한다 — 링크·검토 화면에 입력칸이 없다.
 * 이 자리 자신의 인원수는 입력받지 않으므로 AVERAGED_HEADCOUNT로 정해 둔다(그룹·HKR 가중치에만 쓰인다).
 */
export const AVERAGE_RULES: { group: string; to: string[] }[] = [{ group: "IT사업부", to: ["IT사업대표", "Staff(IT)"] }];
export const AVERAGED_HEADCOUNT: Record<string, number> = { IT사업대표: 1, "Staff(IT)": 1 };

/** basis가 그룹 평균을 쓰는 자리라면 그 그룹(상위 조직)명을 돌려준다. */
export function averagedGroupOf(basis: string): string | null {
  return AVERAGE_RULES.find((r) => r.to.includes(basis))?.group ?? null;
}

/** 입력받지 않고 자동으로 값이 정해지는 자리(미러·그룹 평균)인지. */
// 미러 자리와 그룹 평균 자리는 입력받지 않으므로 조사 대상 목록(조사 탭·링크 수신인)에서도 뺀다.
HIDDEN_IN_CONFIRM.push(...MIRROR_RULES.map((r) => r.to), ...AVERAGE_RULES.flatMap((r) => r.to));

export function isDerivedOrg(basis: string): boolean {
  return !!mirrorSourceOf(basis) || !!averagedGroupOf(basis);
}

/** 자동 계산 자리의 인원수 (미러는 1명, 그룹 평균 자리는 AVERAGED_HEADCOUNT). */
export function derivedHeadcountOf(basis: string): number {
  return mirrorSourceOf(basis) ? MIRROR_HEADCOUNT : AVERAGED_HEADCOUNT[basis] ?? 1;
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

// 하위 조직 값이 100%에서 미세하게 벗어나 있으면 가중평균도 그만큼 벗어난다 — 합계를 100%로 맞춰 돌려준다.
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
  return normalizeTargets(r) as Rec;
}

/** 본사 가중평균에서 계열사 배부분을 빼고 나머지로 재정규화 (HKR). */
function renormalizeExcludingAffiliates(avg: Rec): Rec {
  const humaxOnly = zeroRec();
  TARGETS.forEach((t) => {
    humaxOnly[t.key] = AFFILIATE_KEYS.includes(t.key) ? 0 : avg[t.key] || 0;
  });
  // 계열사 몫을 0으로 두고 남은 항목만 100%로 다시 맞추는 것이 곧 '계열사 제외 재정규화'다.
  return normalizeTargets(humaxOnly) as Rec;
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
  // 그 분기에 배부하지 않는 대상(예: 2026-Q4부터 홀딩스)은 근거 값에 남아 있어도 싣지 않는다.
  const source = stripInactiveTargets(row.rates, row.quarter);
  if (sumTargets(source) <= 0) return deleteRate(supabase, row);

  // 저장 직전에 한 번 더 100%로 맞춘다 — 어느 경로로 불려도 저장값의 합계는 항상 100%다.
  const rates = normalizeTargets(source);

  const { error } = await supabase.from("allocation_rate").upsert(
    {
      quarter: row.quarter,
      type: row.type,
      division: row.division,
      basis: row.basis,
      ...toDbTargets(rates, row.quarter),
      total: sumTargets(rates),
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
export async function recomputeAggregates(supabase: any, period: string, version?: string): Promise<string[]> {
  return (await runAggregates(supabase, period, version, true)).problems;
}

/**
 * EVCS리소스평균 — EVCS_AVERAGE_ORGS 다섯 조직의 인원수 가중평균에서 EVCS(국내)·EVCS(해외)만 떼어
 * 둘의 합이 1이 되게 맞춘다. 아무도 입력하지 않았거나 EVCS 몫이 0이면 null.
 * 상위 조직(사업 그룹·개발 그룹)은 하위 팀 가중평균과 인원 합계로 들어간다 — 재계산과 같은 계산을 쓰되 저장하지 않는다.
 */
export async function evcsResourceAverage(supabase: any, period: string): Promise<EvcsAverage | null> {
  const { orgs, stateById } = await runAggregates(supabase, period, undefined, false);
  return evcsAverageFromStates(orgs, stateById);
}

function evcsAverageFromStates(orgs: any[], stateById: Map<number, OrgState>): EvcsAverage | null {
  const states = EVCS_AVERAGE_ORGS.map((b) => orgs.find((o: any) => o.basis === b))
    .map((o: any) => (o ? stateById.get(o.id) : undefined))
    .filter((st): st is OrgState => !!st && st.hasSubmission);
  if (states.length === 0) return null;
  const avg = weightedAvg(states);
  const sum = (avg.evcs_domestic || 0) + (avg.evcs_overseas || 0);
  if (sum <= 0) return null;
  return { domestic: (avg.evcs_domestic || 0) / sum, overseas: (avg.evcs_overseas || 0) / sum };
}

async function runAggregates(
  supabase: any,
  period: string,
  version: string | undefined,
  write: boolean
): Promise<{ problems: string[]; orgs: any[]; stateById: Map<number, OrgState> }> {
  const problems: string[] = [];

  // 저장이 느렸다(사용자 지적) — DB 쓰기를 하나씩 기다리지 않고 모아 두었다가 한꺼번에 보낸다.
  // 쓰는 행(분기·유형·구분·기준)이 서로 겹치지 않으므로 순서가 결과에 영향을 주지 않는다.
  // write=false(계산만)면 아무것도 쓰지 않는다 — 그래서 쓰기는 미리 시작하지 않고 함수로 받는다.
  const pending: Promise<void>[] = [];
  const track = (label: string, run: () => Promise<any>) => {
    if (!write) return;
    pending.push(
      run().then((err) => {
        if (err) problems.push(`${label}: ${err.message}`);
      })
    );
  };

  // 고정비율은 조사로 받는 값이 아니라 정의상 고정된 비율이라 분기마다 그대로 복제한다.
  // 아래 계산은 고정비율 행을 읽지 않으므로 조회와 동시에 돌린다.
  const [fixedProblems, { data: allOrgs }, { data: subs }, { data: rateRows }] = await Promise.all([
    write ? ensureFixedRates(supabase, period) : Promise.resolve([] as string[]),
    supabase.from("allocation_orgs").select("*").eq("active", true),
    supabase.from("allocation_submissions").select("*").eq("period", period).order("submitted_at", { ascending: false }),
    // 이번 분기 행만 쓴다 (buildOrgState는 r.quarter === period만 본다).
    supabase.from("allocation_rate").select("*").eq("quarter", period),
  ]);
  problems.push(...fixedProblems);
  if (!allOrgs?.length) return { problems, orgs: [], stateById: new Map() };

  // 그 분기에 존재하지 않았던 조직은 계산에서 빼고, 남아 있던 배부율 행도 지운다.
  const orgs = allOrgs.filter((o: any) => isOrgActiveIn(o.basis, period));
  for (const o of allOrgs.filter((o: any) => !isOrgActiveIn(o.basis, period))) {
    track(`${o.basis} 정리`, () => deleteRate(supabase, { quarter: period, type: o.type, division: o.division, basis: o.basis })
    );
  }

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

  // 그룹 평균 자리(IT사업대표·Staff(IT))는 같은 그룹의 나머지 팀 인원수 가중평균을 쓴다.
  // 그룹 평균(아래 1단계)보다 먼저 정해 두어야 그룹 값 계산에 이 자리도 들어간다.
  for (const rule of AVERAGE_RULES) {
    const sources = orgs.filter((o: any) => o.parent_basis === rule.group && !rule.to.includes(o.basis));
    const srcStates: OrgState[] = sources.map((o: any) => stateById.get(o.id)!).filter(Boolean);
    const any = srcStates.some((s) => s.hasSubmission);
    for (const basis of rule.to) {
      const dst = orgs.find((o: any) => o.basis === basis);
      if (!dst) continue;
      stateById.set(dst.id, {
        rate: any ? weightedAvg(srcStates.filter((s) => s.hasSubmission)) : zeroRec(),
        weight: AVERAGED_HEADCOUNT[basis] ?? 1,
        hasSubmission: any,
      });
    }
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
  //
  // 깊은 조직부터 계산해야 한다. 상위의 상위(HKR ← 사업 그룹 ← 사업그룹장)가 있을 때 순서가 뒤집히면
  // 상위가 갱신 전 값으로 계산된다. 계산한 값은 stateById에 되돌려 넣어 그 다음 계산이 최신값을 쓰게 한다.
  const childrenOf = (o: any) => orgs.filter((x: any) => x.parent_basis === o.basis);
  const depthOf = (o: any): number => {
    const ch = childrenOf(o);
    return ch.length === 0 ? 0 : 1 + Math.max(...ch.map(depthOf));
  };
  const parentsByDepth = orgs.filter((o: any) => childrenOf(o).length > 0).sort((a: any, b: any) => depthOf(a) - depthOf(b));

  for (const parent of parentsByDepth) {
    const children = childrenOf(parent);
    const childStates: OrgState[] = children.map((c: any) => stateById.get(c.id)!).filter(Boolean);
    // 이번 분기에 아무 하위 조직도 입력하지 않았으면 계산할 근거가 없다 —
    // 남아 있던 행이 있으면 지운다 (입력한 적 없는 분기가 목록에 남지 않도록).
    if (!childStates.some((s) => s.hasSubmission)) {
      track(parent.basis, () => deleteRate(supabase, { quarter: period, type: parent.type, division: parent.division, basis: parent.basis })
      );
      continue;
    }
    const avg = weightedAvg(childStates);
    // 방금 계산한 값을 상태에 반영해, 이 조직을 하위로 두는 상위 조직·HKR이 최신값으로 계산되게 한다.
    const own = stateById.get(parent.id);
    if (own) stateById.set(parent.id, { ...own, rate: avg, hasSubmission: true });

    track(parent.basis, () => upsertRate(supabase, {
        quarter: period,
        type: parent.type,
        division: parent.division,
        basis: parent.basis,
        rates: avg,
        version,
      })
    );
  }

  // 2-0) 그룹 평균 자리의 배부율을 기록 — 팀마다 배부율을 남기는 그룹(IT사업부)이라 View에도 팀으로 보인다.
  //      아직 아무 팀도 입력하지 않았으면 남아 있던 행을 지운다.
  for (const rule of AVERAGE_RULES) {
    for (const basis of rule.to) {
      const dst = orgs.find((o: any) => o.basis === basis);
      const st = dst ? stateById.get(dst.id) : null;
      if (!dst) continue;
      const key = { quarter: period, type: dst.type, division: dst.division, basis: dst.basis };
      if (!st?.hasSubmission || !keepsTeamRates(rule.group)) {
        track(basis, () => deleteRate(supabase, key));
        continue;
      }
      track(basis, () => upsertRate(supabase, { ...key, rates: st.rate, version }));
    }
  }

  // 2) 다른 조직 값을 그대로 따라가는 조직의 배부율을 기록 (사업총괄대표 ← 사업그룹장)
  for (const rule of MIRROR_RULES) {
    const dst = orgs.find((o: any) => o.basis === rule.to);
    const dstState = dst ? stateById.get(dst.id) : null;
    // 원본 조직이 이번 분기에 입력하지 않았으면 복사할 값이 없다
    // (지난 분기 확정값이 이번 분기 값으로 둔갑하는 걸 막는다). 남아 있던 행은 지운다.
    if (!dst) continue;
    if (!dstState?.hasSubmission) {
      track(dst.basis, () => deleteRate(supabase, { quarter: period, type: dst.type, division: dst.division, basis: dst.basis }));
      continue;
    }
    track(dst.basis, () => upsertRate(supabase, {
        quarter: period,
        type: dst.type,
        division: dst.division,
        basis: dst.basis,
        rates: dstState.rate,
        version,
      })
    );
  }

  // 3) HKR(관계사제외) = 본사 최상위 조직들의 가중평균 → 계열사 제외 재정규화
  const honsa = orgs.filter((o: any) => o.division === "본사" && !o.parent_basis);
  const honsaStates: OrgState[] = honsa.map((o: any) => stateById.get(o.id)!).filter(Boolean);
  // 상위 집계 조직과 같은 기준 — 이번 분기에 입력한 본사 조직이 하나도 없으면 기록하지 않고,
  // 남아 있던 행이 있으면 지운다 (입력한 적 없는 분기가 목록에 남지 않도록).
  const hkrKey = { quarter: period, type: "리소스배부율", division: "본사", basis: "HKR(관계사제외)" };
  if (honsaStates.some((s) => s.hasSubmission)) {
    const hkr = renormalizeExcludingAffiliates(weightedAvg(honsaStates));
    track("HKR(관계사제외)", () => upsertRate(supabase, { ...hkrKey, rates: hkr, version }));
  } else {
    track("HKR(관계사제외) 정리", () => deleteRate(supabase, hkrKey));
  }

  // 4) 건물(분당) — EVCS 몫을 EVCS리소스평균으로 나누므로, 그 다섯 조직 값이 바뀌면 함께 다시 계산한다.
  //    그 기간 건물 기준정보가 저장돼 있을 때만 (아직 입력 전이면 만들 것이 없다).
  if (write && usesBuildingBasis(period)) {
    const { data: basis } = await supabase
      .from("allocation_basis_inputs")
      .select("payload")
      .eq("quarter", period)
      .eq("category", "selfuse")
      .maybeSingle();
    const avg = evcsAverageFromStates(orgs, stateById);
    if (basis?.payload && avg) {
      const bundang = computeBuildingRates(buildingInputFromPayload(basis.payload, avg))[0];
      track("건물(분당)", () =>
        upsertRate(supabase, {
          quarter: period,
          type: BUILDING_TYPE,
          division: bundang.division,
          basis: bundang.basis,
          rates: { ...zeroRec(), ...bundang.rates } as Rec,
          version,
        })
      );
      track("건물 기준정보(EVCS리소스평균)", async () => {
        const { error } = await supabase
          .from("allocation_basis_inputs")
          .update({ payload: { ...basis.payload, evcs_avg_domestic: avg.domestic, evcs_avg_overseas: avg.overseas } })
          .eq("quarter", period)
          .eq("category", "selfuse");
        return error;
      });
    }
  }

  await Promise.all(pending);
  return { problems, orgs, stateById };
}
