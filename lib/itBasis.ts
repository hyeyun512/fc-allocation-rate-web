import { TargetKey, isTargetActiveIn } from "./targets";
import { quarterRank } from "./quarter";

/**
 * IT 탭(인원수비율·SAP 배부기준)은 2026-Q4까지만 쓴다 — 27년 BP부터는 필요 없다(사용자 지시 2026-11-16).
 * 화면(탭·입력 기간)과 저장 라우트가 모두 이 함수로 가른다. 표기를 못 읽는 기간(직접 입력)은 예전처럼 받는다.
 */
export const IT_BASIS_LAST = "2026-Q4";
/** 임시값으로 넣어 둔 분기 — 화면에서 행을 연한 빨간색으로 칠한다 (향후 업데이트 예정, 사용자 지시 2026-11-16). */
export const IT_PROVISIONAL_QUARTERS: readonly string[] = ["2026-Q4"];
export function isItProvisional(quarter: string): boolean {
  return IT_PROVISIONAL_QUARTERS.includes(quarter);
}

export function usesItBasis(period: string): boolean {
  const r = quarterRank(period);
  return r < 0 || r <= quarterRank(IT_BASIS_LAST);
}

// IT탭 "기준정보" 원본 입력 1행 (인원수 또는 SAP ID 개수).
export interface ItBasisInput {
  headquarters: number;
  overseasCorp: number;
  hMobility: number;
  hEv: number;
  hiparking: number;
  peoplecar: number;
  winercom: number;
  holdings: number;
  hiparkingResident: number | null;
}

export interface ComputedBasisRow {
  division: string;
  basis: string;
  rates: Partial<Record<TargetKey, number>>;
  headcount?: number;
}

function emptyResult(): Partial<Record<TargetKey, number>> {
  return {};
}

// 엑셀 기준정보 표의 M열(TOTAL) = SUM(E:L). 하이파킹 입주인원(N)은 포함하지 않는다.
export function sumItBasisInput(input: ItBasisInput): number {
  return (
    input.headquarters +
    input.overseasCorp +
    input.hMobility +
    input.hEv +
    input.hiparking +
    input.peoplecar +
    input.winercom +
    input.holdings
  );
}

/** 그 기간에 홀딩스가 배부 대상이 아니면 홀딩스 인원을 빼고 계산한다 (분모에서도 빠진다). */
function forPeriod(input: ItBasisInput | null, quarter: string): ItBasisInput | null {
  if (!input || isTargetActiveIn("holdings", quarter)) return input;
  return { ...input, holdings: 0 };
}

// 엑셀 '요약' 시트 B52:P68 수식을 그대로 코드화.
// P(대상인원, 분모)를 basis마다 다르게 구성하는 것이 핵심 — 단순 전체합이 아니다.
export function computeItRates(
  headcountInput: ItBasisInput | null,
  sapInput: ItBasisInput | null,
  quarter: string
): ComputedBasisRow[] {
  const rows: ComputedBasisRow[] = [];
  const headcount = forPeriod(headcountInput, quarter);
  const sap = forPeriod(sapInput, quarter);

  if (headcount) {
    const { headquarters: E, hMobility: G, hEv: H, hiparking: I, peoplecar: J, winercom: K, holdings: L, hiparkingResident: N, overseasCorp: F } = headcount;

    // 인원수비율(Mobility 포함): 본사 + H.Mobility + H.EV + 홀딩스
    {
      const P = E + G + H + L;
      const r = emptyResult();
      if (P > 0) {
        r.humax_common = E / P;
        r.h_mobility = G / P;
        r.h_ev = H / P;
        r.holdings = L / P;
      }
      rows.push({ division: "인원수", basis: "인원수비율(Mobility 포함)", rates: r, headcount: P });
    }

    // 인원수비율(그룹사인원): 전체 인원수 - 해외법인
    {
      const P = E + F + G + H + I + J + K + L - F;
      const r = emptyResult();
      if (P > 0) {
        r.humax_common = E / P;
        r.h_mobility = G / P;
        r.h_ev = H / P;
        r.hiparking = I / P;
        r.peoplecar = J / P;
        r.winercom = K / P;
        r.holdings = L / P;
      }
      rows.push({ division: "인원수", basis: "인원수비율(그룹사인원)", rates: r, headcount: P });
    }

    // 인원수비율(M/W/H): 본사 + H.Mobility + 위너콤 + 홀딩스
    {
      const P = E + G + K + L;
      const r = emptyResult();
      if (P > 0) {
        r.humax_common = E / P;
        r.h_mobility = G / P;
        r.winercom = K / P;
        r.holdings = L / P;
      }
      rows.push({ division: "인원수", basis: "인원수비율(M/W/H)", rates: r, headcount: P });
    }

    // 인원수비율(M/E/W/H): 본사 + H.Mobility + H.EV + 위너콤 + 홀딩스
    {
      const P = E + G + H + K + L;
      const r = emptyResult();
      if (P > 0) {
        r.humax_common = E / P;
        r.h_mobility = G / P;
        r.h_ev = H / P;
        r.winercom = K / P;
        r.holdings = L / P;
      }
      rows.push({ division: "인원수", basis: "인원수비율(M/E/W/H)", rates: r, headcount: P });
    }

    // 인원수비율(그룹사인원_입주사): 하이파킹 자리에 "하이파킹 입주인원"을 사용
    if (N != null) {
      const P = E + G + H + L + N;
      const r = emptyResult();
      if (P > 0) {
        r.humax_common = E / P;
        r.h_mobility = G / P;
        r.h_ev = H / P;
        r.holdings = L / P;
        r.hiparking = N / P;
      }
      rows.push({ division: "인원수", basis: "인원수비율(그룹사인원_입주사)", rates: r, headcount: P });
    }
  }

  if (sap) {
    const { headquarters: E, overseasCorp: F, hMobility: G, hEv: H, hiparking: I, peoplecar: J, winercom: K, holdings: L } = sap;
    // 인원수비율(SAP): 전체 SAP ID 개수 합
    const P = E + F + G + H + I + J + K + L;
    const r = emptyResult();
    if (P > 0) {
      r.humax_common = (E + F) / P;
      r.h_mobility = G / P;
      r.h_ev = H / P;
      r.hiparking = I / P;
      r.peoplecar = J / P;
      r.winercom = K / P;
      r.holdings = L / P;
    }
    rows.push({ division: "ID수", basis: "인원수비율(SAP)", rates: r, headcount: P });
  }

  return rows;
}
