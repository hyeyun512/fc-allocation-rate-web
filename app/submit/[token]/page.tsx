import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { TargetKey, getPreviousPeriod } from "@/lib/targets";
import { latestByPerson, SubmissionRow } from "@/lib/rollup";
import SubmitForm from "./SubmitForm";

export const dynamic = "force-dynamic";

async function getData(token: string) {
  const supabase = getSupabaseAdmin();

  const { data: org } = await supabase
    .from("allocation_orgs")
    .select("*")
    .eq("access_token", token)
    .eq("active", true)
    .maybeSingle();

  if (!org) return { org: null, settings: null, previousRate: null, previousPersons: [], hasExpat: false };

  // 법인+주재원이 하나로 관리되는 조직인지 확인 (예: HSZ -> HSZ_주재원 존재 여부)
  const { data: expatOrg } = await supabase
    .from("allocation_orgs")
    .select("id")
    .eq("basis", `${org.basis}_주재원`)
    .maybeSingle();
  const hasExpat = !!expatOrg;

  const { data: settings } = await supabase
    .from("allocation_settings")
    .select("*")
    .eq("id", 1)
    .single();

  // 참고용: 가장 최근 확정(발행)된 분기 배부율 (담당자가 조정 반영한 확정값)
  const { data: previousRate } = await supabase
    .from("allocation_rate")
    .select("*")
    .eq("basis", org.basis)
    .eq("division", org.division)
    .eq("type", org.type)
    .order("quarter", { ascending: false })
    .limit(1)
    .maybeSingle();

  // 개인별 입력이 필요한 조직: 직전 분기에 제출됐던 팀원별 데이터를 "불러오기" 버튼용으로 함께 가져온다.
  let previousPersons: SubmissionRow[] = [];
  if (org.requires_person_detail) {
    const prevPeriod = settings?.current_period ? getPreviousPeriod(settings.current_period) : null;
    if (prevPeriod) {
      const { data: prevSubs } = await supabase
        .from("allocation_submissions")
        .select("*")
        .eq("org_id", org.id)
        .eq("period", prevPeriod)
        .not("person_name", "is", null)
        .order("submitted_at", { ascending: false });
      previousPersons = latestByPerson((prevSubs ?? []) as SubmissionRow[]);
    }
  }

  return { org, settings, previousRate, previousPersons, hasExpat };
}

export default async function SubmitPage({ params }: { params: { token: string } }) {
  const { org, settings, previousRate, previousPersons, hasExpat } = await getData(params.token);

  if (!org) {
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
      org={org}
      period={settings?.current_period ?? "이번 분기"}
      version={settings?.current_version ?? "Forecast"}
      previousRate={previousRate as Record<TargetKey, number> | null}
      previousPersons={previousPersons.map((p) => ({ ...p, person_name: p.person_name as string }))}
      hasExpat={hasExpat}
    />
  );
}
