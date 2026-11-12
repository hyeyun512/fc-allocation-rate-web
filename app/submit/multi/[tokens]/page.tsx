import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { getSubmitData } from "@/lib/submitData";
import { BUNDLE_TOKEN_SEPARATOR } from "@/lib/linkBundles";
import BundleView from "./BundleView";

export const dynamic = "force-dynamic";

export const metadata = { title: "리소스 배부율 조사" };

/**
 * 묶음 조사 링크 — 조직 링크 여러 개를 한 화면에서 연다. 위쪽 버튼으로 조직을 고르면
 * 그 조직의 조사 링크 화면(/submit/<토큰>)과 똑같은 화면이 아래에 나온다.
 */
export default async function BundlePage({ params }: { params: { tokens: string } }) {
  const tokens = decodeURIComponent(params.tokens)
    .split(BUNDLE_TOKEN_SEPARATOR)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 20);

  const { data: orgs } = await getSupabaseAdmin()
    .from("allocation_orgs")
    .select("basis,access_token")
    .in("access_token", tokens)
    .eq("active", true);
  const results = await Promise.all(tokens.map((t) => getSubmitData(t)));
  const entries = tokens
    .map((token, i) => ({
      token,
      label: (orgs ?? []).find((o) => o.access_token === token)?.basis ?? "",
      result: results[i],
    }))
    .filter((e) => e.result && e.label)
    .map((e) => ({ token: e.token, label: e.label, ...e.result! }));

  if (entries.length === 0) {
    return (
      <div className="page page-narrow">
        <div className="panel">
          <div className="panel-title">유효하지 않은 링크입니다</div>
          <div className="panel-sub">링크 주소를 다시 확인해주시거나, 배부율 담당자에게 문의해주세요.</div>
        </div>
      </div>
    );
  }

  return <BundleView entries={entries} />;
}
