import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { TARGETS, TargetKey } from "@/lib/targets";
import { latestByPerson, latestByPersonAndPeriod, computeRollup, SubmissionRow } from "@/lib/rollup";
import ConfirmReview, { OrgReviewData } from "./ConfirmReview";

export const dynamic = "force-dynamic";

function toRateRecord(row: Record<string, any>): Record<TargetKey, number> {
  return Object.fromEntries(TARGETS.map((t) => [t.key, Number(row[t.key]) || 0])) as Record<TargetKey, number>;
}

export default async function AdminConfirmPage() {
  const supabase = getSupabaseAdmin();

  const { data: settings } = await supabase.from("allocation_settings").select("*").eq("id", 1).single();
  const period = settings?.current_period ?? "";
  const version = settings?.current_version ?? "Forecast";

  const { data: orgs } = await supabase
    .from("allocation_orgs")
    .select("*")
    .eq("active", true)
    .order("division")
    .order("basis");

  const { data: submissions } = await supabase
    .from("allocation_submissions")
    .select("*")
    .eq("period", period)
    .order("submitted_at", { ascending: false });

  // 개인별 리소스 추이(조직별처럼 분기별 이력 전체)를 보여주기 위해 이번 라운드뿐 아니라 전체 기간의 개인별 제출을 가져온다.
  const { data: personSubmissions } = await supabase
    .from("allocation_submissions")
    .select("*")
    .not("person_name", "is", null)
    .order("submitted_at", { ascending: false });

  const { data: rateRows } = await supabase.from("allocation_rate").select("*").order("quarter", { ascending: true });

  const orgList = orgs ?? [];
  const subList = (submissions ?? []) as SubmissionRow[];
  const personSubList = (personSubmissions ?? []) as SubmissionRow[];
  const rates = rateRows ?? [];

  const reviewData: OrgReviewData[] = orgList.map((org) => {
    const orgSubs = subList.filter((s) => s.org_id === org.id);
    const deduped = latestByPerson(orgSubs);
    const orgLevelRow = deduped.find((r) => r.person_name === null) ?? null;
    const personRows = deduped.filter((r) => r.person_name !== null);

    const orgRateRows = rates.filter(
      (r) => r.basis === org.basis && r.division === org.division && r.type === org.type
    );
    const currentRateRow = orgRateRows[orgRateRows.length - 1] ?? null;

    const rollup = computeRollup(orgLevelRow, personRows);
    const hasSubmission = !!orgLevelRow || personRows.length > 0;
    const latestSubmittedAt = deduped.reduce<string | null>((max, r) => {
      if (!max || new Date(r.submitted_at) > new Date(max)) return r.submitted_at;
      return max;
    }, null);
    const submittedBy = orgLevelRow?.submitted_by ?? personRows[0]?.submitted_by ?? null;
    const confirmedThisPeriod = orgRateRows.some((r) => r.quarter === period);

    const orgPersonHistory = latestByPersonAndPeriod(personSubList.filter((s) => s.org_id === org.id))
      .map((p) => ({
        name: p.person_name as string,
        period: p.period as string,
        headcount: p.headcount,
        rates: toRateRecord(p),
        total: Number(p.total) || 0,
        submittedAt: p.submitted_at,
        note: p.note ?? null,
        role: (p.sub_team === "주재원" ? "주재원" : "법인") as "법인" | "주재원",
      }))
      .sort((a, b) => a.period.localeCompare(b.period) || a.name.localeCompare(b.name));

    return {
      org: {
        id: org.id,
        basis: org.basis,
        division: org.division,
        type: org.type,
        requires_person_detail: org.requires_person_detail,
        access_token: org.access_token,
      },
      hasSubmission,
      submittedBy,
      latestSubmittedAt,
      confirmedThisPeriod,
      rollup,
      currentOrgSubmission: orgLevelRow ? toRateRecord(orgLevelRow) : null,
      currentPersons: personRows.map((p) => ({
        name: p.person_name as string,
        headcount: p.headcount,
        rates: toRateRecord(p),
        note: p.note ?? null,
        role: (p.sub_team === "주재원" ? "주재원" : "법인") as "법인" | "주재원",
      })),
      currentRate: currentRateRow ? toRateRecord(currentRateRow) : null,
      currentQuarter: currentRateRow?.quarter ?? null,
      personHistory: orgPersonHistory,
      rateHistory: orgRateRows.map((r) => ({
        quarter: r.quarter as string,
        rates: toRateRecord(r),
        total: Number(r.total) || 0,
      })),
      expat: null,
      children: [],
    };
  });

  // 법인과 주재원은 실무상 하나의 조직으로 관리되므로, '{basis}_주재원' 조직은 별도 선택 항목으로 두지 않고
  // 매칭되는 법인 조직 안에 "주재원" 태그를 붙여 함께 표기한다 (예: HSZ_주재원 -> HSZ 안에 포함).
  const EXPAT_SUFFIX = "_주재원";
  const expatByParentBasis = new Map<string, OrgReviewData>();
  reviewData.forEach((item) => {
    if (item.org.basis.endsWith(EXPAT_SUFFIX)) {
      expatByParentBasis.set(item.org.basis.slice(0, -EXPAT_SUFFIX.length), item);
    }
  });

  // 경영지원실/Staff(CEO)/HR실처럼 여러 하위 조직의 인원수 가중평균으로 계산되는 집계 조직 연결.
  const childrenByParentBasis = new Map<string, OrgReviewData[]>();
  orgList.forEach((org, i) => {
    if (org.parent_basis) {
      const list = childrenByParentBasis.get(org.parent_basis) ?? [];
      list.push(reviewData[i]);
      childrenByParentBasis.set(org.parent_basis, list);
    }
  });

  const finalData = reviewData
    .filter((item) => !item.org.basis.endsWith(EXPAT_SUFFIX))
    .map((item) => ({
      ...item,
      expat: expatByParentBasis.get(item.org.basis) ?? null,
      children: childrenByParentBasis.get(item.org.basis) ?? [],
    }));

  return <ConfirmReview period={period} version={version} data={finalData} />;
}
