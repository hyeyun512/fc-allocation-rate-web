/**
 * 분기별로 저장해 둔 메일 문구 중에서 필요한 것을 고른다.
 *
 * 분기 비교는 lib/orgManager.ts의 담당자 이어받기와 **같은 규칙**을 쓴다 —
 * 두 곳이 다른 순서로 분기를 세면 "지난 분기"가 서로 다른 분기를 가리키게 된다.
 */

import { parseQuarter } from "./quarter";

export interface MailTemplateRow {
  period: string;
  subject: string;
  body: string;
}

function rank(raw: string): number {
  const q = parseQuarter(raw);
  // 분기 표기를 못 읽는 값(직접 입력한 기간 등)은 비교에서 뺀다.
  if (!q.year) return -1;
  return q.year * 10 + q.q;
}

/** 이 분기에 저장해 둔 문구. 없으면 null(= 기본 문구를 쓴다). */
export function templateFor(rows: MailTemplateRow[], period: string): MailTemplateRow | null {
  return rows.find((r) => r.period === period) ?? null;
}

/** 이 분기보다 앞선 분기 중 가장 최근에 저장한 문구. */
export function previousTemplate(rows: MailTemplateRow[], period: string): MailTemplateRow | null {
  const current = rank(period);
  if (current < 0) return null;
  const earlier = rows
    .map((r) => ({ row: r, rank: rank(r.period) }))
    .filter((x) => x.rank > 0 && x.rank < current)
    .sort((a, b) => b.rank - a.rank)[0];
  return earlier?.row ?? null;
}
