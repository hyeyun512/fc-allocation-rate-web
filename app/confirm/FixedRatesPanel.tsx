"use client";

import { TargetKey } from "@/lib/targets";
import { RateTableHead, ReadOnlyRateRow } from "@/components/RateParts";

export interface FixedRateRow {
  quarter: string;
  division: string;
  basis: string;
  rates: Record<TargetKey, number>;
}

/**
 * 관리자 '고정비율' 탭 — 정의상 고정된 비율(lib/fixedRates.ts)이 그 기간 배부율 표에 실제로 어떻게 들어가 있는지
 * 읽기 전용으로 보여준다. 입력받지 않는다 (값이 바뀌어야 하면 lib/fixedRates.ts를 고친다).
 */
export default function FixedRatesPanel({ periods, rows }: { periods: string[]; rows: FixedRateRow[] }) {
  return (
    <div className="panel">
      <div className="panel-title">고정비율</div>
      <div className="panel-sub" style={{ marginBottom: 12 }}>
        조사로 받지 않고 정의상 정해진 비율입니다 (기타·직접비). 저장할 때마다 그 기간 배부율 표에 자동으로 채워집니다.
      </div>
      {periods.map((p) => {
        const list = rows.filter((r) => r.quarter === p);
        return (
          <div key={p} style={{ marginBottom: 16 }}>
            <div className="panel-sub" style={{ fontWeight: 700, color: "#1a202c", margin: "0 0 8px" }}>
              ■ {p} ({list.length}건)
            </div>
            {list.length === 0 ? (
              <div className="field-hint">아직 이 기간에 만들어진 고정비율 행이 없습니다 (아무 조직이나 저장하면 채워집니다).</div>
            ) : (
              <div className="tbl-scroll">
                <table className="rate-tbl">
                  <RateTableHead />
                  <tbody>
                    {list.map((r) => (
                      <ReadOnlyRateRow key={`${r.division}-${r.basis}`} label={`${r.division} · ${r.basis}`} period={p} rec={r.rates} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
