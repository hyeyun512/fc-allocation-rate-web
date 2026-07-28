// allocation_rate / allocation_submissions 테이블의 13개 배부 대상 컬럼 정의.
// 이 컬럼명 세트는 26년 예산(BP) / 26년 실적_N월 누계 테이블의 *_pct, *_krw 컬럼과 그대로 대응되므로
// 임의로 컬럼을 추가/삭제하지 말고, 대상 조직이 실제로 바뀔 때만 신중히 변경할 것.

export type TargetKey =
  | "stb"
  | "mobility"
  | "evcs_domestic"
  | "evcs_overseas"
  | "humax_common"
  | "building"
  | "h_mobility"
  | "h_ev"
  | "hiparking"
  | "peoplecar"
  | "winercom"
  | "holdings"
  | "h_networks";

export interface TargetDef {
  key: TargetKey;
  label: string;
  group: "humax" | "affiliate";
}

export const TARGETS: TargetDef[] = [
  { key: "stb", label: "STB", group: "humax" },
  { key: "mobility", label: "Mobility", group: "humax" },
  { key: "evcs_domestic", label: "EVCS(국내)", group: "humax" },
  { key: "evcs_overseas", label: "EVCS(해외)", group: "humax" },
  { key: "humax_common", label: "Humax(공통)", group: "humax" },
  { key: "building", label: "건물", group: "humax" },
  { key: "h_mobility", label: "H.Mobility", group: "affiliate" },
  { key: "h_ev", label: "H.EV", group: "affiliate" },
  { key: "hiparking", label: "하이파킹", group: "affiliate" },
  { key: "peoplecar", label: "피플카", group: "affiliate" },
  { key: "winercom", label: "위너콤", group: "affiliate" },
  { key: "holdings", label: "홀딩스", group: "affiliate" },
  { key: "h_networks", label: "H.Networks", group: "affiliate" },
];

export function sumTargets(row: Partial<Record<TargetKey, number | null | undefined>>): number {
  return TARGETS.reduce((sum, t) => sum + (Number(row[t.key]) || 0), 0);
}

// 화면 입력/표시는 항상 %(예: 30) 단위를 쓰고, 내부 상태·DB 저장은 항상 0~1 소수(fraction)로 통일한다.
export function fractionToPercentInput(fraction: string | number | null | undefined): string {
  const n = Number(fraction);
  if (!Number.isFinite(n) || n === 0) return "";
  return String(Math.round(n * 100 * 10000) / 10000);
}

export function percentInputToFraction(percentStr: string): string {
  const n = Number(percentStr);
  if (!Number.isFinite(n)) return "0";
  return String(n / 100);
}

// 해외법인은 '법인'과 '주재원'을 하나의 리소스배부율로 같이 관리하므로, 목록/그룹핑 표시에서는 하나로 합쳐서 보여준다.
export function groupDivisionLabel(division: string): string {
  return division === "법인" || division === "주재원" ? "법인+주재원" : division;
}

// 'YYYY-Qn' 형식의 기간에서 바로 직전 분기 라벨을 계산 (예: '2026-Q3' -> '2026-Q2', '2026-Q1' -> '2025-Q4').
export function getPreviousPeriod(period: string): string | null {
  const m = /^(\d{4})-Q([1-4])$/.exec(period.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const q = Number(m[2]);
  if (q === 1) return `${year - 1}-Q4`;
  return `${year}-Q${q - 1}`;
}
