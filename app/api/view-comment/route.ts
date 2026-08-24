import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * View 화면의 관리자 코멘트 저장.
 *
 * allocation_rate.note에 적지 않는다 — 그 칸에는 확정할 때마다
 * "웹 확정 (Forecast) - 2026-08-05T…" 같은 감사로그가 자동으로 덮여서
 * 관리자가 적은 코멘트가 다음 확정 때 조용히 사라진다.
 * 그래서 allocation_view_comments(quarter+basis)에 따로 보관한다.
 * 정답본(청구기준) 분기도 quarter 값이 달라 같은 표에 그대로 들어간다.
 */
export async function POST(req: NextRequest) {
  const { quarter, basis, content } = await req.json();

  if (!quarter || !basis) {
    return NextResponse.json({ error: "분기와 배부기준이 필요합니다." }, { status: 400 });
  }
  const text = content == null ? "" : String(content);
  if (text.length > 500) {
    return NextResponse.json({ error: "코멘트가 너무 깁니다 (500자 이내)." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // 빈 코멘트는 행을 남기지 않고 지운다 — 빈 문자열 행이 쌓이면 "코멘트 있음" 판단이 어려워진다.
  if (!text.trim()) {
    const { error } = await supabase
      .from("allocation_view_comments")
      .delete()
      .eq("quarter", quarter)
      .eq("basis", basis);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, content: "" });
  }

  const { error } = await supabase
    .from("allocation_view_comments")
    .upsert(
      { quarter, basis, content: text, updated_by: "관리자 (View)", updated_at: new Date().toISOString() },
      { onConflict: "quarter,basis" }
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, content: text });
}
