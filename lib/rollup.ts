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

/**
 * 화면에서 X로 행을 지우고 저장하면 남는 '삭제 표식' 행의 status.
 *
 * 제출 테이블은 append-only(재제출하면 새 행이 쌓이는 구조)라서, 지운 사람은 새 행이 안 들어올 뿐
 * 예전 행이 그대로 남는다. 그래서 지웠는데도 이름이 다시 살아나고 제출된 것처럼 보였다.
 * 삭제 시 표식 행을 하나 넣어두고, **최신 행을 고른 뒤에** 이 표식을 걸러낸다
 * (순서가 반대면 표식보다 오래된 원래 행이 다시 뽑힌다). 나중에 같은 이름을 다시 추가하면
 * 그 행이 최신이 되므로 정상적으로 복구된다.
 */
export const DELETED_STATUS = "deleted";

function dropDeleted(rows: SubmissionRow[]): SubmissionRow[] {
  return rows.filter((r) => r.status !== DELETED_STATUS);
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
  return dropDeleted(Array.from(map.values()));
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
  return dropDeleted(Array.from(map.values()));
}

// 같은 org_id + period 조합(조직 단위 제출, person_name이 null)에 대해 가장 최근 제출만 남긴다.
// 조직 단위 배부율의 분기별 인원수·코멘트 이력을 보여주기 위해 사용.
export function latestOrgByPeriod(rows: SubmissionRow[]): SubmissionRow[] {
  const map = new Map<string, SubmissionRow>();
  for (const row of rows) {
    if (row.person_name !== null) continue;
    const key = `${row.org_id}__${row.period}`;
    const existing = map.get(key);
    if (!existing || new Date(row.submitted_at) > new Date(existing.submitted_at)) {
      map.set(key, row);
    }
  }
  return dropDeleted(Array.from(map.values()));
}

/**
 * 개인별 행 중 '한 명'으로 셀 행: 이름이 있고 배부율이 0%가 아닌 행.
 * 개인별 입력은 한 행이 곧 한 명이므로 인원수를 따로 받지 않고 행 수로 센다.
 */
export function countedPersonRows(personRows: SubmissionRow[]): SubmissionRow[] {
  return personRows.filter((p) => (Number(p.total) || 0) > 0);
}

// 개인별 제출이 있으면 인원수(=행 수) 평균, 없으면 조직 단위 제출값을 그대로 사용.
export function computeRollup(
  orgLevelRow: SubmissionRow | null,
  personRows: SubmissionRow[]
): Record<TargetKey, number> {
  const result = {} as Record<TargetKey, number>;

  const counted = countedPersonRows(personRows);
  if (counted.length > 0) {
    TARGETS.forEach((t) => {
      const sum = counted.reduce((acc, p) => acc + (Number(p[t.key]) || 0), 0);
      result[t.key] = sum / counted.length;
    });
    return result;
  }

  TARGETS.forEach((t) => {
    result[t.key] = orgLevelRow ? Number(orgLevelRow[t.key]) || 0 : 0;
  });
  return result;
}
