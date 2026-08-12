import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { mailTemplateProblem, isValidDeadline } from "@/lib/linkMail";

/**
 * 조사 링크 안내 메일의 제목·본문 문구 저장.
 *
 * 조직마다 문구가 거의 같아서 관리자가 한 번 고쳐 두고 전 조직에 쓴다(allocation_settings.id=1).
 * 비워서 저장하면 NULL이 되어 코드의 기본 문구로 돌아간다.
 *
 * 영어 링크 조직(HUK 등)에는 적용하지 않는다 — 영문 문구는 코드에 한 벌로 둔다.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const reset = body?.reset === true;
  const supabase = getSupabaseAdmin();

  // 제출 기한만 따로 저장하는 요청 (문구는 건드리지 않는다).
  if (body?.only === "deadline") {
    const deadline = String(body?.deadline ?? "").trim();
    if (!isValidDeadline(deadline)) {
      return NextResponse.json(
        { error: "제출 기한은 40자 이내의 한 줄이어야 하고 링크를 넣을 수 없습니다." },
        { status: 400 }
      );
    }
    const period = String(body?.period ?? "").trim();
    if (!period) return NextResponse.json({ error: "기간이 필요합니다." }, { status: 400 });

    const { error } = await supabase
      .from("allocation_settings")
      // 어느 분기에 정한 기한인지 함께 남긴다 — 분기가 바뀌면 저절로 무효가 되어 다시 묻는다.
      .update({ mail_deadline: deadline, mail_deadline_period: deadline ? period : null, updated_at: new Date().toISOString() })
      .eq("id", 1);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, deadline });
  }

  const subject = String(body?.subject ?? "");
  const text = String(body?.body ?? "");

  if (!reset) {
    const problem = mailTemplateProblem(subject, text);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  }

  const { error } = await supabase
    .from("allocation_settings")
    .update({
      mail_subject_template: reset ? null : subject.trim(),
      mail_body_template: reset ? null : text,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, reset });
}
