import { TargetKey } from "./targets";
import { ComputedBasisRow } from "./itBasis";
import { quarterRank } from "./quarter";

/* ─────────────────── 27년 BP부터: 건물(분당)/건물(용인) ───────────────────
   27년 BP부터 자가사용(건물) 배부를 없앤다. 건물 비용을 '건물' 대상으로 모았다가 다시 나누지 않고,
   새 배부기준 둘로 사업에 바로 나눈다.
     · 건물(분당) — 인원수가 아니라 **면적** 기준. EVCS(국내)/EVCS(해외)/IT/Humax(공통)이 쓰는 면적을
       각각 받아 그 비중으로 나눈다.
     · 건물(용인) — 지금처럼 재료비 비중(EVCS 국내/해외) 그대로.
   그래서 자가사용비율 입력은 사라지고, 배부 대상 '건물'도 27년 BP부터 없어진다 (lib/targets.ts의 TARGET_LIFESPAN). */

/** 건물(분당)/건물(용인) 배부기준을 쓰기 시작하는 기간. */
export const BUILDING_BASIS_FROM = "2027-BP";
/** 새 배부기준의 allocation_rate.type — 예전 것은 SELFUSE_TYPE. View에서 유형으로 갈라 보인다. */
export const BUILDING_TYPE = "건물";
export const SELFUSE_TYPE = "자가사용(건물)";

/**
 * 이 기간에 건물(분당)/건물(용인)을 쓰는지 (아니면 예전 자가사용(건물)).
 * 화면·저장·계산이 모두 이 함수 하나로 가른다. 표기를 못 읽는 기간(직접 입력)은 예전 방식으로 둔다.
 */
export function usesBuildingBasis(period: string): boolean {
  const r = quarterRank(period);
  return r >= 0 && r >= quarterRank(BUILDING_BASIS_FROM);
}

/** 그 기간 자가사용·건물 배부율이 저장되는 allocation_rate.type. */
export function selfuseTypeFor(period: string): string {
  return usesBuildingBasis(period) ? BUILDING_TYPE : SELFUSE_TYPE;
}

export interface BuildingBasisInput {
  /** 분당 건물에서 각 사업이 쓰는 면적 (단위는 무엇이든 같기만 하면 된다 — 비중만 쓴다). */
  bundangAreaEvcsDomestic: number;
  bundangAreaEvcsOverseas: number;
  bundangAreaIt: number;
  bundangAreaHumaxCommon: number;
  materialEvcsDomesticRatio: number;
  materialEvcsOverseasRatio: number;
}

/** 건물(분당)·건물(용인) 두 행. 면적이 모두 0이면 분당 행은 전부 0이다(합계 0 → 저장 전에 막는다). */
export function computeBuildingRates(input: BuildingBasisInput): ComputedBasisRow[] {
  const areas: [TargetKey, number][] = [
    ["evcs_domestic", input.bundangAreaEvcsDomestic],
    ["evcs_overseas", input.bundangAreaEvcsOverseas],
    ["it", input.bundangAreaIt],
    ["humax_common", input.bundangAreaHumaxCommon],
  ];
  const areaSum = areas.reduce((s, [, v]) => s + (v || 0), 0);
  const bundang: Partial<Record<TargetKey, number>> = {};
  areas.forEach(([k, v]) => (bundang[k] = areaSum > 0 ? (v || 0) / areaSum : 0));
  return [
    { division: "건물", basis: "건물(분당)", rates: bundang },
    {
      division: "건물",
      basis: "건물(용인)",
      rates: { evcs_domestic: input.materialEvcsDomesticRatio, evcs_overseas: input.materialEvcsOverseasRatio },
    },
  ];
}

export interface SelfuseBasisInput {
  bundangSelfuseRatio: number;
  /**
   * 분당 자가사용비율2 — 이사 기간에만 쓰는 두 번째 분당 건물 비율.
   *
   * null은 '아직 입력된 적 없음'이고 0과 구분한다. 0으로 뭉개면 비율2를 넣은 적 없는 분기에도
   * 분당(자가사용)2가 '건물 100%'로 만들어져, 확정 이력에 실제로는 없는 행이 그려진다.
   * BUNDANG_SELFUSE_2_QUARTERS 밖의 분기에서는 값이 있어도 계산에 쓰지 않는다.
   */
  bundangSelfuseRatio2: number | null;
  yonginSelfuseRatio: number;
  bizDevMediaHeadcount: number;
  staffHeadcount: number;
  hqTotalHeadcount: number;
  materialEvcsDomesticRatio: number;
  materialEvcsOverseasRatio: number;
}

