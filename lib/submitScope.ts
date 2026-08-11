/**
 * 조사 링크(access_token) 하나로 저장할 수 있는 조직의 범위.
 *
 * 집계 조직(개발 그룹 등)은 링크가 하나뿐이고 그 한 화면에서 하위 조직까지 입력받으므로,
 * 링크의 조직 본인과 그 하위 조직까지만 허용한다. 그 밖의 orgId가 들어오면 거절해
 * 링크 하나로 남의 조직 값을 덮어쓸 수 없게 한다.
 */
export async function resolveTargetOrg(supabase: any, linkOrg: any, orgId: unknown): Promise<any | null> {
  if (orgId == null || Number(orgId) === linkOrg.id) return linkOrg;

  const { data: target } = await supabase
    .from("allocation_orgs")
    .select("*")
    .eq("id", Number(orgId))
    .eq("active", true)
    .maybeSingle();

  if (!target || target.parent_basis !== linkOrg.basis) return null;
  return target;
}
