/**
 * 담당자 이름·메일을 **엑셀에서 한 번에 붙여넣기**.
 *
 * 조직이 서른 곳이 넘는데 칸마다 하나씩 치는 건 현실적이지 않다. 조직 목록을 엑셀로 내보내
 * 메일 열만 채운 뒤 통째로 붙여넣으면 한 번에 들어가게 한다.
 *
 * **열 순서를 요구하지 않는다.** 붙여넣은 표에서 @가 든 칸을 메일로, 조직명과 일치하는 칸을
 * 조직으로 보고, 남은 칸을 이름으로 읽는다. 사람이 열 순서를 맞추게 하면 그 자체가 또 일이다.
 *
 * 순수 함수라 화면 미리보기와 서버 저장이 같은 판정을 쓴다 — 미리보기에서 본 것과
 * 실제로 저장되는 것이 달라지면 안 된다.
 */

import { isValidEmail, normalizeEmail } from "./linkMail";

export interface PasteOrg {
  id: number;
  basis: string;
  /** 지금 저장돼 있는 값 — 무엇이 바뀌는지 미리 보여주려고 함께 받는다. */
  currentName: string;
  currentEmail: string;
}

export type PasteStatus =
  | "ok" // 저장할 값이 있다
  | "same" // 이미 같은 값이라 건드릴 게 없다
  | "no-org" // 조직명을 못 찾았다
  | "bad-email" // 메일 형식이 아니다
  | "empty"; // 조직만 있고 넣을 값이 없다

export interface PasteMatch {
  inputOrg: string;
  orgId: number | null;
  orgBasis: string;
  name: string;
  email: string;
  currentName: string;
  currentEmail: string;
  status: PasteStatus;
}

