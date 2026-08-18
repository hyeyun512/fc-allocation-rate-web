// allocation_rate.quarter 값은 "2026-Q1", "2026-Q1(청구)", "2026-2Q(청구)" 처럼
// 표기가 섞여 들어온다 (원본 엑셀 입력자에 따라 'Qn' / 'nQ' 순서가 다름).
// 화면 정렬·표시는 이 파서로 통일해서, 원본 문자열 표기와 무관하게
// 연도 -> 분기 -> 확정치(청구) 순으로 정렬되도록 한다.

export interface QuarterInfo {
  raw: string;
  year: number;
  q: number;
  billing: boolean;
}

const QUARTER_RE = /^(\d{4})-(?:Q(\d)|(\d)Q)(\(청구\))?$/;

export function parseQuarter(raw: string): QuarterInfo {
  const m = QUARTER_RE.exec(raw.trim());
  if (!m) return { raw, year: 0, q: 0, billing: false };
  return {
    raw,
    year: Number(m[1]),
    q: Number(m[2] ?? m[3]),
    billing: !!m[4],
  };
}

export function sortQuarters(quarters: string[]): string[] {
  return [...quarters].sort((a, b) => {
    const pa = parseQuarter(a);
    const pb = parseQuarter(b);
    if (pa.year !== pb.year) return pa.year - pb.year;
    if (pa.q !== pb.q) return pa.q - pb.q;
    return Number(pa.billing) - Number(pb.billing);
  });
}

// 버튼/헤더 표시용: "2026-Q1" -> "2026-1Q", "2026-Q1(청구)" -> "2026-1Q(청구)" 로 표기를 통일.
export function prettyQuarterLabel(raw: string): string {
  const info = parseQuarter(raw);
  if (!info.year) return raw;
  return `${info.year}-${info.q}Q${info.billing ? "(청구)" : ""}`;
}

// 변화 탭 라벨용 짧은 표기: "2026-Q2(청구)" -> "2Q"
export function shortQuarterLabel(raw: string): string {
  const info = parseQuarter(raw);
  if (!info.year) return raw;
  return `${info.q}Q`;
}

/* ─────────────────── 변화(diff) 비교 분기 쌍 ───────────────────
   View 화면의 '변화' 보기에서 어느 두 분기를 비교할지 고르게 한다.
   예전에는 마지막 두 분기로 고정돼 있어 2Q-1Q 같은 지난 비교를 볼 수 없었다. */

/** 콤보박스 표기용: "2026-Q2(청구)" -> "2Q(청구)".
 *  shortQuarterLabel과 달리 청구 여부를 남긴다 — 입력본과 청구본을 나란히 고를 수 있어야 하므로. */
export function deltaQuarterLabel(raw: string): string {
  const info = parseQuarter(raw);
  if (!info.year) return raw;
  return `${info.q}Q${info.billing ? "(청구)" : ""}`;
}

export interface QuarterPair {
  /** 선택 상태로 들고 다닐 값. */
  key: string;
  /** 비교의 기준(이전) 분기. */
  from: string;
  /** 비교 대상(나중) 분기. */
  to: string;
  /** "3Q-2Q" 처럼 나중-이전 순서로 읽는 표기. */
  label: string;
}

export function pairKey(from: string, to: string): string {
  return `${from}|${to}`;
}

/**
 * 고를 수 있는 비교 쌍. 이웃한 분기끼리 짝지어 주고,
 * 확정치(청구)가 둘 이상이면 그 둘의 비교도 함께 넣는다(예전 기본 동작을 유지하기 위해).
 * 입력은 sortQuarters로 정렬된 목록이어야 한다.
 */
export function deltaPairOptions(quarters: string[]): QuarterPair[] {
  const opts: QuarterPair[] = [];
  const push = (from: string, to: string) => {
    if (!from || !to || from === to) return;
    const key = pairKey(from, to);
    if (opts.some((o) => o.key === key)) return;
    opts.push({ key, from, to, label: `${deltaQuarterLabel(to)}-${deltaQuarterLabel(from)}` });
  };
  quarters.slice(1).forEach((to, i) => push(quarters[i], to));
  const billing = quarters.filter((q) => parseQuarter(q).billing);
  if (billing.length >= 2) push(billing[billing.length - 2], billing[billing.length - 1]);
  return opts;
}

/**
 * 처음 보여줄 비교 쌍. 확정치(청구)가 둘 이상이면 그 둘을, 아니면 가장 최근 이웃 쌍을 쓴다 —
 * 콤보박스가 생기기 전의 기본값과 같게 두어 화면이 갑자기 다른 비교를 보여주지 않게 한다.
 */
export function defaultDeltaPairKey(quarters: string[]): string {
  const billing = quarters.filter((q) => parseQuarter(q).billing);
  if (billing.length >= 2) return pairKey(billing[billing.length - 2], billing[billing.length - 1]);
  const opts = deltaPairOptions(quarters);
  return opts.length ? opts[opts.length - 1].key : "";
}
