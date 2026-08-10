import { TargetKey, sumTargets } from "./targets";

/**
 * 고정비율(type='고정비율') 배부기준.
 *
 * 조사로 받는 값이 아니라 정의상 고정된 비율이라 분기마다 값이 달라지지 않는다.
 * (원본: `Supabase 업로드용/allocation-rate.xlsx` — 1Q·2Q 시트의 고정비율 블록이 완전히 동일)
 * 그래서 화면에서 입력받지 않고 여기 정의를 매 분기 그대로 복제해 allocation_rate에 채운다.
 * 값이 실제로 바뀌는 경우에만 이 표를 고치면 된다.
 */
export interface FixedRateDef {
  division: "기타" | "직접비";
  basis: string;
  rates: Partial<Record<TargetKey, number>>;
}

export const FIXED_RATE_TYPE = "고정비율";

export const FIXED_RATES: FixedRateDef[] = [
  // 기타 — 국내/해외를 정해진 비율로 나누는 기준
  { division: "기타", basis: "EVCS(국내/해외)", rates: { evcs_domestic: 0.5, evcs_overseas: 0.5 } },
  { division: "기타", basis: "EVCS(국내30/해외70)", rates: { evcs_domestic: 0.3, evcs_overseas: 0.7 } },
  // 직접비 — 한 대상에 100% 귀속되는 기준
  { division: "직접비", basis: "건물 100%", rates: { building: 1 } },
  { division: "직접비", basis: "공통 100%", rates: { humax_common: 1 } },
  { division: "직접비", basis: "STB 100%", rates: { stb: 1 } },
  { division: "직접비", basis: "Mobility 100%", rates: { mobility: 1 } },
  { division: "직접비", basis: "EVCS(국내) 100%", rates: { evcs_domestic: 1 } },
  { division: "직접비", basis: "EVCS(해외) 100%", rates: { evcs_overseas: 1 } },
  { division: "직접비", basis: "H.Networks", rates: { h_networks: 1 } },
  { division: "직접비", basis: "H.Mobility 100%", rates: { h_mobility: 1 } },
  { division: "직접비", basis: "H.Holdings 100%", rates: { holdings: 1 } },
  { division: "직접비", basis: "H.EV 100%", rates: { h_ev: 1 } },
  // 어디에도 배부하지 않는 기준 (설계상 합계 0)
  { division: "직접비", basis: "실적 제외", rates: {} },
];

function toRow(def: FixedRateDef, quarter: string) {
  const rates = {} as Record<TargetKey, number>;
  (
    [
      "stb", "mobility", "evcs_domestic", "evcs_overseas", "humax_common", "building",
      "h_mobility", "h_ev", "hiparking", "peoplecar", "winercom", "holdings", "h_networks",
    ] as TargetKey[]
  ).forEach((k) => (rates[k] = def.rates[k] ?? 0));
  return {
    quarter,
    type: FIXED_RATE_TYPE,
    division: def.division,
    basis: def.basis,
    ...rates,
    total: sumTargets(rates),
    // '실적 제외'는 설계상 합계가 0이라 배부에 쓰이지 않는다 — update 대상에서 뺀다.
    update_flag: sumTargets(rates) > 0,
    note: null as string | null,
  };
}

/**
 * 해당 분기에 고정비율 행이 없으면 채워 넣는다 (이미 있으면 값을 덮어쓰지 않는다).
 * 분기를 새로 열 때마다 손으로 옮겨 적지 않아도 되도록, 저장이 일어날 때 함께 호출한다.
 */
export async function ensureFixedRates(supabase: any, quarter: string): Promise<string[]> {
  const problems: string[] = [];
  if (!quarter) return problems;

  const { data: existing } = await supabase
    .from("allocation_rate")
    .select("basis")
    .eq("quarter", quarter)
    .eq("type", FIXED_RATE_TYPE);

  const have = new Set((existing ?? []).map((r: any) => r.basis as string));
  const missing = FIXED_RATES.filter((d) => !have.has(d.basis)).map((d) => toRow(d, quarter));
  if (missing.length === 0) return problems;

  const { error } = await supabase
    .from("allocation_rate")
    .upsert(missing, { onConflict: "quarter,type,division,basis" });
  if (error) problems.push(`고정비율(${quarter}): ${error.message}`);
  return problems;
}
