import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  computeSelfuseRates,
  hasBundangSelfuse2,
  usesBuildingBasis,
  computeBuildingRates,
  BUILDING_TYPE,
  SELFUSE_TYPE,
} from "@/lib/selfuseBasis";
import { TARGETS, TargetKey, sumTargets, normalizeTargets, RATE_TOTAL_TOLERANCE, toDbTargets } from "@/lib/targets";

export async function POST(req: NextRequest) {
  const { quarter, input, submittedBy, note } = await req.json();
  if (!quarter || !input) {
    return NextResponse.json({ error: "필수 항목이 누락되었습니다." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // 27년 BP부터는 자가사용(건물) 대신 건물(분당)/건물(용인)을 만든다 — 입력값도 저장할 배부기준도 다르다.
  if (usesBuildingBasis(quarter)) {
    return saveBuildingBasis(supabase, quarter, input, submittedBy, note);
  }

  const parsedInput = {
    bundangSelfuseRatio: Number(input.bundangSelfuseRatio) || 0,
    // null(입력 안 함)을 0으로 뭉개지 않는다 — 뭉개면 분당(자가사용)2가 건물 100%로 저장된다.
    bundangSelfuseRatio2:
      input.bundangSelfuseRatio2 == null ? null : Number(input.bundangSelfuseRatio2) || 0,
    yonginSelfuseRatio: Number(input.yonginSelfuseRatio) || 0,
    bizDevMediaHeadcount: Number(input.bizDevMediaHeadcount) || 0,
    staffHeadcount: Number(input.staffHeadcount) || 0,
    hqTotalHeadcount: Number(input.hqTotalHeadcount) || 0,
    materialEvcsDomesticRatio: Number(input.materialEvcsDomesticRatio) || 0,
    materialEvcsOverseasRatio: Number(input.materialEvcsOverseasRatio) || 0,
  };

  // 입력이 전부 0이면 자가사용비율 0 → '건물 100%'인 배부율 2행이 만들어진다.
  // 빈 화면에서 저장이 한 번 눌렸을 뿐인데 그 분기가 확정된 것처럼 View에 남으므로 아예 저장하지 않는다.
  // (IT 기준정보는 전부 0이면 합계 0이라 그쪽 라우트에서 0인 행을 지우는 방식으로 막는다.)
  if (!Object.values(parsedInput).some((v) => (v ?? 0) > 0)) {
    return NextResponse.json({ error: "입력값이 없어 저장하지 않았습니다." }, { status: 400 });
  }

  const { error: basisError } = await supabase
    .from("allocation_basis_inputs")
    .upsert(
      {
        quarter,
        category: "selfuse",
        payload: {
          bundang_selfuse_ratio: parsedInput.bundangSelfuseRatio,
          // 이사로 건물이 둘인 분기에만 담는다. 다른 분기에 값이 흘러 들어와도 null로 떨어뜨려,
          // 나중에 이 payload만 보고도 '이 분기는 분당이 하나였다'가 분명하게 남도록 한다.
          bundang_selfuse_ratio_2: hasBundangSelfuse2(quarter) ? parsedInput.bundangSelfuseRatio2 : null,
          yongin_selfuse_ratio: parsedInput.yonginSelfuseRatio,
          biz_dev_media_headcount: parsedInput.bizDevMediaHeadcount,
          staff_headcount: parsedInput.staffHeadcount,
          hq_total_headcount: parsedInput.hqTotalHeadcount,
          material_evcs_domestic_ratio: parsedInput.materialEvcsDomesticRatio,
          material_evcs_overseas_ratio: parsedInput.materialEvcsOverseasRatio,
          // 기준정보 표 맨 오른쪽 코멘트. 숫자와 함께 한 벌로 보관한다.
          note: typeof note === "string" && note.trim() ? note.trim() : null,
        },
        submitted_by: submittedBy ?? null,
        confirmed_at: new Date().toISOString(),
      },
      { onConflict: "quarter,category" }
    );
  if (basisError) {
    return NextResponse.json({ error: basisError.message }, { status: 500 });
  }

  const computed = computeSelfuseRates(parsedInput, quarter);

  for (const row of computed) {
    const parsed = {} as Record<TargetKey, number>;
    TARGETS.forEach((t) => {
      parsed[t.key] = row.rates[t.key] ?? 0;
    });
    // 리소스배부율·IT와 같은 규칙으로 저장 직전에 100%로 맞춘다.
    const computedTotal = sumTargets(parsed);
    const normalized = normalizeTargets(parsed);

    // 분당은 '사업+개발+Media 인원 = 본사 총 - Staff'로 자동 계산되므로 합계가 항상 100%다(찌꺼기만 남는다).
    // 용인은 재료비 비중(EVCS 국내/해외)을 각각 입력받아 둘의 합이 100%라는 보장이 없다 —
    // 어긋나면 자가사용분과 건물분의 경계가 밀리므로, 보정은 하되 입력을 다시 보도록 로그를 남긴다.
    if (Math.abs(computedTotal - 1) > RATE_TOTAL_TOLERANCE) {
      console.warn(
        `[allocation] 자가사용 합계 이상: ${quarter} ${row.basis} 계산 ${(computedTotal * 100).toFixed(4)}%` +
          ` -> 100%로 보정해 저장 (용인은 재료비 비중 국내+해외가 100%인지 확인 필요)`
      );
    }

    const { error } = await supabase.from("allocation_rate").upsert(
      {
        quarter,
        type: SELFUSE_TYPE,
        division: row.division,
        basis: row.basis,
        ...toDbTargets(normalized, quarter),
        total: sumTargets(normalized),
        update_flag: true,
        note: `웹 확정 (자가사용 기준정보) - ${new Date().toISOString()}`,
      },
      { onConflict: "quarter,type,division,basis" }
    );
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, computed });
}

/**
 * 27년 BP~ 건물 기준정보 저장: 분당 면적(사업별 4개) + 용인 재료비 비중 → 건물(분당)/건물(용인).
 *
 * 기준정보는 예전과 같은 자리(allocation_basis_inputs, category "selfuse")에 다른 필드로 담는다 —
 * 기간마다 한 벌이고, 화면은 usesBuildingBasis로 어느 필드를 읽을지 가른다.
 */
async function saveBuildingBasis(supabase: any, quarter: string, input: any, submittedBy: any, note: any) {
  const parsed = {
    bundangAreaEvcsDomestic: Number(input.bundangAreaEvcsDomestic) || 0,
    bundangAreaEvcsOverseas: Number(input.bundangAreaEvcsOverseas) || 0,
    bundangAreaBusinessSolution: Number(input.bundangAreaBusinessSolution) || 0,
    bundangAreaIto: Number(input.bundangAreaIto) || 0,
    bundangAreaHumaxCommon: Number(input.bundangAreaHumaxCommon) || 0,
    materialEvcsDomesticRatio: Number(input.materialEvcsDomesticRatio) || 0,
    materialEvcsOverseasRatio: Number(input.materialEvcsOverseasRatio) || 0,
  };
  // 음수 면적·비중은 비중 계산을 뒤집는다(합계는 100%여도 한 사업이 마이너스 배부를 받는다) — 받지 않는다.
  if (Object.values(parsed).some((v) => v < 0)) {
    return NextResponse.json({ error: "면적과 재료비 비중은 0 이상이어야 합니다." }, { status: 400 });
  }
  // 예전처럼 '건물 100%'로 떨어질 자리가 없다 — 면적이나 재료비 비중이 비어 있으면 합계 0인 배부기준이
  // 확정된 것처럼 남으므로 둘 다 있어야 저장한다.
  const areaSum =
    parsed.bundangAreaEvcsDomestic +
    parsed.bundangAreaEvcsOverseas +
    parsed.bundangAreaBusinessSolution +
    parsed.bundangAreaIto +
    parsed.bundangAreaHumaxCommon;
  if (areaSum <= 0) {
    return NextResponse.json({ error: "분당 면적을 입력해 주세요." }, { status: 400 });
  }
  if (parsed.materialEvcsDomesticRatio + parsed.materialEvcsOverseasRatio <= 0) {
    return NextResponse.json({ error: "용인 재료비 비중을 입력해 주세요." }, { status: 400 });
  }

  const { error: basisError } = await supabase.from("allocation_basis_inputs").upsert(
    {
      quarter,
      category: "selfuse",
      payload: {
        bundang_area_evcs_domestic: parsed.bundangAreaEvcsDomestic,
        bundang_area_evcs_overseas: parsed.bundangAreaEvcsOverseas,
        bundang_area_business_solution: parsed.bundangAreaBusinessSolution,
        bundang_area_ito: parsed.bundangAreaIto,
        bundang_area_humax_common: parsed.bundangAreaHumaxCommon,
        material_evcs_domestic_ratio: parsed.materialEvcsDomesticRatio,
        material_evcs_overseas_ratio: parsed.materialEvcsOverseasRatio,
        note: typeof note === "string" && note.trim() ? note.trim() : null,
      },
      submitted_by: submittedBy ?? null,
      confirmed_at: new Date().toISOString(),
    },
    { onConflict: "quarter,category" }
  );
  if (basisError) {
    return NextResponse.json({ error: basisError.message }, { status: 500 });
  }

  const computed = computeBuildingRates(parsed);
  for (const row of computed) {
    const rates = {} as Record<TargetKey, number>;
    TARGETS.forEach((t) => {
      rates[t.key] = row.rates[t.key] ?? 0;
    });
    // 리소스배부율·IT와 같은 규칙으로 저장 직전에 100%로 맞춘다.
    // 분당은 면적 비중이라 항상 100%고, 용인은 재료비 국내+해외가 100%가 아니면 어긋난다 — 보정하고 로그를 남긴다.
    const computedTotal = sumTargets(rates);
    const normalized = normalizeTargets(rates);
    if (Math.abs(computedTotal - 1) > RATE_TOTAL_TOLERANCE) {
      console.warn(
        `[allocation] 건물 합계 이상: ${quarter} ${row.basis} 계산 ${(computedTotal * 100).toFixed(4)}% -> 100%로 보정해 저장`
      );
    }
    const { error } = await supabase.from("allocation_rate").upsert(
      {
        quarter,
        type: BUILDING_TYPE,
        division: row.division,
        basis: row.basis,
        ...toDbTargets(normalized, quarter),
        total: sumTargets(normalized),
        update_flag: true,
        note: `웹 확정 (건물 기준정보) - ${new Date().toISOString()}`,
      },
      { onConflict: "quarter,type,division,basis" }
    );
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // 이 기간에는 자가사용(건물)이 없다 — 예전 방식으로 저장된 분당/용인(자가사용) 행이 남아 있으면 지운다
  // (남겨 두면 View와 배부 파일에 두 방식이 함께 잡힌다).
  const { error: delError } = await supabase.from("allocation_rate").delete().eq("quarter", quarter).eq("type", SELFUSE_TYPE);
  if (delError) {
    return NextResponse.json({ error: delError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, computed });
}
