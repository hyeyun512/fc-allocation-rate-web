import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * 조사 링크 화면의 자동 임시저장.
 *
 * 임시저장은 **미제출** 상태다 — allocation_submissions에는 절대 넣지 않는다.
 * (그 테이블은 관리자 화면의 집계·조사현황·이력이 모두 읽으므로 status로 걸러도 새기 쉽다.)
 * 전용 테이블 allocation_submission_drafts에 분기별로 한 벌만 덮어쓰고,
 * 제출이 끝나면 지운다.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { token, payload } = body ?? {};

  if (!token || !payload) {
    return NextResponse.json({ error: "필수 항목이 누락되었습니다." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  const { data: org } = await supabase
    .from("allocation_orgs")
    .select("id")
    .eq("access_token", token)
    .eq("active", true)
    .maybeSingle();

  if (!org) {
    return NextResponse.json({ error: "유효하지 않은 링크입니다." }, { status: 404 });
  }

  const { data: settings } = await supabase.from("allocation_settings").select("*").eq("id", 1).single();
  const period = settings?.current_period ?? "미지정";

  const savedAt = new Date().toISOString();
  const { error } = await supabase
    .from("allocation_submission_drafts")
    .upsert({ org_id: org.id, period, payload, updated_at: savedAt }, { onConflict: "org_id,period" });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, savedAt });
}
