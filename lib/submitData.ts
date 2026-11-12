/**
 * 조사 링크 화면 데이터 — 조직 링크(/submit/[token])와 묶음 링크(/submit/multi/[tokens])가 같이 쓴다.
 */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { TARGETS, TargetKey } from "@/lib/targets";
import {
  latestByPerson,
  latestByPersonAndPeriod,
  latestOrgByPeriod,
  computeRollup,
  submissionRateRows,
  hasSubmittedValue,
  SubmissionRow,
} from "@/lib/rollup";
import { mirrorSourceOf, MIRROR_HEADCOUNT, averagedGroupOf, isDerivedOrg, derivedHeadcountOf } from "@/lib/autoAggregate";
import { leaderFirst } from "@/lib/orgOrder";
import { keepsTeamRates } from "@/lib/confirmRate";
import { submitLangOf, orgLabelFor, submitterFor, noteFor } from "@/lib/englishOrgs";
import type { CurrentPerson, PersonHistoryEntry, RateHistoryEntry, PersonRole } from "@/components/RateParts";
import type { SubmitOrgData, SubmitPageData, SubmitRound } from "@/app/submit/[token]/SubmitForm";
import { surveyPeriodsOf, prefillsFromEarlier, linkPeriodsFor } from "@/lib/surveyPeriods";
import { quarterRank } from "@/lib/quarter";
import { isOrgActiveIn } from "@/lib/orgLifespan";

function toRateRecord(row: Record<string, any>): Record<TargetKey, number> {
  return Object.fromEntries(TARGETS.map((t) => [t.key, Number(row[t.key]) || 0])) as Record<TargetKey, number>;
}

/**
 * 조사 링크 화면에 필요한 데이터.
 *
 * 관리자 '검토 및 확정 > 리소스배부율'에서 조직을 선택했을 때와 **같은 화면 구성**을 쓰므로,
 * 그 화면이 쓰는 것과 같은 종류의 데이터(분기별 배부율 이력·개인별 이력·이번 분기 제출값)를 모은다.
 * 집계 조직(개발 그룹 등)은 링크가 하나뿐이므로 그 한 화면에 하위 조직 입력란까지 함께 싣는다.
 *
 * 이 링크는 담당자에게 나가므로 **자기 조직과 그 하위 조직 것만** 조회한다.
 */
