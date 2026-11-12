import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getSubmitData } from "@/lib/submitData";
import { BUNDLE_TOKEN_SEPARATOR, bundleOfOrg } from "@/lib/linkBundles";
import { latestByPerson, SubmissionRow } from "@/lib/rollup";
import { TARGETS, TargetKey } from "@/lib/targets";
import BundleView from "./BundleView";

export const dynamic = "force-dynamic";

export const metadata = { title: "리소스 배부율 조사" };

const toRec = (row: Record<string, any>) =>
  Object.fromEntries(TARGETS.map((t) => [t.key, Number(row[t.key]) || 0])) as Record<TargetKey, number>;

/**
 * 묶음 조사 링크 — 조직 링크 여러 개를 한 화면에서 연다. 위쪽 버튼으로 조직을 고르면
 * 그 조직의 조사 링크 화면(/submit/<토큰>)과 똑같은 화면이 아래에 나온다.
 *
 * 묶음(lib/linkBundles.ts)에 든 조직은 제출 후에도 계속 열어 두고, 묶음을 만든 시각(baselineAt)의 값을
 * 함께 실어 보내 화면이 달라진 칸을 빨갛게 칠하게 한다.
 */
export default async function BundlePage({ params }: { params: { tokens: string } }) {
  const supabase = getSupabaseAdmin();
  const tokens = decodeURIComponent(params.tokens)
    .split(BUNDLE_TOKEN_SEPARATOR)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 20);

  const { data: linkOrgs } = await supabase
    .from("allocation_orgs")
    .select("basis,access_token")
    .in("access_token", tokens)
    .eq("active", true);
  const results = await Promise.all(tokens.map((t) => getSubmitData(t)));

  // 화면에 실리는 모든 조직(하위 팀 포함)과 그 기간의 제출 이력 — 처음 값을 만든다.
  const orgIds = Array.from(new Set(results.flatMap((r) => r?.rounds.flatMap((rd) => rd.data.orgs.map((o) => o.orgId)) ?? [])));
  const periods = Array.from(new Set(results.flatMap((r) => r?.rounds.map((rd) => rd.period) ?? [])));
  const [{ data: orgRows }, { data: subRows }] = await Promise.all([
    supabase.from("allocation_orgs").select("id,basis,parent_basis").in("id", orgIds.length ? orgIds : [-1]),
    supabase
      .from("allocation_submissions")
      .select("*")
      .in("org_id", orgIds.length ? orgIds : [-1])
      .in("period", periods.length ? periods : ["-"]),
  ]);

  function baselineOf(orgId: number, period: string) {
    const org = (orgRows ?? []).find((o) => o.id === orgId);
    const bundle = org ? bundleOfOrg(org) : null;
    if (!bundle) return null;
    const cutoff = new Date(bundle.baselineAt).getTime();
    const rows = latestByPerson(
      ((subRows ?? []) as SubmissionRow[]).filter(
        (s) => s.org_id === orgId && s.period === period && new Date(s.submitted_at).getTime() <= cutoff
      )
    );
    const orgLevel = rows.find((r) => r.person_name === null) ?? null;
    return {
      orgRates: orgLevel ? toRec(orgLevel) : null,
      headcount: orgLevel?.headcount != null ? Number(orgLevel.headcount) : null,
      persons: Object.fromEntries(
        rows.filter((r) => r.person_name !== null && (Number(r.total) || 0) > 0).map((r) => [String(r.person_name).trim(), toRec(r)])
      ),
    };
  }

  const entries = tokens
    .map((token, i) => ({
      token,
      label: (linkOrgs ?? []).find((o) => o.access_token === token)?.basis ?? "",
      result: results[i],
    }))
    .filter((e) => e.result && e.label)
    .map((e) => ({
      token: e.token,
      label: e.label,
      ...e.result!,
      rounds: e.result!.rounds.map((rd) => ({
        ...rd,
        data: {
          ...rd.data,
          orgs: rd.data.orgs.map((o) => {
            const baseline = baselineOf(o.orgId, rd.period);
            // 묶음에 든 조직만 연다 — 서버(api/submissions)도 같은 목록으로 판정한다.
            // 자동 임시저장을 쓰지 않으므로 예전 임시저장본도 불러오지 않는다 — 제출된 값에서 시작한다.
            return baseline ? { ...o, bundleEdit: true, editAllowed: true, baseline, draft: null, draftSavedAt: null } : o;
          }),
        },
      })),
    }));

  if (entries.length === 0) {
    return (
      <div className="page page-narrow">
        <div className="panel">
          <div className="panel-title">유효하지 않은 링크입니다</div>
          <div className="panel-sub">링크 주소를 다시 확인해주시거나, 배부율 담당자에게 문의해주세요.</div>
        </div>
      </div>
    );
  }

  return <BundleView entries={entries} />;
}
