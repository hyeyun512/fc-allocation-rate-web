import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: NextRequest) {
  const { period, version, surveyPeriods } = await req.json();
  if (!period || !version) {
    return NextResponse.json({ error: "기간/버전을 입력해주세요." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const patch: Record<string, unknown> = { current_period: period, current_version: version, updated_at: new Date().toISOString() };
  // 조사 링크에 여는 기간 — 넘어온 경우에만 쓴다(빈 배열이면 current_period 하나만 연다).
  if (Array.isArray(surveyPeriods)) {
    patch.survey_periods = surveyPeriods.map((p: unknown) => String(p).trim()).filter(Boolean);
  }
  const { error } = await supabase.from("allocation_settings").update(patch).eq("id", 1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
