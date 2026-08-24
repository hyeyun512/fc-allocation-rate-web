import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, AUTH_MAX_AGE, sha256Hex, timingSafeEqual } from "@/lib/auth";

/**
 * 암호를 통과하지 못하면 **서버에서** 막는다.
 *
 * 화면단에서 가리는 방식으로는 소용이 없다 — 검토/확정 화면은 Supabase에서 읽은 조직·인원·배부율을
 * 서버에서 HTML로 그려 내려주므로, 화면만 가려도 '페이지 소스 보기'에 실데이터가 그대로 남는다.
 * 미들웨어에서 막으면 암호가 없는 요청에는 데이터가 담긴 HTML 자체가 만들어지지 않는다.
 *
 * 암호는 환경변수 `SITE_PASSWORD`에 둔다. 값이 없으면 열어두지 않고 막는다 —
 * 설정을 빠뜨렸을 때 조용히 무방비로 공개되는 쪽이 훨씬 위험하기 때문이다(로그인 화면이 안내한다).
 */
export async function middleware(req: NextRequest) {
  const expected = process.env.SITE_PASSWORD;
  const cookie = req.cookies.get(AUTH_COOKIE)?.value;

  if (expected && cookie && timingSafeEqual(cookie, await sha256Hex(expected))) {
    // 볼 때마다 만료 시각을 뒤로 민다 — "로그인하고 N일"이 아니라 "마지막으로 연 뒤 N일"이어야 한다.
    const res = NextResponse.next();
    res.cookies.set(AUTH_COOKIE, cookie, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: AUTH_MAX_AGE,
    });
    return res;
  }

  // API는 로그인 화면으로 돌려보내야 소용이 없다. 화면이 실패를 알아볼 수 있게 401을 준다.
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  // 로그인 뒤 원래 보려던 곳으로 돌려보낸다.
  url.searchParams.set("from", req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  /**
   * 막지 않는 곳:
   *  - login / api/login  : 막으면 로그인 자체를 할 수 없다.
   *  - api/logout
   *      막아도 얻는 게 없고(자기 쿠키를 지우는 일이다), 오히려 해롭다 — 미들웨어가 통과시키며
   *      쿠키를 다시 심으므로 한 응답에 '갱신'과 '삭제' Set-Cookie가 겹쳐 로그아웃이 먹지 않는다.
   *  - submit / api/submissions
   *      조직별 조사 링크(/submit/<토큰>)는 부서 담당자에게 메일로 나간다. 여기까지 암호를 걸면
   *      전 부서에 암호를 돌려야 하고, 그러면 토큰 하나가 곧 그 조직의 자격증명이라는 설계가 무너진다.
   *      이 경로의 인증은 토큰 자체가 맡는다(토큰을 모르면 열리지 않는다).
   *  - _next/static, _next/image, favicon.ico : 정적 파일.
   */
  matcher: [
    "/((?!login|api/login|api/logout|submit|api/submissions|_next/static|_next/image|favicon.ico).*)",
  ],
};
