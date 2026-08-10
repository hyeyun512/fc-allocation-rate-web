/**
 * 엑셀에서 복사한 내용을 표에 붙여넣기 위한 공용 처리.
 *
 * 두 가지를 해결한다.
 *  1) 여러 셀을 복사해도 한 칸에 다 들어가던 문제 — 탭/줄바꿈으로 나눠 여러 칸에 채운다.
 *  2) 소수점이 잘리던 문제 — 클립보드의 일반 텍스트에는 **화면에 보이는 값**만 담긴다.
 *     셀 서식이 소수점 둘째 자리면 3.4559688%가 "3.46%"로 복사된다.
 *     엑셀은 HTML 형식에 셀의 원본 숫자를 x:num 속성으로 함께 넣어주므로 그 값을 우선 쓴다.
 */

export function normalizePasteCell(cell: string): string {
  return cell.trim().replace(/%$/, "").replace(/,/g, "");
}

/** 일반 텍스트를 탭(열)/줄바꿈(행) 기준으로 표로 나눈다. 중간 빈 줄은 살린다. */
export function parsePasteText(text: string): string[][] {
  const body = text.replace(/\r/g, "").replace(/\n+$/, "");
  if (body === "") return [];
  return body.split("\n").map((line) => line.split("\t").map(normalizePasteCell));
}

/**
 * 엑셀 클립보드의 HTML에서 표를 읽는다. 원본값(x:num)이 있으면 그걸 쓴다.
 * 퍼센트 서식 셀의 x:num은 이미 분수(0.034559688…)라 화면 단위(%)에 맞춰 100을 곱한다.
 */
export function parseExcelHtmlGrid(html: string): string[][] | null {
  if (!html || typeof DOMParser === "undefined" || !/<t[rd]\b/i.test(html)) return null;
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch {
    return null;
  }
  const rows = Array.from(doc.querySelectorAll("tr"));
  if (rows.length === 0) return null;

  const grid = rows.map((tr) =>
    Array.from(tr.querySelectorAll("td,th")).map((cell) => {
      const text = (cell.textContent ?? "").replace(/ /g, " ").trim();
      const raw = cell.getAttribute("x:num");
      const n = raw == null || raw === "" ? NaN : Number(raw);
      if (!Number.isFinite(n)) return normalizePasteCell(text);
      return text.includes("%") ? String(n * 100) : String(n);
    })
  );
  return grid.some((r) => r.length > 0) ? grid : null;
}

/** 붙여넣기 내용을 표로 읽는다 — 엑셀 원본값이 있으면 그쪽을 우선한다. */
export function readPasteGrid(clipboard: DataTransfer): string[][] {
  return parseExcelHtmlGrid(clipboard.getData("text/html")) ?? parsePasteText(clipboard.getData("text"));
}

/**
 * 기본 붙여넣기 대신 직접 처리해야 하는지.
 * 여러 칸을 복사했을 때는 물론, 한 칸이라도 엑셀에서 온 것이면(원본값이 잘리므로) 직접 처리한다.
 */
export function shouldHandlePaste(clipboard: DataTransfer): boolean {
  const text = clipboard.getData("text");
  if (text.includes("\t") || text.includes("\n")) return true;
  return parseExcelHtmlGrid(clipboard.getData("text/html")) !== null;
}

/**
 * 한 줄짜리 입력 묶음(예: 본사~홀딩스)에 붙여넣을 때 쓰는 도우미.
 * 시작 칸부터 순서대로 채우고, 값이 비어 있으면 빈 문자열로 채워 뒷값이 앞으로 밀리지 않게 한다.
 */
export function applyRowPaste(
  clipboard: DataTransfer,
  startIndex: number,
  count: number,
  setAt: (index: number, value: string) => void
): void {
  const row = readPasteGrid(clipboard)[0] ?? [];
  row.forEach((token, offset) => {
    const idx = startIndex + offset;
    if (idx < count) setAt(idx, token);
  });
}
