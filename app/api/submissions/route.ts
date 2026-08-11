import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { TARGETS, TargetKey, sumTargets } from "@/lib/targets";
import { recomputeAggregates } from "@/lib/autoAggregate";
import { buildDeletionTombstones } from "@/lib/personTombstones";

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
        // 주재원 전용 조직은 화면에 '구분' 열이 없어 값이 안 넘어온다 — 전원 주재원으로 채운다.
        sub_team: p.subTeam || (org.division === "주재원" || String(org.basis).endsWith("_주재원") ? "주재원" : null),
        // 개인별 입력은 한 행 = 한 명이다.
        headcount: 1,
        ...parsed,
        total: sumTargets(parsed),
        note: p.note || null,
        submitted_by: submittedBy,
        status: "pending",
      });
    }

    // 이전 제출에 있었지만 이번 명단에서 지워진 사람은 삭제 표식을 남긴다 (append-only라 안 그러면 되살아난다).
    const tombstones = await buildDeletionTombstones(supabase, {
      orgId: org.id,
      period,
      version,
      keptNames: persons.filter((p: any) => p?.name && String(p.name).trim()).map((p: any) => String(p.name)),
      submittedBy,
    });
    rows.push(...tombstones);
  }

  const { error } = await supabase.from("allocation_submissions").insert(rows);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 제출이 끝났으면 임시저장본은 필요 없다 (다음에 다시 열면 제출된 값에서 이어서 고친다).
  await supabase.from("allocation_submission_drafts").delete().eq("org_id", org.id).eq("period", period);

  // 상위 집계 조직·HKR·사업총괄대표 값은 이 제출에서 파생되므로 함께 갱신한다.
  await recomputeAggregates(supabase, period, version);

  return NextResponse.json({ ok: true, count: rows.length });
}
