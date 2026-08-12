import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { mailTemplateProblem, isValidDeadline } from "@/lib/linkMail";
import { previousTemplate, MailTemplateRow } from "@/lib/mailTemplateStore";

/**
 * 조사 링크 안내 메일의 제목·본문 저장 (**분기별**) + 제출 기한 저장.
 *
 * 분기별로 남기는 이유는 하나다: 새 분기 문구를 저장해도 **지난 분기에 뭐라고 보냈는지가
 * 남아 있어야** 그걸 그대로 불러다 쓸 수 있기 때문이다. 한 벌만 두면 덮어쓰는 순간 사라진다.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const supabase = getSupabaseAdmin();
  const period = String(body?.period ?? "").trim();
  if (!period) return NextResponse.json({ error: "기간이 필요합니다." }, { status: 400 });

  // 제출 기한만 따로 저장하는 요청 (문구는 건드리지 않는다).
  if (body?.only === "deadline") {
    const deadline = String(body?.deadline ?? "").trim();
    if (!isValidDeadline(deadline)) {
      return NextResponse.json(
        { error: "제출 기한은 40자 이내의 한 줄이어야 하고 링크를 넣을 수 없습니다." },
        { status: 400 }
      );
    }
    const { error } = await supabase
      .from("allocation_settings")
      // 어느 분기에 정한 기한인지 함께 남긴다 — 분기가 바뀌면 저절로 무효가 되어 다시 묻는다.
      .update({
        mail_deadline: deadline,
        mail_deadline_period: deadline ? period : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, deadline });
  }

  // 지난 분기 문구 불러오기 — 저장하지 않고 돌려주기만 한다. 화면에서 보고 고친 뒤 저장하게.
  if (body?.only === "previous") {
    const { data, error } = await supabase.from("allocation_mail_templates").select("period,subject,body");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const prev = previousTemplate((data ?? []) as MailTemplateRow[], period);
    if (!prev) {
      return NextResponse.json({ error: "이전 분기에 저장해 둔 문구가 없습니다." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, ...prev });
  }

  const reset = body?.reset === true;

  if (reset) {
    // 이번 분기 문구를 지우면 기본 문구로 돌아간다.
    const { error } = await supabase.from("allocation_mail_templates").delete().eq("period", period);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, reset: true });
  }

  const subject = String(body?.subject ?? "");
  const text = String(body?.body ?? "");
  const problem = mailTemplateProblem(subject, text);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const { error } = await supabase.from("allocation_mail_templates").upsert(
    { period, subject: subject.trim(), body: text, updated_at: new Date().toISOString() },
    { onConflict: "period" }
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
