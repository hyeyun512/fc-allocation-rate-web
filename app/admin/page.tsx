import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { latestByPerson, SubmissionRow } from "@/lib/rollup";
import SurveyOverview, { SurveyOrgData } from "./SurveyOverview";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
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

  const orgList = orgs ?? [];
  const subList = (submissions ?? []) as SubmissionRow[];

  const data: SurveyOrgData[] = orgList.map((org) => {
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

  return <SurveyOverview period={period} version={version} data={data} />;
}
