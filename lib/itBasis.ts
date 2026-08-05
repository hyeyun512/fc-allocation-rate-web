import { TargetKey } from "./targets";

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

// 엑셀 '요약' 시트 B52:P68 수식을 그대로 코드화.
// P(대상인원, 분모)를 basis마다 다르게 구성하는 것이 핵심 — 단순 전체합이 아니다.
export function computeItRates(headcount: ItBasisInput | null, sap: ItBasisInput | null): ComputedBasisRow[] {
  const rows: ComputedBasisRow[] = [];

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
