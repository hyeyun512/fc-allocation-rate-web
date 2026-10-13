import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { TARGETS, TargetKey } from "@/lib/targets";
import { latestByPerson, latestByPersonAndPeriod, latestOrgByPeriod, computeRollup, SubmissionRow } from "@/lib/rollup";
import { HIDDEN_IN_CONFIRM } from "@/lib/autoAggregate";
import { isOrgActiveIn } from "@/lib/orgLifespan";
import { resolveManagerPair, OrgManagerRow } from "@/lib/orgManager";
import { linkTokenOf, isTokenOwner, OrgLite } from "@/lib/orgLink";
import { needsEnglishNote, submitLangOf, orgLabelFor } from "@/lib/englishOrgs";
import { templateFor, previousTemplate, MailTemplateRow } from "@/lib/mailTemplateStore";
import { OrgReviewData, ReviewRound } from "./ConfirmReview";
import { SurveyOrgData, SurveyPeriodStatus } from "../SurveyOverview";
import ConfirmTabs from "./ConfirmTabs";
import { roundPeriods, mailPeriodOf, prefillsFromEarlier } from "@/lib/surveyPeriods";
import { quarterRank } from "@/lib/quarter";

export const dynamic = "force-dynamic";

function toRateRecord(row: Record<string, any>): Record<TargetKey, number> {
  return Object.fromEntries(TARGETS.map((t) => [t.key, Number(row[t.key]) || 0])) as Record<TargetKey, number>;
}

