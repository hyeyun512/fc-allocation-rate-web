/**
 * 코멘트 자동 번역 (한국어 → 영어).
 *
 * 담당자가 현지인이라 영어로 나가는 조직(lib/englishOrgs.ts)의 링크에서, 관리자가 한국어로 적어둔
 * 코멘트를 영어로 바꿔 보여준다. 번역은 Claude API로 하고 결과는 Supabase에 캐시하므로
 * 같은 코멘트를 두 번 번역하지 않는다 — 한 번 번역된 코멘트는 이후로는 즉시 표시된다.
 *
 * 세 단계로 찾는다: 손으로 확정해둔 문구(englishOrgs의 NOTE_EN) → 캐시 → Claude API.
 * 어느 단계에서 실패하든 **원문(한국어)을 그대로 보여주고 화면은 정상적으로 뜬다** —
 * 번역이 안 됐다고 담당자가 값을 못 보는 일은 없어야 한다.
 *
 * 서버 전용 모듈이다 (조직명·코멘트 원문·API 키가 얽혀 있어 클라이언트 번들에 넣지 않는다).
 */

import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "crypto";
import { SubmitLang } from "./submitLang";
import { manualNoteEn, submitLangOf, PERSON_NAME_EN } from "./englishOrgs";

/** 배부율 조사에서만 쓰는 말이라 그대로 두면 오역되는 것들을 미리 알려준다. */
const GLOSSARY = [
  "배부율 = allocation rate (리소스배부율 = resource allocation rate)",
  "청구 = billing / charged to",
  "본사 = head office, 법인 = subsidiary, 주재원 = expatriate",
  "인원수 = headcount, 투입(률) = allocation / utilisation",
  "매출 = revenue, 세무조사 = tax audit, 계약직 = fixed-term contract",
  "관계사·계열사 = affiliates, 자가사용 = self-use",
].join("\n");

const SYSTEM = `You translate short internal business comments from Korean into English.

The reader is a British colleague at Humax who manages the UK subsidiary. They know the business
but do not read Korean. Translate for them: British spelling, plain professional English, no padding.

Rules:
- Output the translation only. No preamble, no notes, no explanation of your choices.
- Keep every code, product name, and organisation code exactly as written: STB, EVCS, Mobility,
  Humax, HKR, H.Mobility, H.EV, Hiparking, Peoplecar, Winercom, Holdings, H.Networks, and
  three-letter subsidiary codes such as HUK, HDG, HUS, HMX, HSZ, HBR.
- Keep the original structure: bracket tags like [STB], separators like " / ", and the order of clauses.
- Keep numbers, percentages, and quarter labels (1H, 2H, 1Q~4Q) exactly as they are.
- Names of people: use the spelling given below when the name appears; otherwise romanise as
  "Givenname Familyname".
- If a passage is already in English, leave it as it is.

Known people:
${Object.entries(PERSON_NAME_EN)
  .map(([ko, en]) => `- ${ko} = ${en}`)
  .join("\n")}

Glossary:
${GLOSSARY}`;

const MODEL = "claude-opus-5";
/** 코멘트는 500자 이내라 짧다. 생각 토큰까지 넉넉히 담을 만큼만 잡는다. */
const MAX_TOKENS = 8000;

const SCHEMA = {
  type: "object",
  properties: {
    translations: {
      type: "array",
      description: "English translations, in the same order as the input notes.",
      items: { type: "string" },
    },
  },
  required: ["translations"],
  additionalProperties: false,
};

/** 한글이 한 글자도 없으면 번역할 것이 없다 (이미 영어이거나 숫자뿐인 코멘트). */
export function hasKorean(text: string): boolean {
  return /[가-힣]/.test(text);
}

