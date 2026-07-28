# 고정비 배부율 조사 웹 (fc-Allocation-Rate-web)

팀별로 고유 링크를 발급해 분기(또는 반기)마다 배부율을 웹으로 제출받고, 담당자가 검토·확정하면
`allocation_rate` 테이블(최종 발행본, `fc-dashboard-web`이 그대로 소비)에 반영되는 Next.js + Supabase 앱입니다.

## 구조 (3계층)

1. **`allocation_orgs`** — 조직 마스터. 조직별 고유 입력 링크 토큰(`access_token`), 개인별 입력 필요 여부(`requires_person_detail`)를 관리.
2. **`allocation_submissions`** — 팀이 제출한 원본(확정 전). 조직 단위 1행 + (필요 시) 팀원별 여러 행. 재제출하면 새 행이 쌓이고, 가장 최근 행만 유효한 것으로 취급.
3. **`allocation_rate`** — 기존 발행 테이블. 담당자가 `/admin`에서 "확정"을 누르면 제출값(개인별이면 인원수 가중평균 롤업)이 이 테이블에 upsert됨. `fc-dashboard-web` 등 하위 소비 로직은 전혀 건드리지 않음.

라운드(현재 어떤 분기/버전을 받고 있는지)는 `allocation_settings` 단일 행으로 관리하며 `/admin`에서 바꿀 수 있습니다.

## 페이지

- `/submit/[token]` — 조직별 입력 폼 (로그인 없음, 토큰만으로 접근). 직전 확정값이 미리 채워져서 변경분만 수정하면 됨. `requires_person_detail`인 조직은 팀원별 입력 섹션이 추가로 뜸.
- `/admin` — 담당자 전용 (비밀번호 게이트). 조직별 제출 현황 확인, 롤업된 값 검토/수정 후 조직 단위로 "확정" → `allocation_rate` 반영. 상단에서 현재 라운드(기간/버전) 변경 가능.

## 로컬 실행

```bash
npm install
cp .env.local.example .env.local
# .env.local 을 열어 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / ADMIN_PASSWORD 입력
npm run dev
# http://localhost:3000
```

`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`는 `fc-dashboard-web`과 동일한 Supabase 프로젝트 값을 그대로 씁니다
(Supabase 대시보드 → Project Settings → API). `ADMIN_PASSWORD`는 담당자만 아는 비밀번호로 직접 정하세요.

이 프로젝트는 브라우저에서 Supabase에 직접 접근하지 않고, 모든 읽기/쓰기를 Next.js API route(서버)에서
`service_role` 키로 처리합니다. 키는 절대 클라이언트 컴포넌트에 노출되지 않습니다.

## 조직별 입력 링크 발급

```sql
select basis, division, requires_person_detail, access_token
from allocation_orgs
order by division, basis;
```

이 쿼리 결과의 `access_token`으로 `https://<배포주소>/submit/<access_token>` 링크를 만들어 각 팀 담당자에게 전달하면 됩니다.
링크는 조직마다 고유하고 만료되지 않으므로, 다음 분기에도 같은 링크를 재사용할 수 있습니다
(입력 시점의 `allocation_settings.current_period`가 자동으로 함께 저장됨).

## 새 라운드(다음 분기) 여는 법

1. `/admin` 페이지 상단 "현재 입력 라운드"에서 기간을 다음 값으로 바꾸고 저장 (예: `2026-Q3` → `2026-Q4`).
2. 기존에 발급된 조직별 링크를 그대로 재전달 (링크는 안 바뀜, 새 라운드 값으로 자동 반영됨).
3. 팀이 제출하면 `/admin`에서 검토 후 확정.

## 리소스배부율 vs 인원수비율

현재 `allocation_orgs`에는 **리소스배부율**(분기 업데이트, 조직이 직접 확인해서 확정하는 성격) 대상 조직만 시드되어 있습니다.
인원수비율/EVCS재료비비율/별도배부율/직접비 등은 특정 조직이 아니라 HR 인원수·재료비 비중 등 중앙에서 계산되는 값이라
이번 범위에서는 제외했습니다. 필요해지면 `allocation_orgs`에 해당 basis를 추가하고 반기 주기에 맞는 별도 라운드 관리가 필요합니다.

## 개인별 입력이 필요한 조직 (v1 가정)

지식재산팀, HUS, HSZ, 경영지원실, HR실, 사업 그룹 — 원본 엑셀에서 관계사·계열사(H.Mobility~H.Networks) 청구 비중이 있어
팀원별 시트로 관리되던 조직들입니다. 실제 하위 팀 구성(예: 경영지원실 = 회계팀+재무팀+법무팀+Staff)이 바뀌면
`allocation_orgs.requires_person_detail`을 직접 조정하세요.
