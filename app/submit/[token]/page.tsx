import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { TARGETS, TargetKey } from "@/lib/targets";
import { latestByPerson, latestByPersonAndPeriod, latestOrgByPeriod, computeRollup, SubmissionRow } from "@/lib/rollup";
import type { CurrentPerson, PersonHistoryEntry, RateHistoryEntry, PersonRole } from "@/components/RateParts";
import SubmitForm, { SubmitOrgData } from "./SubmitForm";

export const dynamic = "force-dynamic";

function toRateRecord(row: Record<string, any>): Record<TargetKey, number> {
  return Object.fromEntries(TARGETS.map((t) => [t.key, Number(row[t.key]) || 0])) as Record<TargetKey, number>;
}

/**
 * 조사 링크 화면에 필요한 데이터.
 *
 * 관리자 '검토 및 확정 > 리소스배부율'에서 조직을 선택했을 때와 **같은 화면 구성**을 쓰므로,
 * 그 화면이 쓰는 것과 같은 종류의 데이터(분기별 배부율 이력·개인별 이력·이번 분기 제출값)를 모은다.
 * 단, 이 링크는 담당자에게 나가므로 **자기 조직 것만** 조회한다 (다른 조직명은 화면에도 데이터에도 넣지 않는다).
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

  const { data: settings } = await supabase.from("allocation_settings").select("*").eq("id", 1).single();
  const period = settings?.current_period ?? "이번 분기";
  const version = settings?.current_version ?? "Forecast";

  // 이 조직의 분기별 확정 배부율 (전 항목 0%인 행은 지운 흔적이라 이력에 넣지 않는다 — 관리자 화면과 같은 기준)
  const { data: rateRows } = await supabase
    .from("allocation_rate")
    .select("*")
    .eq("basis", org.basis)
    .eq("division", org.division)
    .eq("type", org.type)
    .order("quarter", { ascending: true });

  // 이 조직의 제출 이력 전체 (분기별 개인 명단·조직 단위 인원수/코멘트)
  const { data: allSubs } = await supabase
    .from("allocation_submissions")
    .select("*")
    .eq("org_id", org.id)
    .order("submitted_at", { ascending: false });

  const subList = (allSubs ?? []) as SubmissionRow[];
  const thisPeriodSubs = subList.filter((s) => s.period === period);
  const deduped = latestByPerson(thisPeriodSubs);
  const orgLevelRow = deduped.find((r) => r.person_name === null) ?? null;
  // 이름 가나다순이 아니라 입력(저장)한 순서대로 (한 번에 insert되므로 id 오름차순이 곧 입력 순서).
  const personRows = deduped.filter((r) => r.person_name !== null).sort((a, b) => a.id - b.id);

  const orgLevelByPeriod = new Map<string, SubmissionRow>();
  latestOrgByPeriod(subList).forEach((r) => orgLevelByPeriod.set(r.period as string, r));

  const rateHistory: RateHistoryEntry[] = (rateRows ?? [])
    .filter((r) => (Number(r.total) || 0) > 0)
    .map((r) => ({
      quarter: r.quarter as string,
      rates: toRateRecord(r),
      total: Number(r.total) || 0,
      headcount: orgLevelByPeriod.get(r.quarter as string)?.headcount ?? null,
      note: orgLevelByPeriod.get(r.quarter as string)?.note ?? null,
    }));

  const personHistory: PersonHistoryEntry[] = latestByPersonAndPeriod(subList)
    .sort((a, b) => a.period.localeCompare(b.period) || a.id - b.id)
    .map((p) => ({
      name: p.person_name as string,
      period: p.period as string,
      headcount: p.headcount,
      rates: toRateRecord(p),
      total: Number(p.total) || 0,
      submittedAt: p.submitted_at,
      note: p.note ?? null,
      role: (p.sub_team === "주재원" ? "주재원" : "법인") as PersonRole,
    }));

  const currentPersons: CurrentPerson[] = personRows.map((p) => ({
    name: p.person_name as string,
    headcount: p.headcount,
    rates: toRateRecord(p),
    note: p.note ?? null,
    role: (p.sub_team === "주재원" ? "주재원" : "법인") as PersonRole,
  }));

  // 아직 제출하지 않고 자동 임시저장만 되어 있는 값 (관리자에게는 보이지 않는다).
  const { data: draft } = await supabase
    .from("allocation_submission_drafts")
    .select("payload,updated_at")
    .eq("org_id", org.id)
    .eq("period", period)
    .maybeSingle();

  const hasAnyValue =
    (orgLevelRow ? Number(orgLevelRow.total) || 0 : 0) > 0 || personRows.some((p) => (Number(p.total) || 0) > 0);
  const currentRateRow = (rateRows ?? []).filter((r) => (Number(r.total) || 0) > 0).slice(-1)[0] ?? null;

  const data: SubmitOrgData = {
    orgBasis: org.basis,
    division: org.division,
    requiresPersonDetail: org.requires_person_detail,
    managerName: org.manager_name ?? null,
    submittedThisPeriod: hasAnyValue,
    submittedBy: orgLevelRow?.submitted_by ?? personRows[0]?.submitted_by ?? null,
    latestSubmittedAt: deduped.reduce<string | null>((max, r) => {
      if (!max || new Date(r.submitted_at) > new Date(max)) return r.submitted_at;
      return max;
    }, null),
    rollup: computeRollup(orgLevelRow, personRows),
    currentOrgSubmission: orgLevelRow ? toRateRecord(orgLevelRow) : null,
    submittedHeadcount: orgLevelRow?.headcount ?? null,
    submittedNote: orgLevelRow?.note ?? null,
    currentPersons,
    currentRate: currentRateRow ? toRateRecord(currentRateRow) : null,
    rateHistory,
    personHistory,
    draft: (draft?.payload as any) ?? null,
    draftSavedAt: draft?.updated_at ?? null,
  };

  return { data, period, version };
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

  return <SubmitForm token={params.token} period={result.period} version={result.version} data={result.data} />;
}
