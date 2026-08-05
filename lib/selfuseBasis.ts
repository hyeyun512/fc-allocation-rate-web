import { TargetKey } from "./targets";
import { ComputedBasisRow } from "./itBasis";

export interface SelfuseBasisInput {
  bundangSelfuseRatio: number;
  yonginSelfuseRatio: number;
  bizDevMediaHeadcount: number;
  staffHeadcount: number;
  hqTotalHeadcount: number;
  materialEvcsDomesticRatio: number;
  materialEvcsOverseasRatio: number;
}

// 엑셀 '요약' 시트 B85:R93 수식을 그대로 코드화.
export function computeSelfuseRates(input: SelfuseBasisInput): ComputedBasisRow[] {
  const { bundangSelfuseRatio, yonginSelfuseRatio, bizDevMediaHeadcount, staffHeadcount, hqTotalHeadcount, materialEvcsDomesticRatio, materialEvcsOverseasRatio } = input;

  // 본사 인원수 비중 (중간값, allocation_rate에는 저장하지 않음)
  const evcsShare = hqTotalHeadcount > 0 ? bizDevMediaHeadcount / hqTotalHeadcount / 2 : 0;
  const humaxCommonShare = hqTotalHeadcount > 0 ? staffHeadcount / hqTotalHeadcount : 0;

  const bundang: Partial<Record<TargetKey, number>> = {
    evcs_domestic: bundangSelfuseRatio * evcsShare,
    evcs_overseas: bundangSelfuseRatio * evcsShare,
    humax_common: bundangSelfuseRatio * humaxCommonShare,
    building: 1 - bundangSelfuseRatio,
  };

  const yongin: Partial<Record<TargetKey, number>> = {
    evcs_domestic: yonginSelfuseRatio * materialEvcsDomesticRatio,
    evcs_overseas: yonginSelfuseRatio * materialEvcsOverseasRatio,
    building: 1 - yonginSelfuseRatio,
  };

  return [
    { division: "건물", basis: "분당(자가사용)", rates: bundang },
    { division: "건물", basis: "용인(자가사용)", rates: yongin },
  ];
}
