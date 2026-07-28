import { NextResponse } from "next/server";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set("admin_pw", "", { path: "/", maxAge: 0 });
  return res;
}
