"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setLoading(false);
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json.error || "로그인에 실패했습니다.");
      return;
    }
    router.push(searchParams.get("next") || "/admin");
    router.refresh();
  }

  return (
    <form className="panel" onSubmit={handleSubmit}>
      <div className="panel-title">담당자 로그인</div>
      <div className="panel-sub">배부율 검토/확정 화면은 비밀번호로 보호되어 있습니다.</div>
      <div className="field" style={{ marginBottom: 14 }}>
        <label>비밀번호</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
      </div>
      {error && <div className="callout alert">{error}</div>}
      <button className="btn btn-primary" type="submit" disabled={loading}>
        {loading ? "확인 중..." : "로그인"}
      </button>
    </form>
  );
}

export default function AdminLoginPage() {
  return (
    <div className="page page-narrow">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
