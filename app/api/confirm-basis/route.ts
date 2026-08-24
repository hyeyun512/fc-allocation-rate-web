import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { TARGETS, TargetKey, sumTargets } from "@/lib/targets";

// HKR 자동계산 확정 전용 라우트. allocation_rate(운영, fc-dashboard-web 소비)에 직접 upsert한다.
export async function POST(req: NextRequest) {
  const { quarter, type, division, basis, rates, version } = await req.json();

  if (!quarter || !type || !division || !basis || !rates) {
    return NextResponse.json({ error: "필수 항목이 누락되었습니다." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  const parsed = {} as Record<TargetKey, number>;
  TARGETS.forEach((t) => {
    const v = Number(rates[t.key]);
    parsed[t.key] = Number.isFinite(v) ? v : 0;
  });

  const { error: upsertError } = await supabase
    .from("allocation_rate")
    .upsert(
      {
        quarter,
        type,
        division,
        basis,
        ...parsed,
        total: sumTargets(parsed),
        update_flag: true,
        note: `웹 확정 (${version ?? ""}) - ${new Date().toISOString()}`,
      },
      { onConflict: "quarter,type,division,basis" }
    );

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
