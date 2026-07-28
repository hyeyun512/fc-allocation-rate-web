export default function Home() {
  return (
    <div className="page page-narrow">
      <div className="panel">
        <div className="panel-title">고정비 배부율 조사</div>
        <div className="panel-sub">
          이 사이트는 조직별로 발급된 고유 링크로만 접속합니다. 받으신 입력 링크(예: /submit/xxxxxxxx)로 접속해주세요.
        </div>
        <div className="callout info">
          담당자이신가요? <a href="/admin" style={{ color: "#2563eb", fontWeight: 700 }}>/admin</a> 페이지에서 제출 현황을 검토·확정할 수 있습니다.
        </div>
      </div>
    </div>
  );
}
