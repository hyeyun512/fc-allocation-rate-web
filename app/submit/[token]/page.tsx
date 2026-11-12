import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { submitLangOf } from "@/lib/englishOrgs";
import { submitStrings } from "@/lib/submitLang";
import { getSubmitData } from "@/lib/submitData";
import SubmitForm from "./SubmitForm";

export const dynamic = "force-dynamic";

/** 탭 제목도 링크 언어에 맞춘다 — 루트 레이아웃의 제목은 한국어로 고정돼 있다. */
export async function generateMetadata({ params }: { params: { token: string } }) {
  const { data: org } = await getSupabaseAdmin()
    .from("allocation_orgs")
    .select("basis")
    .eq("access_token", params.token)
    .maybeSingle();
  const s = submitStrings(org ? submitLangOf(org.basis) : "ko");
  return { title: s.pageTitle, description: s.pageDescription };
}

export default async function SubmitPage({ params }: { params: { token: string } }) {
  const result = await getSubmitData(params.token);

  if (!result) {
    return (
      <div className="page page-narrow">
        <div className="panel">
          <div className="panel-title">유효하지 않은 링크입니다</div>
          <div className="panel-sub">
            링크 주소를 다시 확인해주시거나, 배부율 담당자에게 문의해주세요.
          </div>
        </div>
      </div>
    );
  }

  return (
    <SubmitForm token={params.token} rounds={result.rounds} version={result.version} lang={result.lang} />
  );
}
