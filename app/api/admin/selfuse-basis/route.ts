import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { computeSelfuseRates } from "@/lib/selfuseBasis";
import { TARGETS, TargetKey, sumTargets } from "@/lib/targets";

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
    const { error } = await supabase.from("allocation_rate").upsert(
      {
        quarter,
        type: "자가사용(건물)",
        division: row.division,
        basis: row.basis,
        ...parsed,
        total: sumTargets(parsed),
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
