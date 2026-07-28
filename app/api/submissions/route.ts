import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { TARGETS, TargetKey, sumTargets } from "@/lib/targets";

function parseRates(rates: Record<string, string>) {
  const out = {} as Record<TargetKey, number>;
  TARGETS.forEach((t) => {
    const v = Number(rates?.[t.key]);
    out[t.key] = Number.isFinite(v) ? v : 0;
  });
  return out;
}

// 합계가 0(미입력)이거나 100%에 근접해야 통과. 값은 있는데 100%가 아닌 경우만 오류로 취급.
function totalIsValid(parsed: Record<TargetKey, number>): boolean {
  const total = sumTargets(parsed);
  return total === 0 || Math.abs(total - 1) < 0.005;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { token, submittedBy, headcount, note, orgRates, persons } = body ?? {};

  if (!token || !submittedBy || !orgRates) {
    return NextResponse.json({ error: "필수 항목이 누락되었습니다." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  const { data: org } = await supabase
    .from("allocation_orgs")
    .select("*")
    .eq("access_token", token)
    .eq("active", true)
    .maybeSingle();

  if (!org) {
    return NextResponse.json({ error: "유효하지 않은 링크입니다." }, { status: 404 });
  }

  const { data: settings } = await supabase
    .from("allocation_settings")
    .select("*")
    .eq("id", 1)
    .single();

  const period = settings?.current_period ?? "미지정";
  const version = settings?.current_version ?? "Forecast";

  const parsedOrgRates = parseRates(orgRates);
  const personsProvided = Array.isArray(persons) && persons.some((p: any) => p?.name && String(p.name).trim());
  // 조직 단위 값이 팀 구성원별 값의 평균으로 자동 계산된 경우(personsProvided)는 아래에서 개인별로 이미 검증하므로 중복 검증하지 않는다.
  if (!personsProvided && !totalIsValid(parsedOrgRates)) {
    return NextResponse.json({ error: "조직 단위 배부율 합계가 100%가 아닙니다." }, { status: 400 });
  }
  if (Array.isArray(persons)) {
    for (const p of persons) {
      if (!p?.name || !String(p.name).trim()) continue;
      if (!totalIsValid(parseRates(p.rates ?? {}))) {
        return NextResponse.json({ error: `'${p.name}'님의 비율 합계가 100%가 아닙니다.` }, { status: 400 });
      }
    }
  }

  const rows: any[] = [];

  rows.push({
    org_id: org.id,
    period,
    version,
    person_name: null,
    sub_team: null,
    headcount: headcount ?? null,
    ...parsedOrgRates,
    total: sumTargets(parsedOrgRates),
    note: note || null,
    submitted_by: submittedBy,
    status: "pending",
  });

  if (Array.isArray(persons)) {
    for (const p of persons) {
      if (!p?.name || !String(p.name).trim()) continue;
      const parsed = parseRates(p.rates ?? {});
      rows.push({
        org_id: org.id,
        period,
        version,
        person_name: p.name,
        sub_team: p.subTeam || null,
        headcount: p.headcount ?? null,
        ...parsed,
        total: sumTargets(parsed),
        note: p.note || null,
        submitted_by: submittedBy,
        status: "pending",
      });
    }
  }

  const { error } = await supabase.from("allocation_submissions").insert(rows);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, count: rows.length });
}
