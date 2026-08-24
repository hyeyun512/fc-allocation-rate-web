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
 * 로그인 유지 기간 8시간 — "로그인하고 8시간"이 아니라 **마지막으로 화면을 연 뒤 8시간**이다.
 * 미들웨어가 통과시킬 때마다 쿠키를 다시 심어 만료 시각을 뒤로 민다.
 *
 * 하루 업무 단위로 잡았다. 검토·확정은 표를 채우며 한참을 머무는 작업이라 몇 분짜리로 두면
 * 저장을 누르는 순간 만료되어 입력이 날아간다. 반대로 며칠씩 열어두면 CONFIDENTIAL 화면이
 * 자리를 뜬 PC에 그대로 남는다. 아침에 한 번 묻고 그날은 안 묻는 선이 그 사이다.
 *
 * 탭 전환은 브라우저 안에서 처리되어 서버를 부르지 않으므로 만료 시각도 밀리지 않는다.
 * 즉 한 화면을 8시간 넘게 열어둔 뒤 새로고침하면 다시 묻는다.
 */
export const AUTH_MAX_AGE = 60 * 60 * 8;

/**
 * 쿠키에 담는 값의 세대. 로그인 정책을 바꿨는데 이미 나간 쿠키가 옛 정책 그대로 살아 있으면
 * 곤란할 때 올린다 — 값이 달라지므로 기존 쿠키가 한 번에 무효가 되고 모두 다시 묻게 된다.
 *
 * v2: 유지 기간을 30일에서 8시간으로 줄이면서, 이미 30일짜리로 발급된 쿠키를 끊었다.
 *     기간만 줄이면 그 쿠키들은 다음 방문에 8시간으로 갱신될 뿐 당장은 그대로 열린다.
 */
const COOKIE_VERSION = "v2";

/** 쿠키에 담을 값. 암호를 그대로 두지 않고 세대와 함께 해시한다. */
export async function authCookieValue(password: string): Promise<string> {
  return sha256Hex(`${COOKIE_VERSION}:${password}`);
}

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
