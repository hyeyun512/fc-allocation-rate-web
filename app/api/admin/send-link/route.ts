import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveManagerPair, OrgManagerRow } from "@/lib/orgManager";
import { linkOrgOf, tokenScopeOf, linkOpensChildren, isInSurvey, OrgLite } from "@/lib/orgLink";
import { submitLangOf, orgLabelFor } from "@/lib/englishOrgs";
import {
  buildLinkMail,
  mailtoUrl,
  isValidEmail,
  isAllowedDomain,
  parseAllowedDomains,
  maskEmail,
  maskToken,
} from "@/lib/linkMail";

/**
 * 조사 링크 안내 메일의 **초안을 만들어 돌려준다** (실제 발송은 관리자가 Outlook에서 누른다).
 *
 * 이 라우트가 존재하는 이유는 하나다: **수신자를 클라이언트가 정하지 못하게 하기 위해서다.**
 * 주소를 화면이 들고 있으면 화면이 아무 주소로나 링크를 보낼 수 있다. 조사 링크는 그 자체가
 * 자격증명이라(토큰만 알면 인증 없이 입력 화면이 열린다) 그건 곧 열람 권한을 넘기는 일이다.
 * 그래서 body는 **조직 id만** 받고, 주소는 서버가 DB에서 찾고, 보낼 수 있는 대상은
 * 그 토큰의 범위 안으로 서버가 강제한다.
 *
 * 인증은 middleware.ts가 /api/admin/* 전체에 걸어둔 admin_pw 쿠키다(없으면 401).
 *
 * 검사 순서를 아래 번호대로 고정한다 — 순서가 정해져 있지 않으면 400이 엉뚱한 이유로 떨어져도
 * 테스트가 통과해 버린다.
 */

interface Recipient {
  orgId: number;
  orgLabel: string;
  managerName: string;
  to: string;
  /** 이번 분기에 사람이 확인하지 않은 주소인지 — 화면이 경고를 띄우는 기준. */
  emailInherited: boolean;
  emailFromPeriod: string | null;
}

