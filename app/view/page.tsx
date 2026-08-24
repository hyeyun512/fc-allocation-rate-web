import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { sortQuarters } from "@/lib/quarter";
import AllocationView, { AllocRateRow } from "./AllocationView";
import { isOrgActiveIn } from "@/lib/orgLifespan";

export const dynamic = "force-dynamic";

export default async function AdminViewPage() {
  const supabase = getSupabaseAdmin();

  const { data: rows } = await supabase
    .from("allocation_rate")
    .select("*")
    .order("quarter", { ascending: true })
    .order("division", { ascending: true })
    .order("basis", { ascending: true });

  const { data: orgs } = await supabase.from("allocation_orgs").select("basis,parent_basis,active");

  // View에는 검토및확정 > 리소스배부율의 '조직/팀 선택'에 뜨는 조직만 싣는다.
  // 하위 팀(SW팀·HW팀·재무팀 등)은 상위 조직(개발 그룹·경영지원실) 값에 이미 가중평균으로 반영돼 있어
  // 따로 실으면 같은 인원이 두 줄로 잡힌다.
  const selectableBases = new Set(
    (orgs ?? []).filter((o) => o.active && !o.parent_basis).map((o) => o.basis as string)
  );
  // HKR은 조직 마스터에 없는 자동계산 항목이지만 선택 목록에는 들어 있다.
  selectableBases.add("HKR(관계사제외)");

  const allRows = ((rows ?? []) as AllocRateRow[]).filter(
    (r) =>
      (r.type !== "리소스배부율" || selectableBases.has(r.basis)) &&
      // 그 분기에 존재하지 않았던 조직은 싣지 않는다 (예: 2Q에만 있던 사업협력팀).
      isOrgActiveIn(r.basis, r.quarter)
  );
  const quarters = sortQuarters(Array.from(new Set(allRows.map((r) => r.quarter))));

  const dataByQuarter: Record<string, AllocRateRow[]> = {};
  quarters.forEach((q) => {
    dataByQuarter[q] = allRows.filter((r) => r.quarter === q);
  });

  // 관리자 코멘트는 allocation_rate.note와 따로 보관한다 (note는 확정할 때마다 감사 로그로 덮인다).
  // 키 형식은 AllocationView의 commentKey(quarter, basis)와 반드시 같아야 한다 (분기 + 공백 + 배부기준).
  const { data: commentRows } = await supabase
    .from("allocation_view_comments")
    .select("quarter,basis,content");

  const comments: Record<string, string> = {};
  (commentRows ?? []).forEach((c) => {
    comments[[c.quarter, c.basis].join(" ")] = c.content ?? "";
  });

  return <AllocationView quarters={quarters} dataByQuarter={dataByQuarter} comments={comments} />;
}
