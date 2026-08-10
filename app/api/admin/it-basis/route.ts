import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { computeItRates } from "@/lib/itBasis";
import { TARGETS, TargetKey, sumTargets } from "@/lib/targets";

export async function POST(req: NextRequest) {
  const { quarter, headcount, sap, submittedBy, headcountBy, sapBy, headcountBasis, sapBasis, headcountNote, sapNote } = await req.json();

  // 인원수와 SAP ID 개수는 담당자가 달라 입력자를 따로 받는다.
  // (예전 형식으로 들어오면 단일 입력자를 양쪽에 그대로 쓴다.)
  const headcountSubmitter = headcountBy ?? submittedBy ?? null;
  const sapSubmitter = sapBy ?? submittedBy ?? null;
  if (!quarter || (!headcount && !sap)) {
    return NextResponse.json({ error: "필수 항목이 누락되었습니다." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  const rowsToUpsert = [];
  if (headcount) {
    rowsToUpsert.push({
      quarter,
      category: "it_headcount",
      payload: {
        headquarters: Number(headcount.headquarters) || 0,
        overseas_corp: Number(headcount.overseasCorp) || 0,
        h_mobility: Number(headcount.hMobility) || 0,
        h_ev: Number(headcount.hEv) || 0,
        hiparking: Number(headcount.hiparking) || 0,
        peoplecar: Number(headcount.peoplecar) || 0,
        winercom: Number(headcount.winercom) || 0,
        holdings: Number(headcount.holdings) || 0,
        hiparking_resident: headcount.hiparkingResident === "" || headcount.hiparkingResident == null ? null : Number(headcount.hiparkingResident),
        // 청구기준·코멘트는 표마다 따로 받는다 (분기와 청구 반기가 항상 같지는 않다).
        billing_basis: headcountBasis ?? null,
        note: headcountNote ?? null,
      },
      submitted_by: headcountSubmitter,
      confirmed_at: new Date().toISOString(),
    });
  }
  if (sap) {
    rowsToUpsert.push({
      quarter,
      category: "it_sap",
      payload: {
        headquarters: Number(sap.headquarters) || 0,
        overseas_corp: Number(sap.overseasCorp) || 0,
        h_mobility: Number(sap.hMobility) || 0,
        h_ev: Number(sap.hEv) || 0,
        hiparking: Number(sap.hiparking) || 0,
        peoplecar: Number(sap.peoplecar) || 0,
        winercom: Number(sap.winercom) || 0,
        holdings: Number(sap.holdings) || 0,
        hiparking_resident: null,
        billing_basis: sapBasis ?? null,
        note: sapNote ?? null,
      },
      submitted_by: sapSubmitter,
      confirmed_at: new Date().toISOString(),
    });
  }

  const { error: basisError } = await supabase.from("allocation_basis_inputs").upsert(rowsToUpsert, { onConflict: "quarter,category" });
  if (basisError) {
    return NextResponse.json({ error: basisError.message }, { status: 500 });
  }

  const computed = computeItRates(
    headcount
      ? {
          headquarters: Number(headcount.headquarters) || 0,
          overseasCorp: Number(headcount.overseasCorp) || 0,
          hMobility: Number(headcount.hMobility) || 0,
          hEv: Number(headcount.hEv) || 0,
          hiparking: Number(headcount.hiparking) || 0,
          peoplecar: Number(headcount.peoplecar) || 0,
          winercom: Number(headcount.winercom) || 0,
          holdings: Number(headcount.holdings) || 0,
          hiparkingResident: headcount.hiparkingResident === "" || headcount.hiparkingResident == null ? null : Number(headcount.hiparkingResident),
        }
      : null,
    sap
      ? {
          headquarters: Number(sap.headquarters) || 0,
          overseasCorp: Number(sap.overseasCorp) || 0,
          hMobility: Number(sap.hMobility) || 0,
          hEv: Number(sap.hEv) || 0,
          hiparking: Number(sap.hiparking) || 0,
          peoplecar: Number(sap.peoplecar) || 0,
          winercom: Number(sap.winercom) || 0,
          holdings: Number(sap.holdings) || 0,
          hiparkingResident: null,
        }
      : null
  );

  for (const row of computed) {
    const parsed = {} as Record<TargetKey, number>;
    TARGETS.forEach((t) => {
      parsed[t.key] = row.rates[t.key] ?? 0;
    });
    const { error } = await supabase.from("allocation_rate").upsert(
      {
        quarter,
        type: "IT",
        division: row.division,
        basis: row.basis,
        ...parsed,
        total: sumTargets(parsed),
        update_flag: true,
        note: `웹 확정 (IT 기준정보) - ${new Date().toISOString()}`,
      },
      { onConflict: "quarter,type,division,basis" }
    );
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, computed });
}
