import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveTargetOrg } from "@/lib/submitScope";

/**
 * 재수정을 도중에 그만둔다.
 *
 * 제출을 마친 조직은 관리자가 '수정 허용'을 눌러야 다시 고칠 수 있는데(allocation_submit_unlocks),
 * 열어놓고 보니 고칠 게 없더라는 경우가 생긴다. 그때 고치던 내용을 버리고 **제출된 값 그대로**
 * 되돌리기 위한 라우트다.
 *
 * 하는 일은 두 가지뿐이다 — 임시저장본을 지우고, 재수정 허용 표식을 지운다.
 * allocation_submissions는 건드리지 않는다. 제출된 값이 곧 되돌아갈 원래 값이므로
 * 지울 것이 없고, 그 표는 append-only라 함부로 손대면 이력이 어긋난다.
 *
 * 되돌린 뒤에는 다시 잠긴다. 또 고치려면 관리자가 '수정 허용'을 다시 눌러야 한다 —
 * 담당자가 스스로 잠금을 여닫을 수 있으면 '제출하면 잠긴다'는 규칙이 이름만 남는다.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { token, orgId } = body ?? {};

  if (!token) {
    return NextResponse.json({ error: "필수 항목이 누락되었습니다." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  const { data: linkOrg } = await supabase
    .from("allocation_orgs")
    .select("id,basis")
    .eq("access_token", token)
    .eq("active", true)
    .maybeSingle();

  if (!linkOrg) {
    return NextResponse.json({ error: "유효하지 않은 링크입니다." }, { status: 404 });
  }

  // 집계 조직 링크는 하위 조직도 함께 여닫는다 (그 밖의 조직은 이 링크로 건드릴 수 없다).
  const org = await resolveTargetOrg(supabase, linkOrg, orgId);
  if (!org) {
    return NextResponse.json({ error: "이 링크로 취소할 수 없는 조직입니다." }, { status: 403 });
  }

  const { data: settings } = await supabase.from("allocation_settings").select("*").eq("id", 1).single();
  const period = settings?.current_period ?? "미지정";

  // 되돌아갈 '원래 값'이 있어야 취소가 성립한다. 한 번도 제출한 적 없는 조직에서 이걸 부르면
  // 되돌릴 곳이 없는데 입력만 지우는 꼴이 되므로 막는다 (화면에도 버튼을 띄우지 않는다).
  const { data: submitted } = await supabase
    .from("allocation_submissions")
    .select("id")
    .eq("org_id", org.id)
    .eq("period", period)
    .neq("status", "deleted")
    .gt("total", 0)
    .limit(1);

  if (!submitted?.length) {
    return NextResponse.json(
      { error: "아직 제출된 값이 없어 되돌릴 수 없습니다.", code: "nothing-to-restore" },
      { status: 400 }
    );
  }

  const draft = await supabase
    .from("allocation_submission_drafts")
    .delete()
    .eq("org_id", org.id)
    .eq("period", period);
  if (draft.error) {
    return NextResponse.json({ error: draft.error.message }, { status: 500 });
  }

  const unlock = await supabase
    .from("allocation_submit_unlocks")
    .delete()
    .eq("org_id", org.id)
    .eq("period", period);
  if (unlock.error) {
    return NextResponse.json({ error: unlock.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
