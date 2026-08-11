import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { computeSelfuseRates } from "@/lib/selfuseBasis";
import { TARGETS, TargetKey, sumTargets, normalizeTargets, RATE_TOTAL_TOLERANCE } from "@/lib/targets";

export async function POST(req: NextRequest) {
  const { quarter, input, submittedBy } = await req.json();
  if (!quarter || !input) {
    return NextResponse.json({ error: "필수 항목이 누락되었습니다." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  const parsedInput = {
    bundangSelfuseRatio: Number(input.bundangSelfuseRatio) || 0,
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
  if (!Object.values(parsedInput).some((v) => v > 0)) {
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
          yongin_selfuse_ratio: parsedInput.yonginSelfuseRatio,
          biz_dev_media_headcount: parsedInput.bizDevMediaHeadcount,
          staff_headcount: parsedInput.staffHeadcount,
          hq_total_headcount: parsedInput.hqTotalHeadcount,
          material_evcs_domestic_ratio: parsedInput.materialEvcsDomesticRatio,
          material_evcs_overseas_ratio: parsedInput.materialEvcsOverseasRatio,
        },
        submitted_by: submittedBy ?? null,
        confirmed_at: new Date().toISOString(),
      },
      { onConflict: "quarter,category" }
    );
  if (basisError) {
    return NextResponse.json({ error: basisError.message }, { status: 500 });
  }

  const computed = computeSelfuseRates(parsedInput);

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
        type: "자가사용(건물)",
        division: row.division,
        basis: row.basis,
        ...normalized,
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
