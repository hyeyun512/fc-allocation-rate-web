import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * 조사 현황의 '담당자' 저장 (분기별).
 *
 * 빈칸으로 저장해도 행을 남긴다 — 행이 있다는 것 자체가 '이 분기 담당자는 직접 정했다'는 표시라
 * 지난 분기 담당자가 다시 딸려오지 않는다 (이어받기 규칙은 lib/orgManager.ts).
 */
export async function POST(req: NextRequest) {
  const { orgId, period, name } = await req.json();

  if (!orgId || !period) {
    return NextResponse.json({ error: "조직과 기간이 필요합니다." }, { status: 400 });
  }
  const text = name == null ? "" : String(name).trim();
  if (text.length > 100) {
    return NextResponse.json({ error: "담당자 이름이 너무 깁니다 (100자 이내)." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  const { error } = await supabase.from("allocation_org_managers").upsert(
    { org_id: orgId, period, manager_name: text, updated_at: new Date().toISOString() },
    { onConflict: "org_id,period" }
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, name: text });
}
