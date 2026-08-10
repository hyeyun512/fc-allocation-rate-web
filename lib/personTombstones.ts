import { TARGETS, TargetKey } from "./targets";
import { latestByPerson, DELETED_STATUS, SubmissionRow } from "./rollup";

/**
 * 개인별 표에서 X로 지운 사람을 실제로 사라지게 하는 '삭제 표식' 행을 만든다.
 *
 * allocation_submissions는 재제출할 때마다 새 행이 쌓이는 append-only 테이블이라,
 * 화면에서 행을 지우고 저장하면 그 사람의 새 행이 안 들어올 뿐 예전 행은 그대로 남는다.
 * 그래서 지웠는데도 다음 조회에서 이름이 되살아나고, 값이 있는 옛 행 때문에 '제출됨'으로 보였다.
 * 저장 시점의 화면 명단이 곧 그 조직·분기의 전체 명단이므로, 명단에서 빠진 사람은 표식 행을 남긴다.
 * (조회 쪽 latestByPerson이 최신 행을 고른 뒤 이 표식을 걸러낸다.)
 */
export async function buildDeletionTombstones(
  supabase: any,
  args: {
    orgId: number;
    period: string;
    version: string;
    keptNames: string[];
    submittedBy: string;
    /**
     * 명단을 통째로 비웠을 때 조직 단위 제출 행(person_name=null)까지 무효화할지.
     * 개인별 입력 조직은 조직 값이 개인 행에서 파생되므로, 개인이 한 명도 없는데
     * 예전 조직 단위 행이 살아 있으면 '제출됨'으로 계속 조회된다.
     */
    clearOrgLevelWhenEmpty?: boolean;
  }
): Promise<Record<string, any>[]> {
  const { orgId, period, version, keptNames, submittedBy, clearOrgLevelWhenEmpty } = args;

  const { data: existing } = await supabase
    .from("allocation_submissions")
    .select("*")
    .eq("org_id", orgId)
    .eq("period", period);

  // latestByPerson이 이미 지워진(표식이 최신인) 행은 걸러주므로, 남은 건 '살아 있는' 것들이다.
  const alive = latestByPerson((existing ?? []) as SubmissionRow[]);
  const kept = new Set(keptNames.map((n) => String(n).trim()));

  const zeroRates = {} as Record<TargetKey, number>;
  TARGETS.forEach((t) => (zeroRates[t.key] = 0));

  const tombstone = (r: SubmissionRow) => ({
    org_id: orgId,
    period,
    version,
    person_name: r.person_name,
    sub_team: r.sub_team ?? null,
    headcount: 0,
    ...zeroRates,
    total: 0,
    note: "행 삭제",
    submitted_by: submittedBy,
    status: DELETED_STATUS,
  });

  const removedPersons = alive.filter((r) => r.person_name && !kept.has(String(r.person_name).trim()));

  const orgLevel =
    clearOrgLevelWhenEmpty && kept.size === 0
      ? alive.filter((r) => r.person_name === null && (Number(r.total) || 0) > 0)
      : [];

  return [...removedPersons, ...orgLevel].map(tombstone);
}
