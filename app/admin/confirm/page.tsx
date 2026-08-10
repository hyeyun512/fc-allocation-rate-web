import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { TARGETS, TargetKey } from "@/lib/targets";
import { latestByPerson, latestByPersonAndPeriod, latestOrgByPeriod, computeRollup, SubmissionRow } from "@/lib/rollup";
import { HIDDEN_IN_CONFIRM } from "@/lib/autoAggregate";
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

  // 개인별 확인이 필요없는 조직(조직 단위 제출, person_name이 null)도 분기별 인원수·코멘트 이력을
  // 보여주기 위해 전체 기간을 가져온다.
  const { data: orgLevelSubmissions } = await supabase
    .from("allocation_submissions")
    .select("*")
    .is("person_name", null)
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

  const orgLevelHistoryMap = new Map<string, SubmissionRow>();
  latestOrgByPeriod((orgLevelSubmissions ?? []) as SubmissionRow[]).forEach((r) => {
    orgLevelHistoryMap.set(`${r.org_id}__${r.period}`, r);
  });

  const reviewData: OrgReviewData[] = orgList.map((org) => {
    const orgSubs = subList.filter((s) => s.org_id === org.id);
    const deduped = latestByPerson(orgSubs);
    const orgLevelRow = deduped.find((r) => r.person_name === null) ?? null;
    // 이름 가나다순이 아니라 입력(저장)한 순서대로 보여준다.
    // 확정 시 폼에 있던 순서 그대로 한 번에 insert되므로 id 오름차순이 곧 입력 순서다.
    const personRows = deduped
      .filter((r) => r.person_name !== null)
      .sort((a, b) => a.id - b.id);

    // 전 항목이 0%인 행은 '값을 지우고 저장한' 흔적이지 실제 배부율이 아니다.
    // (upsert라 행을 지울 수 없어 0으로 덮어쓴다.) 이력·현재값 어디에도 노출하지 않는다.
    const orgRateRows = rates.filter(
      (r) =>
        r.basis === org.basis &&
        r.division === org.division &&
        r.type === org.type &&
        (Number(r.total) || 0) > 0
    );
    const currentRateRow = orgRateRows[orgRateRows.length - 1] ?? null;

    const rollup = computeRollup(orgLevelRow, personRows);
    // 값이 전부 0인 저장(행을 모두 지웠거나 배부율이 0%)은 제출로 보지 않는다.
    const hasAnyValue =
      (orgLevelRow ? Number(orgLevelRow.total) || 0 : 0) > 0 ||
      personRows.some((p) => (Number(p.total) || 0) > 0);
    const hasSubmission = hasAnyValue;
    const latestSubmittedAt = deduped.reduce<string | null>((max, r) => {
      if (!max || new Date(r.submitted_at) > new Date(max)) return r.submitted_at;
      return max;
    }, null);
    const submittedBy = orgLevelRow?.submitted_by ?? personRows[0]?.submitted_by ?? null;
    // 확정도 값이 있어야 확정으로 본다 (0%만 저장된 건 확정 표기하지 않는다).
    const confirmedThisPeriod = orgRateRows.some((r) => r.quarter === period && (Number(r.total) || 0) > 0);

    const orgPersonHistory = latestByPersonAndPeriod(personSubList.filter((s) => s.org_id === org.id))
      // 분기 순으로 묶되, 같은 분기 안에서는 이름순이 아니라 입력한 순서(id)를 유지한다.
      .sort((a, b) => a.period.localeCompare(b.period) || a.id - b.id)
      .map((p) => ({
        name: p.person_name as string,
        period: p.period as string,
        headcount: p.headcount,
        rates: toRateRecord(p),
        total: Number(p.total) || 0,
        submittedAt: p.submitted_at,
        note: p.note ?? null,
        role: (p.sub_team === "주재원" ? "주재원" : "법인") as "법인" | "주재원",
      }));

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
      rateHistory: orgRateRows.map((r) => {
        const orgSubRow = orgLevelHistoryMap.get(`${org.id}__${r.quarter}`);
        return {
          quarter: r.quarter as string,
          rates: toRateRecord(r),
          total: Number(r.total) || 0,
          headcount: orgSubRow?.headcount ?? null,
          note: orgSubRow?.note ?? null,
        };
      }),
      expat: null,
      children: [],
    };
  });

  // 배부율조사 로직 정의(엑셀) 기준: 법인과 주재원은 '1차. 조직 표기'에 각각 별도 행으로 존재하는
  // 독립된 조직이며 구분하여 조사한다. 더 이상 '{basis}_주재원'을 법인 조직 안에 묶어 넣지 않고
  // 그대로 독립된 조직으로 노출한다 (예: HSZ와 HSZ_주재원은 각각 별도로 선택/확정).
  // 사업총괄대표처럼 다른 조직 값을 따라가는 자리도 하위 조직 목록에 그대로 넣는다.
  // 상위 조직 가중평균에는 인원수 1명으로 참여해야 하고(실제 존재하는 자리이므로),
  // 화면에서 입력란만 감춘다 (ConfirmReview 쪽에서 처리).
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

  // 조직별 이력과 같은 기준 — 전 항목 0%인 행은 지운 흔적이라 이력에 넣지 않는다.
  const hkrHistory = (hkrRows ?? [])
    .filter((r) => (Number(r.total) || 0) > 0)
    .map((r) => ({
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
  //
  // 직접 제출받지 않는 조직은 조사 대상이 아니므로 목록에서 뺀다. 안 그러면 값이 멀쩡히 채워져
  // 있는데도(리소스배부율 칩은 초록) 조사 현황에서만 '미제출'로 떠서 누락된 것처럼 보인다.
  //   - 집계 조직(개발 그룹·HR실 등): 하위 조직 값에서 자동계산된다
  //   - 미러 조직(사업총괄대표): 다른 조직 값을 그대로 따라간다
  const aggregateBases = new Set(orgList.filter((o) => o.parent_basis).map((o) => o.parent_basis as string));
  const surveyTargets = orgList.filter(
    (org) => !aggregateBases.has(org.basis) && !HIDDEN_IN_CONFIRM.includes(org.basis)
  );

  const surveyData: SurveyOrgData[] = surveyTargets.map((org) => {
    const orgSubs = subList.filter((s) => s.org_id === org.id);
    const deduped = latestByPerson(orgSubs);
    // 값이 전부 0인 저장은 제출로 보지 않는다 (조사 현황의 '제출됨' 표기 기준).
    const hasSubmission = deduped.some((r) => (Number(r.total) || 0) > 0);
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