function hashOf(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Claude API로 여러 코멘트를 한 번에 번역한다. 실패하면 null (원문을 그대로 쓴다). */
async function askClaude(notes: string[]): Promise<string[] | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  try {
    // 번역이 늦어져도 화면이 붙잡히면 안 된다 — 20초 안에 답이 없으면 포기하고 원문으로 넘어간다.
    const client = new Anthropic({ timeout: 20_000, maxRetries: 1 });
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // 안전 분류기에 걸려 번역이 거절되면 다른 모델로 자동으로 넘겨 다시 시도한다.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      // 짧은 번역이라 깊이 생각할 필요가 없다. 생각을 아예 끄면 응답에 태그가 새는 경우가 있어
      // 켜둔 채로 effort만 낮춘다.
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content: JSON.stringify({ notes }) }],
    });

    if (res.stop_reason === "refusal") return null;

    const text = res.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (!text.trim()) return null;

    const parsed = JSON.parse(text) as { translations?: unknown };
    const list = parsed.translations;
    // 개수가 어긋나면 어느 번역이 어느 코멘트인지 알 수 없다 — 통째로 버리고 원문을 쓴다.
    if (!Array.isArray(list) || list.length !== notes.length) return null;
    if (!list.every((t) => typeof t === "string" && t.trim())) return null;
    return list as string[];
  } catch {
    // 키가 없거나 네트워크·API 오류 — 번역만 포기하고 화면은 원문으로 그대로 나간다.
    return null;
  }
}

/**
 * 코멘트 → 영어 번역 표. 키는 넘긴 원문 그대로이며, 번역하지 못한 코멘트는 표에 없다
 * (호출부에서 `map.get(note) ?? note`로 원문을 쓰면 된다).
 */
export async function translateNotes(
  supabase: any,
  rawNotes: (string | null | undefined)[],
  lang: SubmitLang
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (lang !== "en") return out;

  // 빈 값·중복·한글이 없는 코멘트는 번역 대상이 아니다.
  const notes = Array.from(new Set(rawNotes.filter((n): n is string => !!n && hasKorean(n))));
  if (notes.length === 0) return out;

  // 1) 손으로 확정해둔 문구가 있으면 그게 우선이다.
  const rest: string[] = [];
  for (const note of notes) {
    const manual = manualNoteEn(note);
    if (manual) out.set(note, manual);
    else rest.push(note);
  }
  if (rest.length === 0) return out;

  // 2) 이미 번역해둔 것이 있으면 그대로 쓴다.
  const hashes = rest.map(hashOf);
  const byHash = new Map<string, string>();
  try {
    const { data } = await supabase
      .from("allocation_note_translations")
      .select("source_hash,translated")
      .eq("lang", lang)
      .in("source_hash", hashes);
    (data ?? []).forEach((r: any) => byHash.set(r.source_hash, r.translated));
  } catch {
    // 캐시를 못 읽어도 아래에서 새로 번역하면 된다.
  }

  const misses: string[] = [];
  rest.forEach((note, i) => {
    const cached = byHash.get(hashes[i]);
    if (cached) out.set(note, cached);
    else misses.push(note);
  });
  if (misses.length === 0) return out;

  // 3) 남은 것만 새로 번역하고, 다음부터는 바로 뜨도록 캐시에 넣어둔다.
  const fresh = await askClaude(misses);
  if (!fresh) return out;

  misses.forEach((note, i) => out.set(note, fresh[i]));
  try {
    await supabase.from("allocation_note_translations").upsert(
      misses.map((note, i) => ({
        source_hash: hashOf(note),
        lang,
        source_text: note,
        translated: fresh[i],
      })),
      { onConflict: "source_hash,lang" }
    );
  } catch {
    // 캐시 저장에 실패해도 이번 화면은 번역된 값으로 나간다 (다음에 다시 번역할 뿐이다).
  }

  return out;
}

/**
 * 코멘트를 저장하는 시점에 미리 번역해 캐시에 넣어둔다 — 담당자가 링크를 열었을 때 기다리지 않도록.
 * 영어로 나가지 않는 조직은 아무것도 하지 않는다. 저장 자체는 이미 끝난 뒤라 실패해도 조용히 넘어간다.
 */
export async function warmNoteTranslations(
  supabase: any,
  basis: string,
  notes: (string | null | undefined)[]
): Promise<void> {
  const lang = submitLangOf(basis);
  if (lang !== "en") return;
  try {
    await translateNotes(supabase, notes, lang);
  } catch {
    /* 미리 번역해두려던 것뿐이라, 실패하면 링크를 열 때 번역한다. */
  }
}
