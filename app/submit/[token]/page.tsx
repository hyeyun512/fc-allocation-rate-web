import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { TARGETS, TargetKey } from "@/lib/targets";
import { latestByPerson, latestByPersonAndPeriod, latestOrgByPeriod, computeRollup, SubmissionRow } from "@/lib/rollup";
import { mirrorSourceOf, MIRROR_HEADCOUNT } from "@/lib/autoAggregate";
import { leaderFirst } from "@/lib/orgOrder";
import { submitLangOf, orgLabelFor, submitterFor, noteFor } from "@/lib/englishOrgs";
import { submitStrings } from "@/lib/submitLang";
import type { CurrentPerson, PersonHistoryEntry, RateHistoryEntry, PersonRole } from "@/components/RateParts";
import SubmitForm, { SubmitOrgData, SubmitPageData } from "./SubmitForm";

export const dynamic = "force-dynamic";

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
async function getData(token: string) {
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
  const period = settings?.current_period ?? "이번 분기";
  const version = settings?.current_version ?? "Forecast";

  // 집계 조직이면 하위 조직도 같은 화면에서 입력받는다 (링크가 하나뿐이다).
  const { data: childOrgs } = await supabase
    .from("allocation_orgs")
    .select("*")
    .eq("parent_basis", org.basis)
    .eq("active", true);

  const children = childOrgs ?? [];
  const isParent = children.length > 0;
  // 다른 조직 값을 그대로 따라가는 자리(사업총괄대표)는 입력란을 두지 않고 각주로만 알린다 — 관리자 화면과 같다.
  const editableOrgs = isParent ? children.filter((c) => !mirrorSourceOf(c.basis)) : [org];
  const mirroredOrgs = isParent ? children.filter((c) => mirrorSourceOf(c.basis)) : [];

  const orgIds = [org.id, ...children.map((c) => c.id)];
  const basisList = [org.basis, ...children.map((c) => c.basis)];

  // 필요한 조직의 배부율 이력·제출 이력·임시저장을 한 번에 가져와 조직별로 나눈다.
  const [{ data: rateRows }, { data: allSubs }, { data: drafts }] = await Promise.all([
    supabase.from("allocation_rate").select("*").in("basis", basisList).order("quarter", { ascending: true }),
    supabase.from("allocation_submissions").select("*").in("org_id", orgIds).order("submitted_at", { ascending: false }),
    supabase.from("allocation_submission_drafts").select("org_id,payload,updated_at").in("org_id", orgIds).eq("period", period),
  ]);

  const subList = (allSubs ?? []) as SubmissionRow[];

  function buildOrg(o: any): SubmitOrgData {
    // basis만으로 거르면 다른 구분(division)의 동명 조직이 섞일 수 있어 셋 다 맞춘다.
    const orgRates = (rateRows ?? []).filter(
      (r) => r.basis === o.basis && r.division === o.division && r.type === o.type && (Number(r.total) || 0) > 0
    );
    const orgSubs = subList.filter((s) => s.org_id === o.id);
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

    const draft = (drafts ?? []).find((d) => d.org_id === o.id) ?? null;
    const hasAnyValue =
      (orgLevelRow ? Number(orgLevelRow.total) || 0 : 0) > 0 || personRows.some((p) => (Number(p.total) || 0) > 0);

    return {
      orgId: o.id,
      orgBasis: orgLabelFor(o.basis, lang),
      division: o.division,
      requiresPersonDetail: o.requires_person_detail,
      managerName: o.manager_name ?? null,
      submittedThisPeriod: hasAnyValue,
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
      currentRate: orgRates.length > 0 ? toRateRecord(orgRates[orgRates.length - 1]) : null,
      rateHistory,
      personHistory,
      draft: (draft?.payload as any) ?? null,
      draftSavedAt: draft?.updated_at ?? null,
    };
  }

  const orgs = leaderFirst(editableOrgs.map((o) => ({ org: { basis: o.basis }, data: buildOrg(o) }))).map((x) => x.data);

  const data: SubmitPageData = {
    // 집계 조직은 자기가 입력하는 자리가 아니라 하위 조직 값을 모으는 자리다.
    parent: isParent ? buildOrg(org) : null,
    parentChildNames: isParent ? children.map((c) => orgLabelFor(c.basis, lang)) : [],
    mirrors: mirroredOrgs.map((c) => ({
      basis: orgLabelFor(c.basis, lang),
      source: orgLabelFor(mirrorSourceOf(c.basis) as string, lang),
      headcount: MIRROR_HEADCOUNT,
    })),
    orgs,
  };

  return { data, period, version, lang };
}

/** 탭 제목도 링크 언어에 맞춘다 — 루트 레이아웃의 제목은 한국어로 고정돼 있다. */
export async function generateMetadata({ params }: { params: { token: string } }) {
  const { data: org } = await getSupabaseAdmin()
    .from("allocation_orgs")
    .select("basis")
    .eq("access_token", params.token)
    .maybeSingle();
  const s = submitStrings(org ? submitLangOf(org.basis) : "ko");
  return { title: s.pageTitle, description: s.pageDescription };
}

export default async function SubmitPage({ params }: { params: { token: string } }) {
  const result = await getData(params.token);

  if (!result) {
    return (
      <div className="page page-narrow">
        <div className="panel">
          <div className="panel-title">유효하지 않은 링크입니다</div>
          <div className="panel-sub">
            링크 주소를 다시 확인해주시거나, 배부율 담당자에게 문의해주세요.
          </div>
        </div>
      </div>
    );
  }

  return (
    <SubmitForm
      token={params.token}
      period={result.period}
      version={result.version}
      data={result.data}
      lang={result.lang}
    />
  );
}