/**
 * 분당 자가사용비율이 둘인 분기.
 *
 * 회사가 이사하는 중이라 기존 건물과 새 건물의 비용이 함께 잡히는 분기가 2026-Q3다.
 * 그 분기에만 분당 배부기준이 분당(자가사용)/분당(자가사용)2로 갈린다.
 * 이사가 끝나면 다시 하나로 돌아가므로 분기를 못박아 둔다 — 목록에 없는 분기에서는
 * 입력칸도 서지 않고, 값이 들어와 있어도 두 번째 행을 만들지 않는다.
 *
 * 이사가 더 길어지면 이 배열에 분기를 추가하면 된다(화면·저장·계산이 모두 여기를 본다).
 */
export const BUNDANG_SELFUSE_2_QUARTERS: readonly string[] = ["2026-Q3"];

export function hasBundangSelfuse2(quarter: string): boolean {
  return BUNDANG_SELFUSE_2_QUARTERS.includes(quarter);
}

/**
 * 분당 건물 한 채의 배부율. 자가사용분(selfuseRatio)은 본사 인원 비중으로 쪼개고 나머지가 건물분이다.
 * 건물이 둘인 분기에는 같은 규칙을 비율만 바꿔 두 번 적용한다 — 규칙이 갈라지지 않도록 한 곳에 둔다.
 */
function bundangRates(
  selfuseRatio: number,
  evcsShare: number,
  humaxCommonShare: number
): Partial<Record<TargetKey, number>> {
  return {
    evcs_domestic: selfuseRatio * evcsShare,
    evcs_overseas: selfuseRatio * evcsShare,
    humax_common: selfuseRatio * humaxCommonShare,
    building: 1 - selfuseRatio,
  };
}

// 엑셀 '요약' 시트 B85:R93 수식을 그대로 코드화.
export function computeSelfuseRates(input: SelfuseBasisInput, quarter: string): ComputedBasisRow[] {
  const {
    bundangSelfuseRatio,
    bundangSelfuseRatio2,
    yonginSelfuseRatio,
    bizDevMediaHeadcount,
    staffHeadcount,
    hqTotalHeadcount,
    materialEvcsDomesticRatio,
    materialEvcsOverseasRatio,
  } = input;

  // 본사 인원수 비중 (중간값, allocation_rate에는 저장하지 않음)
  const evcsShare = hqTotalHeadcount > 0 ? bizDevMediaHeadcount / hqTotalHeadcount / 2 : 0;
  const humaxCommonShare = hqTotalHeadcount > 0 ? staffHeadcount / hqTotalHeadcount : 0;

  const yongin: Partial<Record<TargetKey, number>> = {
    evcs_domestic: yonginSelfuseRatio * materialEvcsDomesticRatio,
    evcs_overseas: yonginSelfuseRatio * materialEvcsOverseasRatio,
    building: 1 - yonginSelfuseRatio,
  };

  const rows: ComputedBasisRow[] = [
    { division: "건물", basis: "분당(자가사용)", rates: bundangRates(bundangSelfuseRatio, evcsShare, humaxCommonShare) },
  ];

  // 이사로 분당 건물이 둘인 분기에, 비율2가 입력된 경우에만 두 번째 행이 붙는다.
  // 분당 바로 아래, 용인 위에 온다.
  if (hasBundangSelfuse2(quarter) && bundangSelfuseRatio2 !== null) {
    rows.push({
      division: "건물",
      basis: "분당(자가사용)2",
      rates: bundangRates(bundangSelfuseRatio2, evcsShare, humaxCommonShare),
    });
  }

  rows.push({ division: "건물", basis: "용인(자가사용)", rates: yongin });
  return rows;
}
