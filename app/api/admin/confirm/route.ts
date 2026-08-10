import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { TARGETS, TargetKey, sumTargets } from "@/lib/targets";
import { recomputeAggregates } from "@/lib/autoAggregate";
import { buildDeletionTombstones } from "@/lib/personTombstones";
import { DELETED_STATUS } from "@/lib/rollup";

interface PersonPayload {
  name: string;
  headcount?: number | string | null;
  note?: string | null;
  subTeam?: string | null;
  rates: Record<string, string | number>;
}

export async function POST(req: NextRequest) {
  const { orgId, period, version, rates, persons, orgHeadcount, orgNote } = await req.json();

  if (!orgId || !period || !rates) {
    return NextResponse.json({ error: "필수 항목이 누락되었습니다." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  const { data: org } = await supabase.from("allocation_orgs").select("*").eq("id", orgId).maybeSingle();
  if (!org) {
    return NextResponse.json({ error: "조직을 찾을 수 없습니다." }, { status: 404 });
  }

  // 주재원 전용 조직인지 (division이 '주재원'이거나 basis가 _주재원으로 끝난다)
  const isExpatOrg = org.division === "주재원" || String(org.basis).endsWith("_주재원");

  const parsed = {} as Record<TargetKey, number>;
  TARGETS.forEach((t) => {
    const v = Number(rates[t.key]);
    parsed[t.key] = Number.isFinite(v) ? v : 0;
  });

  const upsertRow = {
    quarter: period,
    type: org.type,
    division: org.division,
    basis: org.basis,
    ...parsed,
    total: sumTargets(parsed),
    update_flag: true,
    note: `웹 확정 (${version}) - ${new Date().toISOString()}`,
  };

  const { error: upsertError } = await supabase
    .from("allocation_rate")
    .upsert(upsertRow, { onConflict: "quarter,type,division,basis" });

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  // 검토및확정 화면에서 개인별 값을 입력/수정해 확정한 경우, 조직 합산값만 저장하고 개인별 값은
  // 저장하지 않으면 다음 라운드에 "저장한 개인별 이력"을 다시 조회할 수 없다 — 개인별 행도 함께 남긴다.
  if (Array.isArray(persons)) {
    const personRows = (persons as PersonPayload[])
      .filter((p) => p?.name && String(p.name).trim())
      .map((p) => {
        const personParsed = {} as Record<TargetKey, number>;
        TARGETS.forEach((t) => {
          const v = Number(p.rates?.[t.key]);
          personParsed[t.key] = Number.isFinite(v) ? v : 0;
        });
        return {
          org_id: orgId,
          period,
          version,
          person_name: p.name,
          // 주재원 조직(HDG_주재원 등)에는 '구분' 열이 없어 화면에서 값이 안 넘어온다.
          // 그 조직에 들어온 개인은 모두 주재원이므로 여기서 채워준다.
          sub_team: p.subTeam || (isExpatOrg ? "주재원" : null),
          headcount: p.headcount ?? null,
          ...personParsed,
          total: sumTargets(personParsed),
          note: p.note || null,
          submitted_by: "관리자 확정 (검토및확정)",
          status: "confirmed",
        };
      });

    // 화면에서 X로 지운 사람은 새 행이 안 들어올 뿐이라 예전 행이 그대로 살아난다 — 삭제 표식을 남긴다.
    const tombstones = await buildDeletionTombstones(supabase, {
      orgId,
      period,
      version,
      keptNames: personRows.map((r) => r.person_name),
      submittedBy: "관리자 확정 (검토및확정)",
    });

    const rowsToInsert = [...personRows, ...tombstones];
    if (rowsToInsert.length > 0) {
      const { error: personError } = await supabase.from("allocation_submissions").insert(rowsToInsert);
      if (personError) {
        return NextResponse.json({ error: personError.message }, { status: 500 });
      }
    }
  }

  // 개인별 입력이 없는 조직(조직 단위 배부율)도 인원수·메모를 조직 단위 행(person_name=null)으로 남겨
  // 다음 라운드에 조회·재확정 시 이어서 볼 수 있게 한다.
  if (!Array.isArray(persons) && (orgHeadcount !== undefined || orgNote !== undefined)) {
    const orgSubmissionRow = {
      org_id: orgId,
      period,
      version,
      person_name: null,
      sub_team: null,
      headcount: orgHeadcount ?? null,
      ...parsed,
      total: sumTargets(parsed),
      note: orgNote || null,
      submitted_by: "관리자 확정 (검토및확정)",
      status: "confirmed",
    };
    const { error: orgSubmissionError } = await supabase.from("allocation_submissions").insert(orgSubmissionRow);
    if (orgSubmissionError) {
      return NextResponse.json({ error: orgSubmissionError.message }, { status: 500 });
    }
  }

  // 삭제 표식 행은 그대로 둬야 한다 (confirmed로 바꾸면 지운 사람이 다시 살아난다).
  await supabase
    .from("allocation_submissions")
    .update({ status: "confirmed" })
    .eq("org_id", orgId)
    .eq("period", period)
    .or(`status.is.null,status.neq.${DELETED_STATUS}`);

  // 상위 집계 조직·HKR·사업총괄대표는 이 조직 값에서 파생되므로 여기서 같이 갱신한다
  // (예전에는 화면의 별도 '저장' 버튼을 눌러야 반영돼 누락되기 쉬웠다).
  const aggregateProblems = await recomputeAggregates(supabase, period, version);

  return NextResponse.json({ ok: true, aggregateProblems });
}
