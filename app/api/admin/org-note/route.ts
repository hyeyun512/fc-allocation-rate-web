import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { TARGETS, TargetKey, sumTargets } from "@/lib/targets";

/**
 * 자동계산 조직(개인별 조직 · 상위 집계 조직)의 코멘트만 저장하는 라우트.
 *
 * 배부율은 하위 조직/개인 값에서 파생되므로 여기서 손대지 않는다 —
 * allocation_rate(운영 테이블)는 건드리지 않고, 조직 단위 제출 행에 코멘트만 남긴다.
 * (코멘트 저장이 '확정'으로 오해되지 않게 하기 위함.)
 */
export async function POST(req: NextRequest) {
  const { orgId, period, version, note, rates, headcount } = await req.json();

  if (!orgId || !period) {
    return NextResponse.json({ error: "필수 항목이 누락되었습니다." }, { status: 400 });
  }
  if (note != null && String(note).length > 500) {
    return NextResponse.json({ error: "코멘트가 너무 깁니다 (500자 이내)." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  const { data: org } = await supabase.from("allocation_orgs").select("*").eq("id", orgId).maybeSingle();
  if (!org) {
    return NextResponse.json({ error: "조직을 찾을 수 없습니다." }, { status: 404 });
  }

  // 코멘트 행에도 그 시점의 자동계산 값을 함께 남겨 이력이 어긋나지 않게 한다.
  const parsed = {} as Record<TargetKey, number>;
  TARGETS.forEach((t) => {
    const v = Number(rates?.[t.key]);
    parsed[t.key] = Number.isFinite(v) ? v : 0;
  });

  const { error } = await supabase.from("allocation_submissions").insert({
    org_id: orgId,
    period,
    version: version ?? "Forecast",
    person_name: null,
    sub_team: null,
    headcount: headcount ?? null,
    ...parsed,
    total: sumTargets(parsed),
    note: note || null,
    submitted_by: "관리자 코멘트 (검토및확정)",
    status: "confirmed",
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
