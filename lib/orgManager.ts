/**
 * 조직별 담당자 — 조사 링크를 받아 값을 채워 넣는 사람과 그 사람의 메일주소.
 *
 * 분기마다 따로 기록하되(allocation_org_managers), 이번 분기에 아직 아무것도 적지 않았으면
 * **직전에 적어둔 분기의 담당자를 그대로 이어 쓴다** — 분기가 바뀔 때마다 전원을 다시 적지 않아도 되도록.
 * 담당자가 바뀌어 이번 분기만 비워두고 싶으면 빈칸으로 저장하면 된다(빈 문자열 행이 남아 더는 딸려오지 않는다).
 *
 * 이름과 메일은 **같은 행**에 저장한다. 따로 두면 "이름은 이번 분기 사람, 메일은 전임자" 조합이
 * 만들어져 링크가 엉뚱한 사람에게 간다 — 링크는 그 자체가 자격증명이라 그게 곧 사고다.
 *
 * 다만 **값은 쌍으로 따라오되 '출처'는 필드별로 기억한다**(email_set_period).
 * 이름만 고쳐 저장해도 메일 값은 새 행에 함께 굳는데, 그때도 그 주소는 여전히 '이어받은 주소'다.
 * 출처를 행 단위로만 보면 그 주소가 '이번 분기에 확인한 주소'로 승격되어 경고 없이 발송된다.
 */

import { parseQuarter } from "./quarter";

export interface OrgManagerRow {
  org_id: number;
  period: string;
  manager_name: string | null;
  manager_email: string | null;
  /** 메일주소를 사람이 마지막으로 직접 저장한 분기. 빈 문자열이면 그 행의 period를 쓴다. */
  email_set_period: string | null;
}

export interface ResolvedManager {
  name: string;
  /** 이번 분기에 직접 적은 이름이 아니라 지난 분기에서 이어받은 이름인지. */
  nameInherited: boolean;
  /** 그 이름이 적힌 분기 (안내 문구용). 값이 없으면 null. */
  nameFromPeriod: string | null;

  email: string;
  /** 이 주소를 이번 분기에 사람이 확인하지 않았는지 — 발송 전 경고의 유일한 기준. */
  emailInherited: boolean;
  /** 그 주소를 마지막으로 직접 저장한 분기 (안내 문구용). 값이 없으면 null. */
  emailFromPeriod: string | null;
}

const EMPTY: ResolvedManager = {
  name: "",
  nameInherited: false,
  nameFromPeriod: null,
  email: "",
  emailInherited: false,
  emailFromPeriod: null,
};

function quarterRank(raw: string): number {
  const q = parseQuarter(raw);
  // 분기 표기를 못 읽는 값(직접 입력한 기간 등)은 비교에서 빼둔다 — 엉뚱한 분기에서 값을 끌어오지 않게.
  if (!q.year) return -1;
  return q.year * 10 + q.q;
}

/**
 * 이번 분기에 쓸 행 하나를 고른다 — 이번 분기 행이 있으면 그것, 없으면 그보다 앞선 분기 중 가장 최근 행.
 * 이름이 빈 행까지 거슬러 올라가면 거기서 끊는다(그 빈 행이 '이번 분기는 담당자를 비웠다'는 표시다).
 *
 * 이름 해석과 메일 해석이 **같은 행**을 보도록 이 선택 로직을 한 곳에 둔다.
 */
function pickRow(
  rows: OrgManagerRow[],
  orgId: number,
  period: string
): { row: OrgManagerRow; inherited: boolean } | null {
  const mine = rows.filter((r) => r.org_id === orgId);

  const exact = mine.find((r) => r.period === period);
  if (exact) return { row: exact, inherited: false };

  const currentRank = quarterRank(period);
  if (currentRank < 0) return null;

  const previous = mine
    .map((r) => ({ row: r, rank: quarterRank(r.period) }))
    .filter((x) => x.rank > 0 && x.rank < currentRank)
    .sort((a, b) => b.rank - a.rank)[0];

  if (!previous || !previous.row.manager_name) return null;
  return { row: previous.row, inherited: true };
}

/** 이번 분기의 담당자 이름과 메일. 이름·메일은 같은 행에서 오되 '언제 적힌 값인지'는 각각 따진다. */
export function resolveManagerPair(
  rows: OrgManagerRow[],
  orgId: number,
  period: string
): ResolvedManager {
  const picked = pickRow(rows, orgId, period);
  if (!picked) return EMPTY;

  const { row, inherited } = picked;
  const name = row.manager_name ?? "";
  const email = row.manager_email ?? "";

  // 메일의 출처는 행의 분기가 아니라 email_set_period다 — 이름만 고쳐 저장해 행은 이번 분기로
  // 옮겨왔지만 주소는 예전에 적은 그대로인 경우를 잡아내야 한다.
  const emailFromPeriod = (row.email_set_period || row.period) ?? null;

  return {
    name,
    nameInherited: inherited && name !== "",
    nameFromPeriod: name === "" ? null : row.period,
    email,
    // 빈 주소에는 이어받기 경고를 붙이지 않는다 — 적은 적 없는 칸에 "언제 저장한 주소"라고
    // 표시하면 화면이 거짓말을 한다(주소를 안 채운 채 분기가 넘어가면 전 조직이 그 상태가 된다).
    emailInherited: email !== "" && emailFromPeriod !== period,
    emailFromPeriod: email === "" ? null : emailFromPeriod,
  };
}
