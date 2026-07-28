import { TARGETS, TargetKey } from "@/lib/targets";

export interface SubmissionRow {
  id: number;
  org_id: number;
  person_name: string | null;
  headcount: number | null;
  submitted_by: string | null;
  submitted_at: string;
  note: string | null;
  status: string;
  [key: string]: any; // TargetKey 컬럼들 + total
}

// 같은 org_id + person_name 조합에 대해 가장 최근 제출만 남긴다 (재제출 시 이전 값은 무시).
export function latestByPerson(rows: SubmissionRow[]): SubmissionRow[] {
  const map = new Map<string, SubmissionRow>();
  for (const row of rows) {
    const key = row.person_name ?? "__org__";
    const existing = map.get(key);
    if (!existing || new Date(row.submitted_at) > new Date(existing.submitted_at)) {
      map.set(key, row);
    }
  }
  return Array.from(map.values());
}

// 같은 org_id + person_name + period 조합에 대해 가장 최근 제출만 남긴다.
// (조직별 리소스 추이처럼 개인별도 분기별 이력을 모두 보여주기 위해 person_name만으로 dedupe하지 않음)
export function latestByPersonAndPeriod(rows: SubmissionRow[]): SubmissionRow[] {
  const map = new Map<string, SubmissionRow>();
  for (const row of rows) {
    if (row.person_name === null) continue;
    const key = `${row.person_name}__${row.period}`;
    const existing = map.get(key);
    if (!existing || new Date(row.submitted_at) > new Date(existing.submitted_at)) {
      map.set(key, row);
    }
  }
  return Array.from(map.values());
}

// 개인별 제출이 있으면 인원수 가중평균, 없으면 조직 단위 제출값을 그대로 사용.
export function computeRollup(
  orgLevelRow: SubmissionRow | null,
  personRows: SubmissionRow[]
): Record<TargetKey, number> {
  const result = {} as Record<TargetKey, number>;

  if (personRows.length > 0) {
    const totalHeadcount = personRows.reduce((sum, p) => sum + (Number(p.headcount) || 1), 0) || personRows.length;
    TARGETS.forEach((t) => {
      const weighted = personRows.reduce((sum, p) => {
        const hc = Number(p.headcount) || 1;
        return sum + (Number(p[t.key]) || 0) * hc;
      }, 0);
      result[t.key] = totalHeadcount > 0 ? weighted / totalHeadcount : 0;
    });
    return result;
  }

  TARGETS.forEach((t) => {
    result[t.key] = orgLevelRow ? Number(orgLevelRow[t.key]) || 0 : 0;
  });
  return result;
}
