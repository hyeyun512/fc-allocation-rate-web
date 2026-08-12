import { NextRequest, NextResponse } from "next/server";
import { readMsgFile, msgToTemplate } from "@/lib/msgFile";
import { mailTemplateProblem } from "@/lib/linkMail";

/**
 * Outlook `.msg` 파일에서 제목·본문을 읽어 **문구 초안으로 돌려준다** (저장은 하지 않는다).
 *
 * 바로 저장하지 않는 이유: 사람이 쓴 메일에는 이번 분기와 이번 날짜가 박혀 있어서
 * 자리표시자로 바꿔 줘야 하는데, 그 자동 변환이 항상 맞는다고 볼 수 없다.
 * 화면에서 무엇이 어떻게 바뀌었는지 보고 확인한 뒤 저장하게 한다.
 */
export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(req: NextRequest) {
  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
  } catch {
    return NextResponse.json({ error: "파일을 읽지 못했습니다." }, { status: 400 });
  }

  if (!file) return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "파일이 너무 큽니다 (5MB 이내)." }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const mail = readMsgFile(buf);
  if (!mail) {
    return NextResponse.json(
      { error: "Outlook .msg 파일로 읽히지 않습니다. Outlook에서 ‘다른 이름으로 저장 → Outlook 메시지 형식(.msg)’으로 저장했는지 확인해 주세요." },
      { status: 400 }
    );
  }

  const tpl = msgToTemplate(mail);
  // 링크 자리표시자는 msgToTemplate이 넣어주므로 여기서 걸릴 일은 거의 없지만, 계약은 지킨다.
  const problem = mailTemplateProblem(tpl.subject, tpl.body);

  return NextResponse.json({
    ok: true,
    subject: tpl.subject,
    body: tpl.body,
    original: mail,
    problem,
  });
}
