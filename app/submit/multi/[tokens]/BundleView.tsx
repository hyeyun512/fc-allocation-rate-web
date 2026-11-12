"use client";

import { useState } from "react";
import SubmitForm, { SubmitRound } from "../../[token]/SubmitForm";
import type { SubmitLang } from "@/lib/submitLang";

interface Entry {
  token: string;
  label: string;
  rounds: SubmitRound[];
  version: string;
  lang: SubmitLang;
}

/** 그 링크로 입력하는 조직이 모든 기간에 제출을 마쳤는지 (버튼을 초록색으로). */
function allSubmitted(e: Entry): boolean {
  return e.rounds.every((r) => r.data.orgs.length > 0 && r.data.orgs.every((o) => o.submittedThisPeriod));
}

/**
 * 관리자 '검토 및 확정' 화면처럼 위쪽에서 조직을 고른다.
 * 고르지 않은 조직 화면도 감춰 두기만 한다 — 다른 조직을 보고 돌아왔을 때 입력하던 값이 그대로 남아 있게.
 */
export default function BundleView({ entries }: { entries: Entry[] }) {
  const [selected, setSelected] = useState(entries[0].token);

  return (
    <>
      <div className="page page-form" style={{ paddingBottom: 0 }}>
        <div className="panel" style={{ padding: "12px 16px", marginBottom: 0 }}>
          <div className="av-chip-group">
            <span className="av-chip-label">조직 선택</span>
            {entries.map((e) => (
              <button
                key={e.token}
                type="button"
                className={`av-chip ${allSubmitted(e) ? "submitted" : ""} ${selected === e.token ? "active" : ""}`}
                onClick={() => {
                  setSelected(e.token);
                  window.scrollTo({ top: 0 });
                }}
              >
                {e.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      {entries.map((e) => (
        <div key={e.token} style={{ display: selected === e.token ? undefined : "none" }}>
          <SubmitForm token={e.token} rounds={e.rounds} version={e.version} lang={e.lang} />
        </div>
      ))}
    </>
  );
}
