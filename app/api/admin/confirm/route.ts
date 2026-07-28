import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { TARGETS, TargetKey, sumTargets } from "@/lib/targets";

export async function POST(req: NextRequest) {
  const { orgId, period, version, rates } = await req.json();

  if (!orgId || !period || !rates) {
    return NextResponse.json({ error: "필수 항목이 누락되었습니다." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  const { data: org } = await supabase.from("allocation_orgs").select("*").eq("id", orgId).maybeSingle();
  if (!org) {
    return NextResponse.json({ error: "조직을 찾을 수 없습니다." }, { status: 404 });
  }

  const parsed = {} as Record<TargetKey, number>;
  TARGETS.forEach((t) => {
    const v = Number(rates[t.key]);
    parsed[t.key] = Number.isFinite(v) ? v : 0;
  });

  const { error: upsertError } = await supabase
    .from("allocation_rate")
    .upsert(
      {
        quarter: period,
        type: org.type,
        division: org.division,
        basis: org.basis,
        ...parsed,
        total: sumTargets(parsed),
        update_flag: true,
        note: `웹 확정 (${version}) - ${new Date().toISOString()}`,
      },
      { onConflict: "quarter,type,division,basis" }
    );

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  await supabase
    .from("allocation_submissions")
    .update({ status: "confirmed" })
    .eq("org_id", orgId)
    .eq("period", period);

  return NextResponse.json({ ok: true });
}
