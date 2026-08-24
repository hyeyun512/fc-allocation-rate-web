import { redirect } from "next/navigation";

// 안내만 담고 있던 첫 화면은 없앴다. 사이트 전체가 열람 암호 뒤에 있으므로 여기까지 온 사람은
// 이미 통과한 담당자이고, 안내가 아니라 검토·확정 화면이 필요하다.
// 조사 입력은 이 경로를 타지 않는다 — 부서에는 /submit/<토큰> 링크가 그대로 나간다.
export default function Home() {
  redirect("/confirm");
}
