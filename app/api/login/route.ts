import { NextResponse } from "next/server";
import { AUTH_COOKIE, AUTH_MAX_AGE, authCookieValue } from "@/lib/auth";

/** 암호를 확인하고 통과하면 열람 쿠키를 심는다. 실패 응답은 이유를 구분해 로그인 화면이 안내하도록 한다. */
export async function POST(req: Request) {
  const expected = process.env.SITE_PASSWORD;
  if (!expected) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  let password = "";
  try {
    password = String(((await req.json()) as { password?: unknown }).password ?? "");
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  if (password !== expected) {
    return NextResponse.json({ error: "invalid" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, await authCookieValue(expected), {
    httpOnly: true,                                   // 스크립트로 쿠키를 훔쳐가지 못하게 한다
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",    // 로컬 http에서도 로그인되도록 개발에서는 끈다
    path: "/",
    maxAge: AUTH_MAX_AGE,
  });
  return res;
}
