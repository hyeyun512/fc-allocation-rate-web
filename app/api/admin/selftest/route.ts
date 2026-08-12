import { NextResponse } from "next/server";
import { resolveManagerPair, OrgManagerRow } from "@/lib/orgManager";
import { linkOrgOf, linkTokenOf, tokenScopeOf, isTokenOwner, OrgLite } from "@/lib/orgLink";
import {
  normalizeEmail,
  isValidEmail,
  isAllowedDomain,
  isValidDeadline,
  buildLinkMail,
  mailtoUrl,
  maskEmail,
  maskToken,
  renderMailTemplate,
  mailTemplateProblem,
  DEFAULT_MAIL_SUBJECT,
  DEFAULT_MAIL_BODY,
} from "@/lib/linkMail";
import { matchPastedManagers, applicableRows, buildPasteTemplate, PasteOrg } from "@/lib/managerPaste";
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

  /* ── isValidDeadline ── */
  c.push(ok("deadline allows spaces", isValidDeadline("9월 30일까지")));
  c.push(ok("deadline allows empty", isValidDeadline("")));
  c.push(ok("deadline rejects 41 chars", !isValidDeadline("a".repeat(41))));
  c.push(ok("deadline rejects newline", !isValidDeadline("9월\n30일")));
  c.push(ok("deadline rejects url", !isValidDeadline("http://x.com 까지")));
  c.push(ok("deadline rejects www", !isValidDeadline("www.x.com 까지")));

  /* ── maskEmail / maskToken ── */
  c.push(eq("maskEmail", maskEmail("hong@company.com"), "h***@company.com"));
  c.push(eq("maskToken", maskToken("a1b2c3d4e5f6g7h8i9"), "…8i9"));

  /* ── renderMailTemplate ── */
  c.push(eq("template substitutes", renderMailTemplate("가 {조직} 나", { "{조직}": "HR실" }), "가 HR실 나"));
  // 값이 빈 자리표시자가 든 줄은 통째로 빠진다 — 마감을 비웠을 때 "· 입력 마감:"만 남지 않게.
  c.push(eq("template drops line with empty var", renderMailTemplate("a\n· 마감: {마감}\nb", { "{마감}": "" }), "a\nb"));
  c.push(eq("template keeps line with filled var", renderMailTemplate("· 마감: {마감}", { "{마감}": "내일" }), "· 마감: 내일"));
  c.push(eq("template repeats same var", renderMailTemplate("{조직}/{조직}", { "{조직}": "X" }), "X/X"));

  /* ── mailTemplateProblem ── */
  c.push(eq("template ok", mailTemplateProblem(DEFAULT_MAIL_SUBJECT, DEFAULT_MAIL_BODY), null));
  c.push(ok("template rejects empty subject", !!mailTemplateProblem("", DEFAULT_MAIL_BODY)));
  c.push(ok("template rejects multiline subject", !!mailTemplateProblem("a\nb", DEFAULT_MAIL_BODY)));
  c.push(ok("template rejects body without link", !!mailTemplateProblem(DEFAULT_MAIL_SUBJECT, "링크 없는 본문")));

  /* ── buildLinkMail ── */
  const koSolo = buildLinkMail({
    orgLabel: "재무팀",
    recipientNames: ["홍길동"],
    period: Q3,
    url: "https://x/submit/tok",
    lang: "ko",
    opensOthers: false,
  });
  // 기본 문구는 실제로 쓰던 협조요청 메일이다 — 분기 표기가 그 형식(26년 3Q / 3분기)대로 채워져야 한다.
  c.push(eq("default subject is the real mail's", koSolo.subject, "[협조요청] 부서별 투입리소스 작성 (26년 3Q)"));
  c.push(ok("default keeps the original greeting", koSolo.body.startsWith("안녕하세요,")));
  c.push(ok("default names the sender", koSolo.body.includes("경영지원실 주혜윤입니다.")));
  c.push(ok("default says N분기", koSolo.body.includes("3분기 리소스 배부율")));
  c.push(ok("ko solo says 전용", koSolo.body.includes("재무팀 전용입니다")));
  c.push(ok("ko url appears exactly once", koSolo.body.split("https://x/submit/tok").length - 1 === 1));
  // 기한을 정하지 않았으면 줄이 사라지는 게 아니라 '재설정 필요'가 찍혀야 한다.
  c.push(ok("unset deadline shows 재설정 필요", koSolo.body.includes("제출 기한: 재설정 필요")));
  c.push(ok("body has no CR", !koSolo.body.includes("\r")));

  const koWide = buildLinkMail({
    orgLabel: "HR실",
    recipientNames: ["이채아 팀장", "최광수 팀장"],
    period: Q3,
    url: "https://x/submit/tok",
    lang: "ko",
    deadline: "9월 30일까지",
    opensOthers: true,
  });
  // 상위 조직 링크는 하위 팀 전체를 여는 광역 링크다 — "전용"이라 쓰면 거짓말이 된다.
  c.push(ok("wide link never says 전용", !koWide.body.includes("전용")));
  c.push(ok("wide link names the owner org", koWide.body.includes("HR실과 그 하위 조직 전체")));
  c.push(ok("deadline line appears when set", koWide.body.includes("제출 기한: 9월 30일까지")));

  // 관리자가 화면에서 고친 문구가 있으면 그것을 쓴다.
  const koCustom = buildLinkMail({
    orgLabel: "재무팀",
    recipientNames: ["홍길동"],
    period: Q3,
    url: "https://x/submit/tok",
    lang: "ko",
    opensOthers: false,
    subjectTemplate: "{조직} 조사 부탁드립니다",
    bodyTemplate: "{담당자} 안녕하세요\n{링크}",
  });
  c.push(eq("custom subject used", koCustom.subject, "재무팀 조사 부탁드립니다"));
  c.push(eq("custom body used", koCustom.body, "홍길동님 안녕하세요\nhttps://x/submit/tok"));

  const koNoName = buildLinkMail({
    orgLabel: "재무팀",
    recipientNames: [],
    period: Q3,
    url: "https://x/submit/tok",
    lang: "ko",
    opensOthers: false,
  });
  c.push(ok("no recipient name still renders", koNoName.body.includes("https://x/submit/tok")));

  // {담당자}를 쓰는 문구에서는 수신자 여러 명이 함께 들어가고, 이름이 없으면 그 줄이 통째로 빠진다
  // (", 님." 같은 문장이 나가지 않게).
  const twoNames = buildLinkMail({
    orgLabel: "HR실",
    recipientNames: ["이채아 팀장", "최광수 팀장"],
    period: Q3,
    url: "https://x/submit/tok",
    lang: "ko",
    opensOthers: true,
    subjectTemplate: "s",
    bodyTemplate: "안녕하세요, {담당자}.\n{링크}",
  });
  c.push(eq("both recipients in one greeting", twoNames.body, "안녕하세요, 이채아 팀장님, 최광수 팀장님.\nhttps://x/submit/tok"));

  const zeroNames = buildLinkMail({
    orgLabel: "재무팀",
    recipientNames: [],
    period: Q3,
    url: "https://x/submit/tok",
    lang: "ko",
    opensOthers: false,
    subjectTemplate: "s",
    bodyTemplate: "안녕하세요, {담당자}.\n{링크}",
  });
  c.push(eq("empty name drops that line", zeroNames.body, "https://x/submit/tok"));

  /* ── 분기 자리표시자 ── 분기가 바뀌면 문구가 저절로 따라가야 한다. */
  const q4 = buildLinkMail({
    orgLabel: "재무팀",
    recipientNames: [],
    period: "2026-Q4",
    url: "https://x/submit/tok",
    lang: "ko",
    opensOthers: false,
  });
  c.push(eq("next quarter subject follows", q4.subject, "[협조요청] 부서별 투입리소스 작성 (26년 4Q)"));
  c.push(ok("next quarter body follows", q4.body.includes("4분기 리소스 배부율")));
  c.push(ok("next quarter deadline needs resetting", q4.body.includes("제출 기한: 재설정 필요")));

  const en = buildLinkMail({
    orgLabel: "HUK Expatriates",
    recipientNames: ["John"],
    period: Q3,
    url: "https://x/submit/tok",
    lang: "en",
    opensOthers: false,
    // 영어 조직에는 한국어 문구를 적용하지 않는다.
    subjectTemplate: "무시되어야 함",
    bodyTemplate: "무시되어야 함 {링크}",
  });
  c.push(ok("en subject is english", en.subject.startsWith("[Resource Allocation]")));
  c.push(ok("en body is english", en.body.startsWith("Hello John,")));
  c.push(ok("en has no korean", !/[가-힣]/.test(en.body)));

  /* ── mailtoUrl ── */
  const url = mailtoUrl("a@b.com", "제목 x", "1줄\n2줄");
  c.push(ok("mailto encodes newline", url.includes("%0A")));
  c.push(ok("mailto has subject+body", url.includes("?subject=") && url.includes("&body=")));
  c.push(ok("mailto under 1800 chars", mailtoUrl("a@b.com", koWide.subject, koWide.body).length < 1800));
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

  /* ── 엑셀 붙여넣기 ── */
  const P: PasteOrg[] = [
    { id: 1, basis: "개발 그룹", currentName: "오인희 그룹장", currentEmail: "" },
    { id: 4, basis: "재무팀", currentName: "박재무", currentEmail: "park@company.com" },
  ];
  const pm = (grid: string[][]) => matchPastedManagers(grid, P);

  c.push(eq("paste: matches org + email", pm([["개발 그룹", "오인희 그룹장", "oh@company.com"]])[0].status, "ok"));
  // 열 순서가 달라도 읽는다 — 사람이 순서를 맞추게 하면 그 자체가 또 일이다.
  c.push(eq("paste: column order free", pm([["oh@company.com", "개발 그룹"]])[0].orgBasis, "개발 그룹"));
  c.push(eq("paste: normalizes org spacing", pm([["개발그룹", "oh@company.com"]])[0].orgId, 1));
  c.push(eq("paste: unknown org", pm([["없는조직", "x@company.com"]])[0].status, "no-org"));
  c.push(eq("paste: header row skipped", pm([["조직", "담당자", "Outlook 메일"]]).length, 0));
  c.push(eq("paste: unchanged row is 'same'", pm([["재무팀", "박재무", "park@company.com"]])[0].status, "same"));

  // 실제로 났던 사고: @를 빠뜨린 주소가 조용히 '담당자 이름'으로 저장됐다.
  const broken = pm([["재무팀", "", "not-an-email"]])[0];
  c.push(eq("paste: broken email is not saved as a name", broken.status, "bad-email"));
  c.push(ok("paste: broken email never becomes the name", broken.name !== "not-an-email"));
  const brokenDotted = pm([["재무팀", "hong.gildong.company.com"]])[0];
  c.push(eq("paste: dotted non-email flagged too", brokenDotted.status, "bad-email"));
  // 사람 이름은 이름으로 남아야 한다 (과잉 차단 방지).
  c.push(eq("paste: real name still reads as a name", pm([["재무팀", "홍길동", "hong@company.com"]])[0].name, "홍길동"));

  // 머리글이 있으면 열 위치를 그대로 믿는다.
  const withHeader = pm([
    ["조직", "담당자", "Outlook 메일"],
    ["재무팀", "김재무", "kim@company.com"],
  ]);
  c.push(eq("paste: header locks columns", [withHeader.length, withHeader[0].name, withHeader[0].email], [1, "김재무", "kim@company.com"]));

  c.push(eq("paste: applicable filters to ok only", applicableRows(pm([
    ["개발 그룹", "oh@company.com"],
    ["재무팀", "박재무", "park@company.com"],
    ["없는조직", "x@company.com"],
  ])).length, 1));

  c.push(ok("paste: template has header + rows", buildPasteTemplate(P).split("\n").length === 3));

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
