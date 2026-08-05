import { redirect } from "next/navigation";

// '조사'는 검토 및 확정 하위 탭으로 이동했다.
export default function AdminIndexPage() {
  redirect("/admin/confirm");
}
