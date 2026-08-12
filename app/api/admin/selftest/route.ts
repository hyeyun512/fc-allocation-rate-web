import { NextResponse } from "next/server";
import { resolveManagerPair, OrgManagerRow } from "@/lib/orgManager";
import { linkOrgOf, linkTokenOf, tokenScopeOf, isTokenOwner, OrgLite } from "@/lib/orgLink";
import {
  normalizeEmail,
  isValidEmail,
  isAllowedDomain,
  buildLinkMail,
  insertLink,
  mailtoUrl,
  maskEmail,
  maskToken,
  mailTemplateProblem,
} from "@/lib/linkMail";
import { templateFor, previousTemplate, MailTemplateRow } from "@/lib/mailTemplateStore";

/**
 * 순수 함수 자가검증. 브라우저에서 /api/admin/selftest 를 열면 pass/fail이 나온다.
 *
 * 이 저장소에는 테스트 러너가 없다. 러너를 새로 들이면 CI가 없어 몇 달 뒤엔 아무도 안 돌린다 —
 * 대신 이미 있는 것(Next 라우트 + admin 인증 + tsc)을 그대로 써서 배포 확인 절차에 URL 한 줄로 박아둔다.
 *
 * **프로덕션에서는 404다.** 검증용 데이터가 응답에 실리므로 운영에 노출할 이유가 없다.
 */

export const dynamic = "force-dynamic";

interface Case {
  name: string;
  pass: boolean;
  got?: unknown;
  want?: unknown;
}

function eq(name: string, got: unknown, want: unknown): Case {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  return pass ? { name, pass } : { name, pass, got, want };
}

function ok(name: string, pass: boolean): Case {
  return { name, pass };
}

/* ── 검증용 조직 트리 ──
   개발 그룹(집계) → SW팀·HW팀 / HR실(집계) → HR팀 / 재무팀(단독)
   Staff(CEO) 직속은 ORG_LIFESPAN상 2026-Q1까지, 사업총괄대표는 HIDDEN_IN_CONFIRM. */
const ORGS: OrgLite[] = [
  { id: 1, basis: "개발 그룹", parent_basis: null, access_token: "tok-dev-000000001", active: true },
  { id: 2, basis: "SW팀", parent_basis: "개발 그룹", access_token: "tok-sw-0000000002", active: true },
  { id: 3, basis: "HW팀", parent_basis: "개발 그룹", access_token: "tok-hw-0000000003", active: true },
  { id: 4, basis: "재무팀", parent_basis: null, access_token: "tok-fin-000000004", active: true },
  { id: 5, basis: "폐지팀", parent_basis: null, access_token: "tok-old-000000005", active: false },
  { id: 6, basis: "사업그룹장", parent_basis: "사업 그룹", access_token: "tok-bl-0000000006", active: true },
  { id: 7, basis: "사업총괄대표", parent_basis: "사업 그룹", access_token: "tok-mir-000000007", active: true },
  { id: 8, basis: "사업 그룹", parent_basis: null, access_token: "tok-biz-000000008", active: true },
  { id: 9, basis: "Staff(CEO) 직속", parent_basis: null, access_token: "tok-ceo-000000009", active: true },
];

const Q3 = "2026-Q3";