/** 조직명 비교용 — 띄어쓰기·대소문자·괄호 앞뒤 공백 차이로 못 찾는 일이 없게 한다. */
export function normalizeOrgName(s: string): string {
  return String(s ?? "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function looksLikeEmail(cell: string): boolean {
  return cell.includes("@");
}

/**
 * 메일을 적으려다 잘못 적은 칸인지 (@를 빠뜨렸다든지).
 *
 * 이걸 구분하지 않으면 오타난 주소가 조용히 **담당자 이름**으로 저장된다 —
 * 실제로 그렇게 이름이 덮인 적이 있다. 사람 이름으로 볼 수 없는 모양이면 메일 실패로 처리한다.
 */
function looksLikeBrokenEmail(cell: string): boolean {
  if (cell.includes("@")) return true;
  // 사람 이름과 가르는 기준: 공백 없는 **전부 소문자** ASCII이면서 . _ - 나 숫자가 섞여 있으면 주소로 본다.
  // 한글 이름은 ASCII가 아니라서, 'Jean-Pierre' 같은 이름은 대문자가 있어서 걸리지 않는다.
  if (!/^[a-z0-9._%+-]+$/.test(cell)) return false;
  return /[._\-0-9]/.test(cell);
}

/** 머리글 줄이면 열 위치를 알려준다 (내가 내보낸 템플릿을 그대로 붙여넣는 경우). */
function headerIndexes(row: string[]): { org: number; name: number; email: number } | null {
  const idx = { org: -1, name: -1, email: -1 };
  row.forEach((cell, i) => {
    const c = cell.trim().toLowerCase();
    if (idx.email < 0 && /메일|mail/.test(c)) idx.email = i;
    else if (idx.org < 0 && /조직|부서|org/.test(c)) idx.org = i;
    else if (idx.name < 0 && /담당|이름|name/.test(c)) idx.name = i;
  });
  return idx.email >= 0 && idx.org >= 0 ? idx : null;
}

/**
 * 붙여넣은 표를 조직에 맞춰 읽는다.
 * 헤더 줄(조직도 메일도 없는 줄)은 조용히 건너뛴다 — 엑셀에서 머리글까지 복사해오는 게 보통이다.
 */
export function matchPastedManagers(grid: string[][], orgs: PasteOrg[]): PasteMatch[] {
  const byName = new Map<string, PasteOrg>();
  orgs.forEach((o) => byName.set(normalizeOrgName(o.basis), o));

  const out: PasteMatch[] = [];

  // 머리글이 있으면 열 위치를 그대로 쓴다 — 값만 보고 짐작하는 것보다 정확하다.
  const header = grid.length > 0 ? headerIndexes(grid[0].map((c) => String(c ?? ""))) : null;

  grid.forEach((rawRow, rowIndex) => {
    if (header && rowIndex === 0) return; // 머리글 줄 자체는 건너뛴다
    const trimmed = rawRow.map((c) => String(c ?? "").trim());
    const cells = trimmed.filter((c) => c !== "");
    if (cells.length === 0) return;

    let emailCell: string;
    let orgCell: string;
    let nameCell: string;

    if (header) {
      emailCell = trimmed[header.email] ?? "";
      orgCell = trimmed[header.org] ?? "";
      nameCell = header.name >= 0 ? trimmed[header.name] ?? "" : "";
    } else {
      // 메일로 쓰려던 칸을 먼저 잡는다. @가 빠졌어도 이름으로 넘기지 않고 오류로 잡아야 한다.
      emailCell = cells.find(looksLikeEmail) ?? cells.find(looksLikeBrokenEmail) ?? "";
      orgCell = cells.find((c) => c !== emailCell && byName.has(normalizeOrgName(c))) ?? "";
      nameCell = cells.find((c) => c !== emailCell && c !== orgCell) ?? "";
    }

    // 조직도 메일도 없으면 머리글이거나 빈 줄이다.
    if (!orgCell && !emailCell) return;
    const org = orgCell ? byName.get(normalizeOrgName(orgCell)) ?? null : null;

    if (!org) {
      out.push({
        inputOrg: orgCell || cells[0],
        orgId: null,
        orgBasis: "",
        name: nameCell,
        email: normalizeEmail(emailCell),
        currentName: "",
        currentEmail: "",
        status: "no-org",
      });
      return;
    }

    const email = normalizeEmail(emailCell);
    if (email !== "" && !isValidEmail(email)) {
      out.push({
        inputOrg: orgCell,
        orgId: org.id,
        orgBasis: org.basis,
        name: nameCell,
        email,
        currentName: org.currentName,
        currentEmail: org.currentEmail,
        status: "bad-email",
      });
      return;
    }

    if (email === "" && nameCell === "") {
      out.push({
        inputOrg: orgCell,
        orgId: org.id,
        orgBasis: org.basis,
        name: "",
        email: "",
        currentName: org.currentName,
        currentEmail: org.currentEmail,
        status: "empty",
      });
      return;
    }

    // 붙여넣은 값이 지금 값과 같으면 굳이 저장하지 않는다 —
    // 저장하면 email_set_period가 갱신되어 '이번 분기에 확인한 주소'로 바뀌기 때문이다.
    const sameEmail = email === "" || email === org.currentEmail;
    const sameName = nameCell === "" || nameCell === org.currentName;

    out.push({
      inputOrg: orgCell,
      orgId: org.id,
      orgBasis: org.basis,
      name: nameCell,
      email,
      currentName: org.currentName,
      currentEmail: org.currentEmail,
      status: sameEmail && sameName ? "same" : "ok",
    });
  });

  return out;
}

/** 실제로 저장할 것만 추린다. */
export function applicableRows(matches: PasteMatch[]): PasteMatch[] {
  return matches.filter((m) => m.status === "ok" && m.orgId != null);
}

/** 엑셀에 붙여 쓸 조직 목록 (조직 / 담당자 / Outlook 메일). 머리글을 함께 준다. */
export function buildPasteTemplate(orgs: PasteOrg[]): string {
  const header = ["조직", "담당자", "Outlook 메일"].join("\t");
  const lines = orgs.map((o) => [o.basis, o.currentName, o.currentEmail].join("\t"));
  return [header, ...lines].join("\n");
}
