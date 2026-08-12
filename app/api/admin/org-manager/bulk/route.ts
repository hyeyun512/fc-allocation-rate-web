import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveManagerPair, OrgManagerRow } from "@/lib/orgManager";
import { matchPastedManagers, applicableRows, PasteOrg } from "@/lib/managerPaste";
import { isAllowedDomain, parseAllowedDomains } from "@/lib/linkMail";

/**
 * 엑셀에서 붙여넣은 담당자 이름·메일을 한 번에 저장한다.
 *
 * 화면이 이미 미리보기로 판정을 보여주지만, **판정은 서버에서 다시 한다** —
 * 화면이 보낸 orgId를 그대로 믿으면 미리보기와 다른 값이 저장될 수 있다.
 * 그래서 붙여넣은 표 원문을 받아 서버가 조직을 다시 맞춘다(같은 순수 함수를 쓴다).
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const grid: unknown = body?.grid;
  const period = typeof body?.period === "string" ? body.period.trim() : "";

  if (!Array.isArray(grid) || !period) {
    return NextResponse.json({ error: "붙여넣은 내용과 기간이 필요합니다." }, { status: 400 });
  }
  if (grid.length > 500) {
    return NextResponse.json({ error: "한 번에 500줄까지만 붙여넣을 수 있습니다." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const [{ data: orgRows }, { data: managerRows }] = await Promise.all([
    supabase.from("allocation_orgs").select("id,basis").eq("active", true),
    supabase.from("allocation_org_managers").select("org_id,period,manager_name,manager_email,email_set_period"),
  ]);

  const managers = (managerRows ?? []) as OrgManagerRow[];
  const orgs: PasteOrg[] = (orgRows ?? []).map((o: any) => {
    const cur = resolveManagerPair(managers, o.id, period);
    return { id: o.id, basis: o.basis, currentName: cur.name, currentEmail: cur.email };
  });

  const cleanGrid = (grid as unknown[]).map((row) =>
    Array.isArray(row) ? row.map((c) => String(c ?? "")) : [String(row ?? "")]
  );

  const matches = matchPastedManagers(cleanGrid, orgs);
  const allowed = parseAllowedDomains(process.env.MAIL_ALLOWED_DOMAINS);

  const saved: { orgBasis: string; name: string; email: string }[] = [];
  const blocked: { orgBasis: string; email: string }[] = [];

  for (const m of applicableRows(matches)) {
    if (m.email !== "" && !isAllowedDomain(m.email, allowed)) {
      blocked.push({ orgBasis: m.orgBasis, email: m.email });
      continue;
    }

    // 단건 저장과 같은 규칙 — 붙여넣지 않은 칸은 지금 값을 그대로 굳히고, 메일을 실제로
    // 새로 넣은 경우에만 '이번 분기에 확인한 주소'로 출처를 갱신한다.
    const cur = resolveManagerPair(managers, m.orgId as number, period);
    const touchedEmail = m.email !== "" && m.email !== cur.email;
    const name = m.name !== "" ? m.name : cur.name;
    const email = m.email !== "" ? m.email : cur.email;

    const { error } = await supabase.from("allocation_org_managers").upsert(
      {
        org_id: m.orgId,
        period,
        manager_name: name,
        manager_email: email,
        email_set_period: touchedEmail ? period : cur.emailFromPeriod ?? "",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "org_id,period" }
    );

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    saved.push({ orgBasis: m.orgBasis, name, email });
  }

  return NextResponse.json({
    ok: true,
    savedCount: saved.length,
    saved,
    blocked,
    skipped: matches.filter((m) => m.status !== "ok").map((m) => ({ org: m.inputOrg, status: m.status })),
  });
}
