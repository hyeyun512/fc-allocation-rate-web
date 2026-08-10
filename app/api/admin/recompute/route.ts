import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { recomputeAggregates } from "@/lib/autoAggregate";

/**
 * 지정한 분기의 자동계산(상위 집계 조직 · HKR · 사업총괄대표 · 고정비율)을 다시 돌린다.
 *
 * 평소에는 조직을 저장할 때 함께 실행되지만, 계산 규칙이 바뀐 뒤 예전 분기 값을 최신 규칙으로
 * 맞추거나 지난 분기를 점검할 때는 저장 없이 돌려야 한다. 조직이 직접 입력한 값(allocation_submissions)은
 * 건드리지 않고, 그 값들로부터 파생되는 행만 다시 쓴다.
 */
export async function POST(req: NextRequest) {
  const { period, version } = await req.json();
  if (!period) {
    return NextResponse.json({ error: "분기(period)를 지정해주세요." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: settings } = await supabase.from("allocation_settings").select("*").eq("id", 1).single();

  const problems = await recomputeAggregates(supabase, period, version ?? settings?.current_version ?? "Forecast");
  return NextResponse.json({ ok: problems.length === 0, period, problems });
}
