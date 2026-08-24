import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveManagerPair, OrgManagerRow } from "@/lib/orgManager";
import { normalizeEmail, isValidEmail, isAllowedDomain, parseAllowedDomains } from "@/lib/linkMail";

/**
 * 조사 현황의 '담당자' 이름·메일 저장 (분기별).
 *
 * 빈칸으로 저장해도 행을 남긴다 — 행이 있다는 것 자체가 '이 분기 담당자는 직접 정했다'는 표시라
 * 지난 분기 담당자가 다시 딸려오지 않는다 (이어받기 규칙은 lib/orgManager.ts).
 *
 * 이름과 메일은 한 행이므로 **한쪽만 저장해도 다른 쪽을 함께 굳혀야 한다.** 안 그러면 그 분기 행이
 * 처음 생길 때 손대지 않은 칸이 기본값 ''로 들어가 이어받고 있던 값이 사라진다.
 * 다만 손대지 않은 메일은 **값만 옮기고 출처(email_set_period)는 원래 분기를 유지한다** —
 * 이름만 고쳤을 뿐인데 전임자 주소가 '이번 분기에 확인한 주소'로 승격되면 경고 없이 발송된다.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { orgId, period } = body ?? {};

  if (!orgId || !period) {
    return NextResponse.json({ error: "조직과 기간이 필요합니다." }, { status: 400 });
  }

  // ??(nullish)가 아니라 '키가 왔는가'로 판정한다 — ""(의도적 비우기)는 정식 사용법이라
  // ??로 걸러내면 빈 이름 + 전임자 주소라는 행이 만들어진다.
  const touchedName = Object.prototype.hasOwnProperty.call(body, "name");
  const touchedEmail = Object.prototype.hasOwnProperty.call(body, "email");
  if (!touchedName && !touchedEmail) {
    return NextResponse.json({ error: "저장할 값이 없습니다." }, { status: 400 });
  }

  const nextName = touchedName ? String(body.name ?? "").trim() : null;
  const nextEmail = touchedEmail ? normalizeEmail(String(body.email ?? "")) : null;

  if (nextName !== null && nextName.length > 100) {
    return NextResponse.json({ error: "담당자 이름이 너무 깁니다 (100자 이내)." }, { status: 400 });
  }
  if (nextEmail !== null && nextEmail !== "") {
    if (nextEmail.length > 254 || !isValidEmail(nextEmail)) {
      return NextResponse.json({ error: "메일 주소 형식이 올바르지 않습니다." }, { status: 400 });
    }
    const allowed = parseAllowedDomains(process.env.MAIL_ALLOWED_DOMAINS);
    if (!isAllowedDomain(nextEmail, allowed)) {
      return NextResponse.json({ error: "사내 도메인 주소만 저장할 수 있습니다." }, { status: 400 });
    }
  }

  const supabase = getSupabaseAdmin();

  // 지금 화면에 보이는 값(이번 분기 행이 없으면 이어받은 값)을 서버에서 다시 구해 머지한다.
  const { data: rows, error: readError } = await supabase
    .from("allocation_org_managers")
    .select("org_id,period,manager_name,manager_email,email_set_period")
    .eq("org_id", orgId);

  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });

  const current = resolveManagerPair((rows ?? []) as OrgManagerRow[], Number(orgId), period);

  const name = touchedName ? (nextName as string) : current.name;
  const email = touchedEmail ? (nextEmail as string) : current.email;
  // 손대지 않았으면 원래 출처를 유지한다. 값이 비어 있으면 출처도 비운다.
  const emailSetPeriod = touchedEmail ? (email === "" ? "" : period) : current.emailFromPeriod ?? "";

  const { error } = await supabase.from("allocation_org_managers").upsert(
    {
      org_id: orgId,
      period,
      manager_name: name,
      manager_email: email,
      email_set_period: emailSetPeriod,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id,period" }
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    name,
    email,
    // 저장 직후 화면이 '이어받은 주소' 표시를 바로 갱신할 수 있게 돌려준다.
    emailInherited: email !== "" && emailSetPeriod !== period,
    emailFromPeriod: email === "" ? null : emailSetPeriod,
  });
}
