/**
 * 조직별 담당자 — 조사 링크를 받아 값을 채워 넣는 사람.
 *
 * 분기마다 따로 기록하되(allocation_org_managers), 이번 분기에 아직 아무것도 적지 않았으면
 * **직전에 적어둔 분기의 담당자를 그대로 이어 쓴다** — 분기가 바뀔 때마다 전원을 다시 적지 않아도 되도록.
 * 담당자가 바뀌어 이번 분기만 비워두고 싶으면 빈칸으로 저장하면 된다(빈 문자열 행이 남아 더는 딸려오지 않는다).
 */

import { parseQuarter } from "./quarter";

export interface OrgManagerRow {
  org_id: number;
  period: string;
  manager_name: string | null;
}

export interface ResolvedManager {
  name: string;
  /** 이번 분기에 직접 적은 값이 아니라 지난 분기에서 이어받은 값인지. */
  inherited: boolean;
  /** 이어받았다면 어느 분기에서 가져왔는지 (안내 문구용). */
  fromPeriod: string | null;
}

const EMPTY: ResolvedManager = { name: "", inherited: false, fromPeriod: null };

function quarterRank(raw: string): number {
  const q = parseQuarter(raw);
  // 분기 표기를 못 읽는 값(직접 입력한 기간 등)은 비교에서 빼둔다 — 엉뚱한 분기에서 값을 끌어오지 않게.
  if (!q.year) return -1;
  return q.year * 10 + q.q;
}

/** 이번 분기의 담당자. 이번 분기 행이 없으면 그보다 앞선 분기 중 가장 최근 행에서 이어받는다. */
export function resolveManager(rows: OrgManagerRow[], orgId: number, period: string): ResolvedManager {
  const mine = rows.filter((r) => r.org_id === orgId);
  const exact = mine.find((r) => r.period === period);
  if (exact) return { name: exact.manager_name ?? "", inherited: false, fromPeriod: null };

  const currentRank = quarterRank(period);
  if (currentRank < 0) return EMPTY;

  const previous = mine
    .map((r) => ({ row: r, rank: quarterRank(r.period) }))
    .filter((x) => x.rank > 0 && x.rank < currentRank)
    .sort((a, b) => b.rank - a.rank)[0];

  if (!previous || !previous.row.manager_name) return EMPTY;
  return { name: previous.row.manager_name, inherited: true, fromPeriod: previous.row.period };
}
