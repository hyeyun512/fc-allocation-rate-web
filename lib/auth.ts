/**
 * 사이트 열람 암호 — 미들웨어(Edge)와 로그인 API가 함께 쓴다.
 *
 * ⚠️ 암호를 코드에 적지 않는다. 값은 환경변수 `SITE_PASSWORD`에만 둔다
 *    (로컬은 .env.local, 배포는 Vercel Settings > Environment Variables).
 *
 * 쿠키에는 암호가 아니라 그 해시를 담는다 — 쿠키를 들여다봐도 암호를 알 수 없게 하고,
 * 암호를 모르면 값을 만들어낼 수도 없다. 암호를 바꾸면 해시가 달라져 기존 쿠키는 자동으로 무효가 된다.
 */

/**
 * 같은 Supabase를 쓰는 fc-dashboard-web은 `fc_auth`를 쓴다. 배포 도메인이 달라 서로 간섭하지
 * 않지만 로컬에서는 둘 다 localhost로 뜬다 — 이름이 같으면 한쪽 로그인이 다른 쪽 쿠키를 덮어써
 * 암호가 맞는데도 튕기는 일이 생긴다. 그래서 이름을 갈라둔다.
 */
export const AUTH_COOKIE = "fc_alloc_auth";

/**
 * 로그인 유지 기간. 검토·확정 화면은 표를 채우며 한참을 머무는 작업이라 짧게 잡으면
 * 입력 도중 만료되어 작업이 날아간다. 기존 동작(30일)을 그대로 둔다.
 * 미들웨어가 통과시킬 때마다 쿠키를 다시 심어 만료 시각을 뒤로 민다.
 */
export const AUTH_MAX_AGE = 60 * 60 * 24 * 30;

/** Edge 런타임에도 있는 Web Crypto만 쓴다 (node:crypto는 미들웨어에서 못 쓴다). */
export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** 길이가 같은 두 16진 문자열을 앞에서부터 끊지 않고 비교한다 (맞은 자릿수로 암호를 좁히지 못하도록). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
