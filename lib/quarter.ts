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
