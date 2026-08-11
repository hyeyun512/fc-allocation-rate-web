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

/**
 * 합계 100%로 인정하는 허용 오차(±0.5%p).
 * 화면 입력 검증(RateParts의 totalIsValid)과 서버의 '이 정도면 입력 실수' 판정이 같은 값을 써야 한다.
 */
export const RATE_TOTAL_TOLERANCE = 0.005;

/**
 * 배부율 합계를 정확히 100%로 맞춘다 (비율은 그대로 두고 전체를 같은 비로 늘리거나 줄인다).
 *
 * 개인별 입력은 합계가 100%에서 ±0.5%p까지 통과하는데(RateParts의 totalIsValid), 예전에는 이 오차가
 * 조직 평균 -> 상위 집계 -> HKR로 그대로 흘러가 저장값이 100.0014% 같은 값으로 남았다.
 * (실제 사례: HUS 소속 1명이 STB를 50.01%로 입력 -> 7명 평균에 0.0001/7이 남아 HUS 합계 100.0014%)
 * 입력 단계의 허용 오차는 그대로 두고, 계산·저장 시점에만 100%로 맞춘다.
 *
 * 합계가 0이면(미입력이거나 값을 다 지운 경우) 손대지 않는다 — 호출부에서 '행을 지운다'로 따로 처리한다.
 */
export function normalizeTargets(
  rates: Partial<Record<TargetKey, number | null | undefined>>
): Record<TargetKey, number> {
  const out = {} as Record<TargetKey, number>;
  TARGETS.forEach((t) => (out[t.key] = Number(rates[t.key]) || 0));

  const sum = sumTargets(out);
  if (sum <= 0) return out;
  if (sum !== 1) TARGETS.forEach((t) => (out[t.key] = out[t.key] / sum));

  // 나눗셈에서 남는 부동소수점 찌꺼기(0.9999999999999999 같은 값)를 흡수시켜 합계를 정확히 1로 만든다.
  // 이게 없으면 저장은 100%인데 엑셀에서 =SUM(...)=1 검산이 FALSE로 뜬다.
  //
  // 값이 큰 항목부터 넣는다 — 같은 크기의 오차라도 큰 값에 얹어야 비율이 덜 흔들린다.
  // 다만 오차가 그 항목의 표현 한계(1 ULP)보다 작으면 더해도 값이 그대로여서 흡수되지 않으므로,
  // 그럴 때는 더 작은(정밀도가 촘촘한) 항목으로 넘어간다.
  const byValueDesc = TARGETS.map((t) => t.key)
    .filter((key) => out[key] > 0)
    .sort((a, b) => out[b] - out[a]);

  for (const key of byValueDesc) {
    let guard = 0;
    while (sumTargets(out) !== 1 && guard++ < 4) {
      const next = out[key] + (1 - sumTargets(out));
      if (next === out[key]) break;
      out[key] = next;
    }
    if (sumTargets(out) === 1) break;
  }

  return out;
}

// 화면 입력/표시는 항상 %(예: 30) 단위를 쓰고, 내부 상태·DB 저장은 항상 0~1 소수(fraction)로 통일한다.
/**
 * 저장값(분수) → 입력칸에 보여줄 퍼센트 문자열.
 *
 * 예전에는 소수점 4자리로 반올림해서, 엑셀에서 3.4559688500%를 붙여넣어도 화면에 3.456으로 보였다.
 * (값 자체는 온전했지만 그 칸을 한 번이라도 건드리면 반올림된 값으로 덮여 실제로 정밀도가 날아갔다.)
 * 곱셈에서 생기는 부동소수점 찌꺼기(3.4559688500000003)만 걷어낼 만큼만 자르고 원래 자릿수는 살린다.
 * 입력칸에서만 쓰는 함수라 읽기 전용 표의 표기(소수점 1자리)에는 영향이 없다.
 */
export function fractionToPercentInput(fraction: string | number | null | undefined): string {
  const n = Number(fraction);
  if (!Number.isFinite(n) || n === 0) return "";
  return String(Math.round(n * 100 * 1e10) / 1e10);
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