export default async function AdminConfirmPage() {
  const supabase = getSupabaseAdmin();

  const { data: settings } = await supabase.from("allocation_settings").select("*").eq("id", 1).single();
  // 라운드(current_period)가 두 기간 묶음(26년 4Q & 27년 BP)이면 두 기간을 한 화면에서 함께 검토·확정한다.
  // 저장되는 값은 언제나 실제 기간 하나("2026-Q4" 또는 "2027-BP")이므로 데이터는 기간마다 따로 만든다.
  const round = settings?.current_period ?? "";
  const periodsInRound = roundPeriods(round);
  const periods = periodsInRound.length > 0 ? periodsInRound : [""];
  // 담당자·링크·메일 문구처럼 라운드에 한 벌만 있는 것은 라운드의 첫 기간 자리에 둔다
  // (메일 문구의 mailPeriodOf와 같은 기준 — 링크와 메일이 하나라서).
  const firstPeriod = periods[0];
  const version = settings?.current_version ?? "Forecast";

  // 제출을 마친 링크를 다시 열어준 조직 (조사 탭의 '수정 허용'). 허용 표식은 기간마다 따로 남는다.
  const { data: unlockRows } = await supabase
    .from("allocation_submit_unlocks")
    .select("org_id,period")
    .in("period", periods);

  // 메일 문구는 분기별로 남긴다 — 새 분기 문구를 저장해도 지난 분기에 뭐라고 보냈는지가 남아 있어야
  // 그걸 그대로 불러다 쓸 수 있다.
  const { data: mailTplRows } = await supabase.from("allocation_mail_templates").select("period,subject,body");
  const mailTpl = templateFor((mailTplRows ?? []) as MailTemplateRow[], mailPeriodOf(firstPeriod));
  const hasPreviousMail = previousTemplate((mailTplRows ?? []) as MailTemplateRow[], mailPeriodOf(firstPeriod)) != null;

  const { data: orgs } = await supabase
    .from("allocation_orgs")
    .select("*")
    .eq("active", true)
    .order("division")
    .order("basis");

  const { data: submissions } = await supabase
    .from("allocation_submissions")
    .select("*")
    .in("period", periods)
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

  // 조사 현황의 담당자 — 이번 분기 값이 없으면 지난 분기 값을 이어 쓰므로 전체 분기를 가져온다.
  const { data: managerRows } = await supabase
    .from("allocation_org_managers")
    .select("org_id,period,manager_name,manager_email,email_set_period");

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

  // 그 분기에 존재하지 않았던 조직(예: 1Q에만 있던 'Staff(CEO) 직속')은 조사·확정 어디에도 띄우지 않는다.
  const allSubList = (submissions ?? []) as SubmissionRow[];
  const personSubList = (personSubmissions ?? []) as SubmissionRow[];
  const rates = rateRows ?? [];

  const orgLevelHistoryMap = new Map<string, SubmissionRow>();
  latestOrgByPeriod((orgLevelSubmissions ?? []) as SubmissionRow[]).forEach((r) => {
    orgLevelHistoryMap.set(`${r.org_id}__${r.period}`, r);
  });

  /**
   * 기간 하나의 '리소스배부율' 검토 데이터. 묶음 라운드면 기간마다 한 번씩 만든다 —
   * 이력(rateHistory·personHistory)은 기간과 무관하게 같고, 이번 기간 제출값·확정 여부만 기간마다 다르다.
   * 화면은 같은 조직을 기간별 데이터에서 찾아 한 표에 기간마다 행을 붙인다.
   */
  function buildReview(period: string): ReviewRound {
    const orgList = (orgs ?? []).filter((o) => isOrgActiveIn(o.basis, period));
    const subList = allSubList.filter((s) => s.period === period);

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
      // 입력칸을 미리 채울 값: 그 기간 자기 행, 없으면 그 기간보다 **앞선** 기간 중 가장 나중 행.
      // 전 기간에서 마지막 행을 쓰면 4Q 화면에 먼저 확정한 27년 BP 값이 들어간다(뒤 기간 값을 끌어오면 안 된다).
      // 표기를 못 읽는 기간(직접 입력)은 예전처럼 마지막 행을 쓴다.
      const periodRank = quarterRank(period);
      const currentRateRow =
        periodRank < 0
          ? orgRateRows[orgRateRows.length - 1] ?? null
          : orgRateRows.find((r) => r.quarter === period) ??
            // 27년 BP 같은 예산 기간은 빈칸에서 시작한다 — 앞선 기간 값으로 채우지 않는다.
            (prefillsFromEarlier(period) ? orgRateRows : [])
              .filter((r) => quarterRank(String(r.quarter)) >= 0 && quarterRank(String(r.quarter)) < periodRank)
              .sort((a, b) => quarterRank(String(a.quarter)) - quarterRank(String(b.quarter)))
              .pop() ??
            null;

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

      const orgIsEnglish = needsEnglishNote(org.basis);

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
        submittedNoteEn: orgLevelRow?.note_en ?? null,
        needsEnglishNote: orgIsEnglish,
        currentPersons: personRows.map((p) => ({
          name: p.person_name as string,
          headcount: p.headcount,
          rates: toRateRecord(p),
          note: p.note ?? null,
          noteEn: p.note_en ?? null,
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
            noteEn: orgSubRow?.note_en ?? null,
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
    return { period, data: finalData };
  }
  const reviewRounds = periods.map(buildReview);

  // 조직별 이력과 같은 기준 — 전 항목 0%인 행은 지운 흔적이라 이력에 넣지 않는다.
  const hkrHistory = (hkrRows ?? [])
    .filter((r) => (Number(r.total) || 0) > 0)
    .map((r) => ({
      quarter: r.quarter as string,
      rates: toRateRecord(r),
      total: Number(r.total) || 0,
    }));

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
    billing_basis?: string | null;
    note?: string | null;
  }
  interface SelfuseBasisPayload {
    bundang_selfuse_ratio: number;
    /** 이사로 분당 건물이 둘인 분기에만 있다. 그 전에 저장된 행에는 아예 없으므로 optional. */
    bundang_selfuse_ratio_2?: number | null;
    yongin_selfuse_ratio: number;
    biz_dev_media_headcount: number;
    staff_headcount: number;
    hq_total_headcount: number;
    material_evcs_domestic_ratio: number;
    material_evcs_overseas_ratio: number;
    note?: string | null;
  }

  const basisInputs = basisInputRows ?? [];
  const itHistory = basisInputs
    .filter((r) => r.category === "it_headcount" || r.category === "it_sap")
    .map((r) => {
      const p = r.payload as ItBasisPayload;
      return {
        quarter: r.quarter as string,
        metric: (r.category === "it_headcount" ? "인원수" : "SAP ID 개수") as "인원수" | "SAP ID 개수",
        billing_basis: p.billing_basis ?? null,
        note: p.note ?? null,
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

  const selfuseHistory = basisInputs
    .filter((r) => r.category === "selfuse")
    .map((r) => {
      const p = r.payload as SelfuseBasisPayload;
      return {
        quarter: r.quarter as string,
        bundang_selfuse_ratio: p.bundang_selfuse_ratio,
        bundang_selfuse_ratio_2: p.bundang_selfuse_ratio_2 ?? null,
        yongin_selfuse_ratio: p.yongin_selfuse_ratio,
        biz_dev_media_headcount: p.biz_dev_media_headcount,
        staff_headcount: p.staff_headcount,
        hq_total_headcount: p.hq_total_headcount,
        material_evcs_domestic_ratio: p.material_evcs_domestic_ratio,
        material_evcs_overseas_ratio: p.material_evcs_overseas_ratio,
        submitted_by: r.submitted_by ?? null,
        confirmed_at: r.confirmed_at ?? null,
        note: p.note ?? null,
      };
    });

  // '조사' 탭 데이터 — 이미 불러온 조직·제출 목록을 그대로 재사용한다.
  //
  // 목록의 단위는 '검토 및 확정 > 리소스배부율'의 조직/팀 선택과 같게 맞춘다.
  // 즉 상위 조직(개발 그룹·경영지원실 등)만 늘어놓고, 하위 팀은 그 안에 접어 넣는다
  // (예전에는 팀이 전부 펼쳐져 있어 두 화면의 조직 단위가 서로 달라 보였다).
  // 미러 조직(사업총괄대표)은 다른 조직 값을 그대로 따라가므로 양쪽 모두에서 감춘다.
  const managers = (managerRows ?? []) as OrgManagerRow[];
  // 링크 주인·토큰 판정은 lib/orgLink.ts 한 곳에서만 한다 — 예전에는 이 판정이 여러 군데 흩어져 있어
  // 메일에 담기는 링크와 화면의 복사 버튼이 조용히 달라질 수 있었다.
  const orgLites = (orgs ?? []) as OrgLite[];
  // 라운드의 어느 기간에든 있는 조직은 조사 목록에 둔다. 제출 현황은 그 조직이 있는 기간마다 따로 센다.
  const surveyItems: SurveyOrgData[] = (orgs ?? [])
    .filter((org) => periods.some((p) => isOrgActiveIn(org.basis, p)))
    .filter((org) => !HIDDEN_IN_CONFIRM.includes(org.basis))
    .map((org) => {
      const statuses: SurveyPeriodStatus[] = periods
        .filter((p) => isOrgActiveIn(org.basis, p))
        .map((p) => {
          const deduped = latestByPerson(allSubList.filter((s) => s.org_id === org.id && s.period === p));
          return {
            period: p,
            // 값이 전부 0인 저장은 제출로 보지 않는다 (조사 현황의 '제출됨' 표기 기준).
            hasSubmission: deduped.some((r) => (Number(r.total) || 0) > 0),
            submittedBy: deduped.find((r) => r.person_name === null)?.submitted_by ?? deduped[0]?.submitted_by ?? null,
            latestSubmittedAt: deduped.reduce<string | null>((max, r) => {
              if (!max || new Date(r.submitted_at) > new Date(max)) return r.submitted_at;
              return max;
            }, null),
            personCount: deduped.filter((r) => r.person_name !== null).length,
            // 제출한 링크는 잠긴다 — 관리자가 열어준 기간만 다시 제출할 수 있다.
            editAllowed: (unlockRows ?? []).some((u: any) => u.org_id === org.id && u.period === p),
          };
        });

      return {
        org: {
          id: org.id,
          basis: org.basis,
          division: org.division,
          requires_person_detail: org.requires_person_detail,
          access_token: org.access_token,
          parent_basis: org.parent_basis ?? null,
        },
        statuses,
        manager: resolveManagerPair(managers, org.id, firstPeriod),
        // 링크 화면 언어와 표기는 서버에서 정해 내려준다 — lib/englishOrgs.ts에는 실제 조직명이
        // 들어 있어 클라이언트 번들에 실리면 담당자에게 다른 조직 이름이 노출된다.
        orgLabel: orgLabelFor(org.basis, submitLangOf(org.basis)),
        linkToken: linkTokenOf(orgLites, org.id, firstPeriod) ?? org.access_token,
        isTokenOwner: isTokenOwner(orgLites, org.id, firstPeriod),
        children: [],
      };
    });

  const surveyByBasis = new Map(surveyItems.map((i) => [i.org.basis, i]));
  const surveyData: SurveyOrgData[] = [];
  surveyItems.forEach((item) => {
    const parent = item.org.parent_basis ? surveyByBasis.get(item.org.parent_basis) : null;
    // 상위 조직이 목록에 없으면(감춰졌거나 비활성) 링크를 잃지 않도록 그대로 최상위에 둔다.
    if (parent) parent.children.push(item);
    else surveyData.push(item);
  });

  return (
    <ConfirmTabs
      periods={periods}
      round={round}
      version={version}
      mailSubject={mailTpl?.subject ?? ""}
      mailBody={mailTpl?.body ?? ""}
      hasPreviousMail={hasPreviousMail}
      surveyData={surveyData}
      reviewRounds={reviewRounds}
      hkrHistory={hkrHistory}
      itHistory={itHistory}
      selfuseHistory={selfuseHistory}
    />
  );
}
