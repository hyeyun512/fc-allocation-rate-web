import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: NextRequest) {
  const { period, version } = await req.json();
  if (!period || !version) {
    return NextResponse.json({ error: "기간/버전을 입력해주세요." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("allocation_settings")
    .update({ current_period: period, current_version: version, updated_at: new Date().toISOString() })
    .eq("id", 1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