interface Skipped {
  orgId: number;
  orgLabel: string;
  reason: "no-email" | "invalid-email" | "blocked-domain";
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);

  // ── 2. 형식 + 마감 안내 검증
  const orgIds: unknown = body?.orgIds;
  const period = typeof body?.period === "string" ? body.period : "";
  if (!Array.isArray(orgIds) || orgIds.length === 0 || !period) {
    return NextResponse.json({ error: "조직과 기간이 필요합니다.", code: "bad-request" }, { status: 400 });
  }

  // ── 3. 링크에 박을 정규 도메인. 복사 버튼과 달리 메일에 담긴 링크는 남으므로,
  //      프리뷰 배포 주소가 들어가면 그 배포가 정리될 때 수신자 손의 링크가 죽는다.
  const baseUrl = String(process.env.PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (!baseUrl) {
    return NextResponse.json(
      { error: "PUBLIC_BASE_URL이 설정되지 않았습니다. 배포 환경변수를 확인해 주세요.", code: "no-base-url" },
      { status: 500 }
    );
  }

  const supabase = getSupabaseAdmin();
  const [{ data: orgRows }, { data: managerRows }, { data: tpl }] = await Promise.all([
    supabase.from("allocation_orgs").select("id,basis,parent_basis,access_token,active"),
    supabase.from("allocation_org_managers").select("org_id,period,manager_name,manager_email,email_set_period"),
    supabase.from("allocation_mail_templates").select("period,subject,body").eq("period", period).maybeSingle(),
  ]);

  const orgs = (orgRows ?? []) as OrgLite[];
  const managers = (managerRows ?? []) as OrgManagerRow[];
  const allowedDomains = parseAllowedDomains(process.env.MAIL_ALLOWED_DOMAINS);

  const requestedRecipients: number[] | null = Array.isArray(body?.recipientOrgIds)
    ? body.recipientOrgIds.map(Number)
    : null;

  const results = [];

  for (const raw of orgIds) {
    const orgId = Number(raw);
    const org = orgs.find((o) => o.id === orgId);

    // ── 5. 이번 분기 조사 대상인가 (active · 조직 수명 · 자동계산으로 감춘 조직)
    if (!org || !isInSurvey(org, period)) {
      return NextResponse.json(
        { error: "이번 분기 조사 대상이 아닌 조직입니다.", code: "org-not-in-survey", orgId },
        { status: 400 }
      );
    }

    // ── 4. 발송 단위는 '행'이 아니라 '토큰'이다. 하위 팀에는 자기 링크가 없으므로
    //      하위 팀 id로는 발송할 수 없다 — 상위 조직 id로 보내고 수신자로 골라야 한다.
    const linkOrg = linkOrgOf(orgs, orgId, period);
    if (!linkOrg || linkOrg.id !== orgId) {
      return NextResponse.json(
        {
          error: "이 조직은 자기 조사 링크를 갖고 있지 않습니다. 상위 조직에서 발송해 주세요.",
          code: "not-a-token-org",
          orgId,
          tokenOrgId: linkOrg?.id ?? null,
        },
        { status: 400 }
      );
    }

    // ── 6. 수신자 후보는 이 토큰이 여는 범위로 서버가 못박는다.
    const scope = tokenScopeOf(orgs, linkOrg.id, period);
    const scopeIds = new Set(scope.map((o) => o.id));

    let targets = scope;
    if (requestedRecipients) {
      const outOfScope = requestedRecipients.find((id) => !scopeIds.has(id));
      if (outOfScope !== undefined) {
        return NextResponse.json(
          { error: "이 링크의 범위 밖 조직은 수신자로 지정할 수 없습니다.", code: "recipient-out-of-scope", orgId: outOfScope },
          { status: 400 }
        );
      }
      targets = scope.filter((o) => requestedRecipients.includes(o.id));
    } else {
      // 기본값: 링크 주인에게 메일이 있으면 그 한 사람, 없으면(HR실·Staff(CEO)처럼) 범위 안 전원.
      const ownerPair = resolveManagerPair(managers, linkOrg.id, period);
      targets = ownerPair.email ? scope.filter((o) => o.id === linkOrg.id) : scope;
    }

    // ── 9. 본문은 '이 링크가 무엇을 여는지'를 사실대로 말해야 한다.
    //      링크 화면 기준(parent_basis + active)으로 센다 — 조사 표에서 감춰진 조직도 링크에는 뜬다.
    const opensOthers = linkOpensChildren(orgs, linkOrg.id);
    const url = `${baseUrl}/submit/${linkOrg.access_token}`;

    const recipients: Recipient[] = [];
    const skipped: Skipped[] = [];

    for (const target of targets) {
      const targetLabel = orgLabelFor(target.basis, submitLangOf(target.basis));

      // ── 7. 주소는 body가 아니라 DB에서. 클라이언트가 보낸 to/email은 읽지도 않는다.
      const pair = resolveManagerPair(managers, target.id, period);
      if (!pair.email) {
        skipped.push({ orgId: target.id, orgLabel: targetLabel, reason: "no-email" });
        continue;
      }
      if (!isValidEmail(pair.email)) {
        skipped.push({ orgId: target.id, orgLabel: targetLabel, reason: "invalid-email" });
        continue;
      }
      // 도메인 가드는 저장 때만이 아니라 발송 직전에도 본다 — 가드를 나중에 켜는 것이
      // 계획된 경로라, 저장 시점만 검사하면 그 전에 들어온 사외 주소가 영원히 통과한다.
      if (!isAllowedDomain(pair.email, allowedDomains)) {
        skipped.push({ orgId: target.id, orgLabel: targetLabel, reason: "blocked-domain" });
        continue;
      }

      recipients.push({
        orgId: target.id,
        orgLabel: targetLabel,
        managerName: pair.name,
        to: pair.email,
        emailInherited: pair.emailInherited,
        emailFromPeriod: pair.emailFromPeriod,
      });
    }

    // 같은 링크를 쓰는 담당자는 **한 통에 함께** 넣는다 — 수신인 줄에 서로 보이고, 초안도 하나로 끝난다.
    // 언어·조직 표기는 링크 주인 기준이다(메일 한 통이 그 링크 하나를 안내하므로).
    const lang = submitLangOf(linkOrg.basis);
    const mail = recipients.length
      ? buildLinkMail({
          orgLabel: orgLabelFor(linkOrg.basis, lang),
          url,
          lang,
          // 관리자가 이번 분기에 적어 둔 문구. 영어로 나가는 조직에는 적용하지 않는다.
          subject: lang === "ko" ? tpl?.subject ?? null : null,
          bodyHtml: lang === "ko" ? tpl?.body ?? null : null,
        })
      : null;

    // 한국어 조직인데 적어 둔 문구가 없으면 빈 메일이 나갈 뻔한 것이다 — 만들지 않고 알린다.
    if (recipients.length && !mail) {
      return NextResponse.json(
        {
          error: "이번 분기 메일 제목·본문이 저장되어 있지 않습니다. 조사 화면에서 문구를 저장한 뒤 보내 주세요.",
          code: "no-mail-template",
        },
        { status: 400 }
      );
    }

    // ── 10. 로그는 '발송'이 아니라 '초안을 열었다'는 사실만 남긴다. 보낸 것은 사람이지 서버가 아니다.
    //       토큰·주소 전체는 남기지 않는다 (로그를 볼 수 있는 사람이 곧 그 조직 화면을 열 수 있게 된다).
    console.warn(
      `[send-link] token=${maskToken(linkOrg.access_token)} org=${linkOrg.basis} period=${period} ` +
        `recipients=${recipients.length} skipped=${skipped.length} ` +
        `to=${recipients.map((r) => maskEmail(r.to)).join(",")} transport=mailto action=draft_prepared`
    );

    results.push({
      tokenOrgId: linkOrg.id,
      tokenOrgLabel: linkOrg.basis,
      opensOthers,
      // 초안 하나에 수신인 여러 명. mailto는 쉼표로 여러 주소를 받는다.
      to: recipients.map((r) => r.to),
      subject: mail?.subject ?? "",
      // 초안(mailto)에는 평문만 담을 수 있다. 서식이 살아 있는 본문은 화면이 클립보드로 넘긴다.
      body: mail?.text ?? "",
      bodyHtml: mail?.html ?? "",
      mailtoUrl: mail ? mailtoUrl(recipients.map((r) => r.to), mail.subject, mail.text) : null,
      recipients,
      skipped,
    });
  }

  return NextResponse.json({ transport: "mailto", results });
}
