import { createClient } from "@supabase/supabase-js";

/**
 * 서버 전용 Supabase 클라이언트 (service_role 키 사용, RLS 우회).
 * 이 파일은 절대 클라이언트 컴포넌트에서 import 하면 안 됩니다.
 * SUPABASE_SERVICE_ROLE_KEY 는 NEXT_PUBLIC_ 접두사가 없으므로 브라우저 번들에 포함되지 않습니다.
 * 이 프로젝트는 브라우저에서 Supabase에 직접 접근하지 않고, 모든 읽기/쓰기를 Next.js API route를 통해서만 수행합니다.
 */
function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `환경변수 ${name} 가 설정되지 않았습니다. .env.local (로컬) 또는 Vercel 프로젝트 Settings > Environment Variables 에 추가하세요.`
    );
  }
  return v;
}

export function getSupabaseAdmin() {
  const url = getEnv("SUPABASE_URL");
  const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    // Next.js는 전역 fetch를 패치해 기본적으로 캐싱을 시도합니다.
    // 이 앱은 항상 최신 제출/확정 데이터를 읽어야 하므로 매 요청 no-store로 강제합니다.
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, { ...init, cache: "no-store" }),
    },
  });
}
