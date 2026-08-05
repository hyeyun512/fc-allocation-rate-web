import Link from "next/link";

export default function AdminNav({ active }: { active: "view" | "confirm" }) {
  return (
    <div className="admin-tabs">
      <Link href="/admin/view" className={`admin-tab ${active === "view" ? "active" : ""}`}>
        View
      </Link>
      <Link href="/admin/confirm" className={`admin-tab ${active === "confirm" ? "active" : ""}`}>
        검토 및 확정
      </Link>
    </div>
  );
}
