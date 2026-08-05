import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { TARGETS, TargetKey } from "@/lib/targets";
import { latestByPerson, latestByPersonAndPeriod, computeRollup, SubmissionRow } from "@/lib/rollup";
import { OrgReviewData } from "./ConfirmReview";
import { SurveyOrgData } from "../SurveyOverview";
import ConfirmTabs from "./ConfirmTabs";

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

  // HKR(관계사 제외)은 별도 설문 조직이 아니라 다른 본사 조직 값에서 자동계산되며,
  // allocation_rate(운영)에서 basis="HKR(관계사제외)"로 직접 이력을 조회/기록한다.
  const { data: hkrRows } = await supabase
    .from("allocation_rate")
    .select("*")
    .eq("division", "본사")
    .eq("basis", "HKR(관계사제외)")
    .order("quarter", { ascending: true });

  // IT탭/자가사용(건물)탭 기준정보 — 전체 분기 이력을 가져와 과거 데이터 열람 + 현재 라운드 프리필에 함께 사용한다.
  // allocation_it_basis/allocation_selfuse_basis를 allocation_basis_inputs(category로 구분)로 통합했으므로
  // 여기서 category별로 걸러 UI가 기대하는 기존 컬럼 형태로 되돌려준다.
  const { data: basisInputRows } = await supabase
    .from("allocation_basis_inputs")
    .select("*")
    .order("quarter", { ascending: true });

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
        parent_basis: org.parent_basis ?? null,
      },
      hasSubmission,
      submittedBy,
      latestSubmittedAt,
      confirmedThisPeriod,
      rollup,
      currentOrgSubmission: orgLevelRow ? toRateRecord(orgLevelRow) : null,
      submittedHeadcount: orgLevelRow?.headcount ?? null,
      submittedNote: orgLevelRow?.note ?? null,
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

  // 배부율조사 로직 정의(엑셀) 기준: 법인과 주재원은 '1차. 조직 표기'에 각각 별도 행으로 존재하는
  // 독립된 조직이며 구분하여 조사한다. 더 이상 '{basis}_주재원'을 법인 조직 안에 묶어 넣지 않고
  // 그대로 독립된 조직으로 노출한다 (예: HSZ와 HSZ_주재원은 각각 별도로 선택/확정).
  const childrenByParentBasis = new Map<string, OrgReviewData[]>();
  orgList.forEach((org, i) => {
    if (org.parent_basis) {
      const list = childrenByParentBasis.get(org.parent_basis) ?? [];
      list.push(reviewData[i]);
      childrenByParentBasis.set(org.parent_basis, list);
    }
  });

  const finalData = reviewData.map((item) => ({
    ...item,
    children: childrenByParentBasis.get(item.org.basis) ?? [],
  }));

  const hkrHistory = (hkrRows ?? []).map((r) => ({
    quarter: r.quarter as string,
    rates: toRateRecord(r),
    total: Number(r.total) || 0,
  }));
  const hkrConfirmedThisPeriod = hkrHistory.some((h) => h.quarter === period);

  interface ItBasisPayload {
    headquarters: number;
    overseas_corp: number;
    h_mobility: number;
    h_ev: number;
    hiparking: number;
    peoplecar: number;
    winercom: number;
    holdings: number;
    hiparking_resident: number | null;
  }
  interface SelfuseBasisPayload {
    bundang_selfuse_ratio: number;
    yongin_selfuse_ratio: number;
    biz_dev_media_headcount: number;
    staff_headcount: number;
    hq_total_headcount: number;
    material_evcs_domestic_ratio: number;
    material_evcs_overseas_ratio: number;
  }

  const basisInputs = basisInputRows ?? [];
  const itHistory = basisInputs
    .filter((r) => r.category === "it_headcount" || r.category === "it_sap")
    .map((r) => {
      const p = r.payload as ItBasisPayload;
      return {
        quarter: r.quarter as string,
        metric: (r.category === "it_headcount" ? "인원수" : "SAP ID 개수") as "인원수" | "SAP ID 개수",
        headquarters: p.headquarters,
        overseas_corp: p.overseas_corp,
        h_mobility: p.h_mobility,
        h_ev: p.h_ev,
        hiparking: p.hiparking,
        peoplecar: p.peoplecar,
        winercom: p.winercom,
        holdings: p.holdings,
        hiparking_resident: p.hiparking_resident,
        submitted_by: r.submitted_by ?? null,
        confirmed_at: r.confirmed_at ?? null,
      };
    });
  const itHeadcount = itHistory.find((r) => r.quarter === period && r.metric === "인원수") ?? null;
  const itSap = itHistory.find((r) => r.quarter === period && r.metric === "SAP ID 개수") ?? null;

  const selfuseHistory = basisInputs
    .filter((r) => r.category === "selfuse")
    .map((r) => {
      const p = r.payload as SelfuseBasisPayload;
      return {
        quarter: r.quarter as string,
        bundang_selfuse_ratio: p.bundang_selfuse_ratio,
        yongin_selfuse_ratio: p.yongin_selfuse_ratio,
        biz_dev_media_headcount: p.biz_dev_media_headcount,
        staff_headcount: p.staff_headcount,
        hq_total_headcount: p.hq_total_headcount,
        material_evcs_domestic_ratio: p.material_evcs_domestic_ratio,
        material_evcs_overseas_ratio: p.material_evcs_overseas_ratio,
        submitted_by: r.submitted_by ?? null,
        confirmed_at: r.confirmed_at ?? null,
      };
    });
  const selfuse = selfuseHistory.find((r) => r.quarter === period) ?? null;

  // '조사' 탭 데이터 — 이미 불러온 orgList/subList를 그대로 재사용한다.
  const surveyData: SurveyOrgData[] = orgList.map((org) => {
    const orgSubs = subList.filter((s) => s.org_id === org.id);
    const deduped = latestByPerson(orgSubs);
    const hasSubmission = deduped.length > 0;
    const latestSubmittedAt = deduped.reduce<string | null>((max, r) => {
      if (!max || new Date(r.submitted_at) > new Date(max)) return r.submitted_at;
      return max;
    }, null);
    const submittedBy = deduped.find((r) => r.person_name === null)?.submitted_by ?? deduped[0]?.submitted_by ?? null;
    const personCount = deduped.filter((r) => r.person_name !== null).length;

    return {
      org: {
        id: org.id,
        basis: org.basis,
        division: org.division,
        requires_person_detail: org.requires_person_detail,
        access_token: org.access_token,
      },
      hasSubmission,
      submittedBy,
      latestSubmittedAt,
      personCount,
    };
  });

  return (
    <ConfirmTabs
      period={period}
      version={version}
      surveyData={surveyData}
      resourceData={finalData}
      hkrHistory={hkrHistory}
      hkrConfirmedThisPeriod={hkrConfirmedThisPeriod}
      itHeadcount={itHeadcount}
      itSap={itSap}
      itHistory={itHistory}
      selfuse={selfuse}
      selfuseHistory={selfuseHistory}
    />
  );
}