function runCases(): Case[] {
  const c: Case[] = [];

  /* ── normalizeEmail / isValidEmail ── */
  c.push(eq("normalizeEmail trims+lowercases", normalizeEmail("  Hong@Company.COM "), "hong@company.com"));
  c.push(ok("isValidEmail accepts normal", isValidEmail("hong@company.com")));
  c.push(ok("isValidEmail rejects empty", !isValidEmail("")));
  c.push(ok("isValidEmail rejects no-tld", !isValidEmail("a@b")));
  c.push(ok("isValidEmail rejects space", !isValidEmail("a b@c.com")));
  c.push(ok("isValidEmail rejects comma list", !isValidEmail("a@c.com, d@e.com")));
  c.push(ok("isValidEmail rejects semicolon list", !isValidEmail("a@c.com;d@e.com")));
  c.push(ok("isValidEmail rejects non-ascii", !isValidEmail("한글@c.com")));
  c.push(ok("isValidEmail rejects >254", !isValidEmail("a".repeat(250) + "@c.com")));

  /* ── isAllowedDomain ── */
  c.push(ok("allowedDomain empty list passes", isAllowedDomain("x@any.com", [])));
  c.push(ok("allowedDomain exact", isAllowedDomain("x@company.com", ["company.com"])));
  c.push(ok("allowedDomain subdomain", isAllowedDomain("x@kr.company.com", ["company.com"])));
  c.push(ok("allowedDomain blocks outsider", !isAllowedDomain("x@evil.com", ["company.com"])));

  /* ── maskEmail / maskToken ── */
  c.push(eq("maskEmail", maskEmail("hong@company.com"), "h***@company.com"));
  c.push(eq("maskToken", maskToken("a1b2c3d4e5f6g7h8i9"), "…8i9"));

  /* ── 링크 삽입 ── 본문은 자유 텍스트이고, 조직마다 달라지는 링크만 서버가 채운다. */
  c.push(eq("link: placeholder position honoured", insertLink("앞\n{링크}\n뒤", "URL"), "앞\nURL\n뒤"));
  c.push(eq("link: appended when absent", insertLink("본문", "URL"), "본문\n\nURL"));
  c.push(eq("link: trailing blank lines collapsed", insertLink("본문\n\n\n", "URL"), "본문\n\nURL"));

  /* ── mailTemplateProblem ── 자리표시자는 더 이상 요구하지 않는다. */
  c.push(eq("tpl: plain text is fine", mailTemplateProblem("제목", "본문"), null));
  c.push(eq("tpl: no link placeholder required", mailTemplateProblem("제목", "링크 없는 본문"), null));
  c.push(ok("tpl: rejects empty subject", !!mailTemplateProblem("", "본문")));
  c.push(ok("tpl: rejects empty body", !!mailTemplateProblem("제목", "")));
  c.push(ok("tpl: rejects multiline subject", !!mailTemplateProblem("a\nb", "본문")));

  /* ── buildLinkMail ── */
  const saved = buildLinkMail({
    orgLabel: "개발 그룹",
    url: "https://x/submit/tok",
    lang: "ko",
    subject: "[협조요청] 26년 3Q",
    body: "안녕하세요.\n8/14(금)까지 부탁드립니다.",
  });
  c.push(eq("mail: uses the saved subject as-is", saved?.subject, "[협조요청] 26년 3Q"));
  c.push(ok("mail: link appended to saved body", (saved?.body ?? "").endsWith("https://x/submit/tok")));
  c.push(ok("mail: saved text kept verbatim", (saved?.body ?? "").startsWith("안녕하세요.")));

  // 적어 둔 문구가 없으면 빈 메일을 만들지 않는다 — 화면이 "문구를 먼저 저장하라"고 말하게 한다.
  c.push(eq("mail: no template -> null", buildLinkMail({ orgLabel: "개발 그룹", url: "u", lang: "ko" }), null));
  c.push(eq("mail: blank template -> null", buildLinkMail({ orgLabel: "개발 그룹", url: "u", lang: "ko", subject: " ", body: " " }), null));

  // 영어로 나가는 조직은 관리자가 적은 한국어 문구를 쓰지 않는다.
  const en = buildLinkMail({
    orgLabel: "HUK Expatriates",
    url: "https://x/submit/tok",
    lang: "en",
    subject: "무시되어야 함",
    body: "무시되어야 함",
  });
  c.push(ok("mail: en ignores the korean template", !(en?.body ?? "").includes("무시")));
  c.push(ok("mail: en has no korean", /[가-힣]/.test(en?.body ?? "") === false));
  c.push(ok("mail: en still carries the link", (en?.body ?? "").includes("https://x/submit/tok")));

  /* ── mailtoUrl ── */
  const url = mailtoUrl("a@b.com", "제목 x", "1줄\n2줄");
  c.push(ok("mailto encodes newline", url.includes("%0A")));
  c.push(ok("mailto has subject+body", url.includes("?subject=") && url.includes("&body=")));
  c.push(ok("mailto under 1800 chars", mailtoUrl("a@b.com", saved?.subject ?? "", saved?.body ?? "").length < 1800));
  // 수신인 여러 명은 쉼표로 잇되 쉼표 자체는 인코딩하지 않는다 — %2C면 Outlook이 주소 하나로 읽는다.
  const multi = mailtoUrl(["a@b.com", "c@d.com"], "s", "b");
  c.push(ok("mailto joins addresses with raw comma", multi.startsWith("mailto:a@b.com,c@d.com?")));
  c.push(ok("mailto does not encode the separator", !multi.includes("%2C")));

  /* ── linkOrgOf / linkTokenOf / tokenScopeOf ── */
  c.push(eq("child uses parent token", linkTokenOf(ORGS, 2, Q3), "tok-dev-000000001"));
  c.push(eq("standalone uses own token", linkTokenOf(ORGS, 4, Q3), "tok-fin-000000004"));
  c.push(eq("parent uses own token", linkTokenOf(ORGS, 1, Q3), "tok-dev-000000001"));
  c.push(eq("inactive org has no link", linkTokenOf(ORGS, 5, Q3), null));
  // 세 갈림길: HIDDEN(사업총괄대표)은 표에 없으므로 링크도 없다.
  c.push(eq("hidden org has no link", linkTokenOf(ORGS, 7, Q3), null));
  // 수명이 끝난 조직(Staff(CEO) 직속: ~2026-Q1)은 2026-Q3에 없다.
  c.push(eq("expired org has no link in Q3", linkTokenOf(ORGS, 9, Q3), null));
  c.push(eq("expired org has link in Q1", linkTokenOf(ORGS, 9, "2026-Q1"), "tok-ceo-000000009"));

  c.push(ok("parent is token owner", isTokenOwner(ORGS, 1, Q3)));
  c.push(ok("child is not token owner", !isTokenOwner(ORGS, 2, Q3)));
  c.push(ok("standalone is token owner", isTokenOwner(ORGS, 4, Q3)));

  c.push(eq("scope of 개발 그룹", tokenScopeOf(ORGS, 1, Q3).map((o) => o.id), [1, 2, 3]));
  c.push(eq("scope of 재무팀", tokenScopeOf(ORGS, 4, Q3).map((o) => o.id), [4]));
  // 사업 그룹의 하위 중 사업총괄대표(HIDDEN)는 수신자 후보에서 빠진다.
  c.push(eq("scope excludes hidden child", tokenScopeOf(ORGS, 8, Q3).map((o) => o.id), [8, 6]));
  c.push(eq("linkOrgOf returns owner object", linkOrgOf(ORGS, 3, Q3)?.basis, "개발 그룹"));

  /* ── resolveManagerPair ── */
  const M = (over: Partial<OrgManagerRow>): OrgManagerRow => ({
    org_id: 1,
    period: Q3,
    manager_name: "",
    manager_email: "",
    email_set_period: "",
    ...over,
  });

  // ① 이번 분기 행 — 이어받기 아님
  c.push(
    eq(
      "pair: this-quarter row is not inherited",
      (() => {
        const r = resolveManagerPair([M({ manager_name: "홍", manager_email: "h@c.com", email_set_period: Q3 })], 1, Q3);
        return [r.name, r.email, r.nameInherited, r.emailInherited];
      })(),
      ["홍", "h@c.com", false, false]
    )
  );

  // ② 직전 분기에서 값이 같은 행으로 함께 따라온다
  c.push(
    eq(
      "pair: inherits name+email from same row",
      (() => {
        const r = resolveManagerPair(
          [M({ period: "2026-Q2", manager_name: "홍", manager_email: "h@c.com", email_set_period: "2026-Q2" })],
          1,
          Q3
        );
        return [r.name, r.email, r.nameInherited, r.emailInherited, r.emailFromPeriod];
      })(),
      ["홍", "h@c.com", true, true, "2026-Q2"]
    )
  );

  // ③ 핵심: 이름만 이번 분기에 고쳐 저장 → 이름은 확정, 메일은 여전히 '이어받은 주소'
  c.push(
    eq(
      "pair: name saved now but email still from Q2",
      (() => {
        const r = resolveManagerPair(
          [M({ manager_name: "김", manager_email: "h@c.com", email_set_period: "2026-Q2" })],
          1,
          Q3
        );
        return [r.nameInherited, r.emailInherited, r.emailFromPeriod];
      })(),
      [false, true, "2026-Q2"]
    )
  );

  // ④ 이번 분기에 메일을 빈칸으로 저장 → 직전 분기 메일이 다시 딸려오지 않는다
  c.push(
    eq(
      "pair: emptied email does not re-inherit",
      (() => {
        const rows = [
          M({ period: "2026-Q2", manager_name: "홍", manager_email: "h@c.com", email_set_period: "2026-Q2" }),
          M({ period: Q3, manager_name: "홍", manager_email: "", email_set_period: "" }),
        ];
        const r = resolveManagerPair(rows, 1, Q3);
        return [r.email, r.emailInherited, r.emailFromPeriod];
      })(),
      ["", false, null]
    )
  );

  // ⑤ 직전 행의 이름이 비어 있으면 이어받기가 끊긴다 (이름·메일 둘 다)
  c.push(
    eq(
      "pair: blank name breaks the chain for both",
      (() => {
        const r = resolveManagerPair(
          [M({ period: "2026-Q2", manager_name: "", manager_email: "h@c.com", email_set_period: "2026-Q2" })],
          1,
          Q3
        );
        return [r.name, r.email, r.emailInherited];
      })(),
      ["", "", false]
    )
  );

  // ⑥ 분기 표기를 못 읽으면 엉뚱한 분기에서 값을 끌어오지 않는다
  c.push(
    eq(
      "pair: unparseable period yields empty",
      resolveManagerPair([M({ period: "2026-Q2", manager_name: "홍", manager_email: "h@c.com" })], 1, "임시").email,
      ""
    )
  );

  // ⑦ 마이그레이션 직후 상태 — 주소가 비어 있으면 이어받기 경고를 붙이지 않는다.
  //    (주소를 안 채운 채 분기가 넘어가면 전 조직이 이 상태가 된다.)
  c.push(
    eq(
      "pair: empty email is never flagged inherited",
      (() => {
        const r = resolveManagerPair(
          [M({ period: "2026-Q2", manager_name: "홍", manager_email: "", email_set_period: "" })],
          1,
          Q3
        );
        return [r.email, r.emailInherited, r.emailFromPeriod];
      })(),
      ["", false, null]
    )
  );

  /* ── 분기별 메일 문구 ── */
  const T: MailTemplateRow[] = [
    { period: "2026-Q2", subject: "q2", body: "b2" },
    { period: "2026-Q3", subject: "q3", body: "b3" },
  ];
  c.push(eq("mailTpl: this quarter", templateFor(T, "2026-Q3")?.subject, "q3"));
  c.push(eq("mailTpl: none saved for this quarter", templateFor(T, "2026-Q4"), null));
  // 새 분기에는 저장된 문구가 없어도 '전분기 불러오기'로 지난 분기 것을 가져올 수 있어야 한다.
  c.push(eq("mailTpl: previous from Q4 is Q3", previousTemplate(T, "2026-Q4")?.period, "2026-Q3"));
  c.push(eq("mailTpl: previous from Q3 is Q2", previousTemplate(T, "2026-Q3")?.period, "2026-Q2"));
  c.push(eq("mailTpl: nothing before Q2", previousTemplate(T, "2026-Q2"), null));
  c.push(eq("mailTpl: unparseable period has no previous", previousTemplate(T, "임시"), null));

  return c;
}

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse("Not found", { status: 404 });
  }
  const cases = runCases();
  const failed = cases.filter((c) => !c.pass);
  return NextResponse.json(
    {
      pass: cases.length - failed.length,
      fail: failed.length,
      failures: failed,
    },
    { status: failed.length ? 500 : 200 }
  );
}
