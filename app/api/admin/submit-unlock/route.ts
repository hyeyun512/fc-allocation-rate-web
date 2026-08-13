import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * 조사 링크 재제출 허용/취소.
 *
 * 한 번 제출한 링크는 담당자가 임의로 고칠 수 없다. 값이 바뀌어야 하면 관리자가 여기서 열어준다.
 * 열어준 표식은 담당자가 다시 제출하는 순간 서버가 지운다(api/submissions) — 한 번만 쓰인다.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const orgId = Number(body?.orgId);
  const period = String(body?.period ?? "").trim();
  const allow = body?.allow !== false;

  if (!orgId || !period) {
    return NextResponse.json({ error: "조직과 기간이 필요합니다." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  if (!allow) {
    const { error } = await supabase
      .from("allocation_submit_unlocks")
      .delete()
      .eq("org_id", orgId)
      .eq("period", period);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, allowed: false });
  }

  const { error } = await supabase
    .from("allocation_submit_unlocks")
    .upsert({ org_id: orgId, period, unlocked_at: new Date().toISOString() }, { onConflict: "org_id,period" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, allowed: true });
}