export async function getSubmitData(token: string) {
  const supabase = getSupabaseAdmin();

  const { data: org } = await supabase
    .from("allocation_orgs")
    .select("*")
    .eq("access_token", token)
    .eq("active", true)
    .maybeSingle();

  if (!org) return null;

  // 담당자가 현지인이라 화면 전체가 영어여야 하는 조직(HUK 등). 조직명·과거 코멘트를 영어로 바꾸는 일은
  // 여기(서버)에서 끝내고, 화면에는 lang만 넘긴다 — 다른 조직 이름이 링크 번들에 섞이지 않게 하기 위함이다.
  const lang = submitLangOf(org.basis);

  const { data: settings } = await supabase.from("allocation_settings").select("*").eq("id", 1).single();
  // 링크에 여는 기간 — 26년 4Q와 27년 BP처럼 둘 이상이면 화면에 기간별 탭이 생긴다.
  // 해외법인·주재원 링크는 27년 BP를 받지 않는다 — BP는 관리자가 검토 화면에서 입력한다.
  const periods = linkPeriodsFor(org.division, surveyPeriodsOf(settings));
  if (periods.length === 0) periods.push("이번 분기");
  const version = settings?.current_version ?? "Forecast";

  // 집계 조직이면 하위 조직도 같은 화면에서 입력받는다 (링크가 하나뿐이다).
  const { data: childOrgs } = await supabase
    .from("allocation_orgs")
    .select("*")
    .eq("parent_basis", org.basis)
    .eq("active", true);

  // 하위 조직 안내 문구·입력란 모두 같은 순서로 보이도록 처음부터 정렬해 둔다 (IT사업부 팀 순서 고정).
  // 이번 라운드 기간 어디에도 없는 하위 조직(예: 4Q에 폐쇄된 Staff(개발))은 링크에 싣지 않는다.
  // 기간마다 따로 거르지 않는 건, 입력 화면이 라운드의 기간들에 같은 조직 목록을 쓰기 때문이다.
  const children = leaderFirst(
    (childOrgs ?? []).filter((o) => periods.some((p) => isOrgActiveIn(o.basis, p))).map((o) => ({ org: o }))
  ).map((x) => x.org);
  const isParent = children.length > 0;
  // 다른 조직 값을 그대로 따라가는 자리(사업총괄대표)는 입력란을 두지 않고 각주로만 알린다 — 관리자 화면과 같다.
  // 그룹 평균 자리(IT사업대표·Staff(IT))도 미러처럼 입력란을 두지 않는다 — 나머지 팀 평균으로 자동 계산된다.
  const editableOrgs = isParent ? children.filter((c) => !isDerivedOrg(c.basis)) : [org];
  const averagedOrgs = isParent ? children.filter((c) => averagedGroupOf(c.basis)) : [];
  const mirroredOrgs = isParent ? children.filter((c) => mirrorSourceOf(c.basis)) : [];

  const orgIds = [org.id, ...children.map((c) => c.id)];
  const basisList = [org.basis, ...children.map((c) => c.basis)];

  // 필요한 조직의 배부율 이력·제출 이력·임시저장을 한 번에 가져와 조직별로 나눈다.
  const [{ data: rateRows }, { data: allSubs }, { data: drafts }, { data: unlocks }] = await Promise.all([
    supabase.from("allocation_rate").select("*").in("basis", basisList).order("quarter", { ascending: true }),
    supabase.from("allocation_submissions").select("*").in("org_id", orgIds).order("submitted_at", { ascending: false }),
    supabase.from("allocation_submission_drafts").select("org_id,period,payload,updated_at").in("org_id", orgIds).in("period", periods),
    // 관리자가 '수정 허용'을 눌러 열어준 조직 — 이 표식이 있어야 다시 제출할 수 있다.
    supabase.from("allocation_submit_unlocks").select("org_id,period").in("org_id", orgIds).in("period", periods),
  ]);

  const subList = (allSubs ?? []) as SubmissionRow[];

  function buildOrg(o: any, period: string): SubmitOrgData {
    // basis만으로 거르면 다른 구분(division)의 동명 조직이 섞일 수 있어 셋 다 맞춘다.
    const tableRates = (rateRows ?? []).filter(
      (r) => r.basis === o.basis && r.division === o.division && r.type === o.type && (Number(r.total) || 0) > 0
    );
    const orgSubs = subList.filter((s) => s.org_id === o.id);
    // 하위 팀은 3Q부터 배부율 표에 행이 없다 — 지난 분기 값은 제출 이력으로 채운다 (관리자 검토 화면과 같다).
    const isUnlistedChild = !!o.parent_basis && !keepsTeamRates(o.parent_basis);
    const orgRates: any[] = isUnlistedChild
      ? [
          ...tableRates,
          ...submissionRateRows(orgSubs, new Set([...tableRates.map((r) => String(r.quarter)), ...periods])),
        ].sort((a, b) => String(a.quarter).localeCompare(String(b.quarter)))
      : tableRates;
    const deduped = latestByPerson(orgSubs.filter((s) => s.period === period));
    const orgLevelRow = deduped.find((r) => r.person_name === null) ?? null;
    // 이름 가나다순이 아니라 입력(저장)한 순서대로 (한 번에 insert되므로 id 오름차순이 곧 입력 순서).
    const personRows = deduped.filter((r) => r.person_name !== null).sort((a, b) => a.id - b.id);

    const orgLevelByPeriod = new Map<string, SubmissionRow>();
    latestOrgByPeriod(orgSubs).forEach((r) => orgLevelByPeriod.set(r.period as string, r));

    const rateHistory: RateHistoryEntry[] = orgRates.map((r) => ({
      quarter: r.quarter as string,
      rates: toRateRecord(r),
      total: Number(r.total) || 0,
      headcount: orgLevelByPeriod.get(r.quarter as string)?.headcount ?? null,
      note: noteFor(
        orgLevelByPeriod.get(r.quarter as string)?.note,
        orgLevelByPeriod.get(r.quarter as string)?.note_en,
        lang
      ),
    }));

    const personHistory: PersonHistoryEntry[] = latestByPersonAndPeriod(orgSubs)
      .sort((a, b) => a.period.localeCompare(b.period) || a.id - b.id)
      .map((p) => ({
        name: p.person_name as string,
        period: p.period as string,
        headcount: p.headcount,
        rates: toRateRecord(p),
        total: Number(p.total) || 0,
        submittedAt: p.submitted_at,
        note: noteFor(p.note, p.note_en, lang),
        role: (p.sub_team === "주재원" ? "주재원" : "법인") as PersonRole,
      }));

    // 임시저장본은 마지막 제출(관리자가 검토 화면에서 저장한 것 포함)보다 나중 것만 쓴다.
    // 제출 직후 늦게 도착한 자동 임시저장본이 남아, 관리자가 고친 값 대신 예전 입력이 링크에 보인 적이 있다
    // (업무지원팀 27년 BP — 제출 00:50:05, 늦은 임시저장 00:50:07, 관리자 저장 01:37).
    const latestSubmitAt = orgSubs
      .filter((s) => s.period === period)
      .reduce((m, s) => Math.max(m, new Date(s.submitted_at).getTime() || 0), 0);
    const rawDraft = (drafts ?? []).find((d) => d.org_id === o.id && d.period === period) ?? null;
    const draft = rawDraft && new Date(rawDraft.updated_at).getTime() > latestSubmitAt ? rawDraft : null;
    // 제출 라우트와 같은 함수를 쓴다 — 다르면 화면은 입력을 받고 서버는 거절하는 상태가 된다.
    const hasAnyValue = hasSubmittedValue(orgSubs.filter((s) => s.period === period));

    return {
      orgId: o.id,
      orgBasis: orgLabelFor(o.basis, lang),
      division: o.division,
      requiresPersonDetail: o.requires_person_detail,
      managerName: o.manager_name ?? null,
      submittedThisPeriod: hasAnyValue,
      // 제출 후에는 잠긴다. 관리자가 열어준 조직만 다시 제출할 수 있다.
      editAllowed: (unlocks ?? []).some((u: any) => u.org_id === o.id && u.period === period),
      submittedBy: submitterFor(orgLevelRow?.submitted_by ?? personRows[0]?.submitted_by, lang),
      latestSubmittedAt: deduped.reduce<string | null>((max, r) => {
        if (!max || new Date(r.submitted_at) > new Date(max)) return r.submitted_at;
        return max;
      }, null),
      rollup: computeRollup(orgLevelRow, personRows),
      currentOrgSubmission: orgLevelRow ? toRateRecord(orgLevelRow) : null,
      submittedHeadcount: orgLevelRow?.headcount ?? null,
      submittedNote: noteFor(orgLevelRow?.note, orgLevelRow?.note_en, lang),
      currentPersons: personRows.map<CurrentPerson>((p) => ({
        name: p.person_name as string,
        headcount: p.headcount,
        rates: toRateRecord(p),
        note: noteFor(p.note, p.note_en, lang),
        role: (p.sub_team === "주재원" ? "주재원" : "법인") as PersonRole,
      })),
      // 미리 채울 값: 그 기간 자기 행, 없으면 그보다 앞선 기간 중 가장 최근 행.
      // 뒤 기간 값을 쓰면 안 된다 — 27년 BP를 먼저 확정하면 4Q 칸에 BP 값이 채워졌다.
      currentRate: (() => {
        const own = orgRates.find((r) => r.quarter === period);
        if (own) return toRateRecord(own);
        // 27년 BP 같은 예산 기간은 빈칸에서 시작한다 — 앞선 기간 값으로 채우지 않는다.
        if (!prefillsFromEarlier(period)) return null;
        const rank = quarterRank(period);
        const earlier = orgRates
          .filter((r) => quarterRank(r.quarter as string) >= 0 && quarterRank(r.quarter as string) < rank)
          .sort((a, b) => quarterRank(a.quarter as string) - quarterRank(b.quarter as string));
        return earlier.length > 0 ? toRateRecord(earlier[earlier.length - 1]) : null;
      })(),
      rateHistory,
      personHistory,
      draft: (draft?.payload as any) ?? null,
      draftSavedAt: draft?.updated_at ?? null,
    };
  }

  function buildRound(period: string): SubmitRound {
    const orgs = leaderFirst(editableOrgs.map((o) => ({ org: { basis: o.basis }, data: buildOrg(o, period) }))).map((x) => x.data);
    const data: SubmitPageData = {
      // 집계 조직은 자기가 입력하는 자리가 아니라 하위 조직 값을 모으는 자리다.
      parent: isParent ? buildOrg(org, period) : null,
      parentChildNames: isParent ? children.map((c) => orgLabelFor(c.basis, lang)) : [],
      mirrors: mirroredOrgs.map((c) => ({
        basis: orgLabelFor(c.basis, lang),
        source: orgLabelFor(mirrorSourceOf(c.basis) as string, lang),
        headcount: MIRROR_HEADCOUNT,
      })),
      // 자동 계산된 값(서버가 allocation_rate에 남긴 그 기간 행)을 읽기 전용으로 보여준다. 아직 아무 팀도 입력하지 않았으면 null.
      averaged: averagedOrgs.map((c) => {
        const row = (rateRows ?? []).find(
          (r) => r.basis === c.basis && r.division === c.division && r.type === c.type && r.quarter === period && (Number(r.total) || 0) > 0
        );
        return {
          basis: orgLabelFor(c.basis, lang),
          headcount: derivedHeadcountOf(c.basis),
          rates: row ? (toRateRecord(row) as Record<TargetKey, number>) : null,
        };
      }),
      averageSources: editableOrgs.map((c) => orgLabelFor(c.basis, lang)),
      orgs,
    };
    return { period, data };
  }

  return { rounds: periods.map(buildRound), version, lang };
}

