/**
 * 조사 링크(access_token)를 **누가 갖고 있고 그 링크로 어디까지 열리는지**를 한 곳에서 판정한다.
 *
 * 집계 조직(개발 그룹 등)은 링크가 하나뿐이고 그 한 화면에서 하위 조직까지 입력받는다.
 * 그래서 하위 팀에는 자기 링크가 따로 없고, 조사 현황 표도 하위 행에는 복사 버튼 대신 '↑'만 그린다.
 *
 * 예전에는 이 판정이 세 군데(표의 ↑ 판단 / 화면에 내려주는 토큰 / 발송 라우트)에 따로 있었다.
 * 셋이 어긋나도 컴파일은 통과하므로 **메일에 담긴 링크와 화면의 복사 버튼이 조용히 달라질 수 있었다.**
 * 여기 한 곳으로 모은다.
 *
 * `period`를 반드시 받는 이유: 상위 조직이 그 분기에 존재하지 않으면(orgLifespan) 하위 조직이
 * 최상위로 올라와 자기 토큰을 쓰게 된다. 분기를 모르고 판정하면 화면과 갈라진다.
 */

import { isOrgActiveIn } from "./orgLifespan";
import { HIDDEN_IN_CONFIRM } from "./autoAggregate";

export interface OrgLite {
  id: number;
  basis: string;
  parent_basis: string | null;
  access_token: string;
  active?: boolean;
}

/**
 * 조사 현황 표에 실제로 나타나는 조직인지 — 세 가지 조건을 전부 통과해야 한다.
 * (confirm/page.tsx가 목록을 만들 때 쓰는 조건과 같아야 한다. 하나라도 빠지면 표에 없는 조직에
 *  발송하거나, 반대로 표에 있는 조직을 발송 대상에서 빠뜨린다.)
 */
export function isInSurvey(org: OrgLite, period: string): boolean {
  if (org.active === false) return false;
  if (!isOrgActiveIn(org.basis, period)) return false;
  if (HIDDEN_IN_CONFIRM.includes(org.basis)) return false;
  return true;
}

/**
 * 이 조직의 조사 링크를 **실제로 갖고 있는 조직**.
 * 상위 조직이 이번 분기 표에 있으면 그 상위가 링크 주인이고, 없으면 자기 자신이 주인이다.
 * 표에 나타나지 않는 조직이면 null.
 */
export function linkOrgOf(orgs: OrgLite[], orgId: number, period: string): OrgLite | null {
  const org = orgs.find((o) => o.id === orgId);
  if (!org || !isInSurvey(org, period)) return null;
  if (!org.parent_basis) return org;

  const parent = orgs.find((o) => o.basis === org.parent_basis && isInSurvey(o, period));
  // 상위가 이번 분기에 없으면(수명이 끝났거나 감춰졌으면) 이 조직이 최상위가 되어 자기 링크를 쓴다.
  return parent ?? org;
}

/** 이 조직의 담당자에게 보내야 할 링크의 토큰. 표에 없는 조직이면 null. */
export function linkTokenOf(orgs: OrgLite[], orgId: number, period: string): string | null {
  return linkOrgOf(orgs, orgId, period)?.access_token ?? null;
}

/** 이 조직이 링크 주인인지 — 조사 현황 표에서 복사 버튼과 발송(✉)이 붙는 행. */
export function isTokenOwner(orgs: OrgLite[], orgId: number, period: string): boolean {
  return linkOrgOf(orgs, orgId, period)?.id === orgId;
}

/**
 * 이 토큰 하나로 값을 넣거나 볼 수 있는 조직 전부 (링크 주인 자신 포함).
 * **수신자 후보 집합**이 이것이다 — 발송 라우트는 이 범위 밖 조직에는 절대 보내지 않는다.
 *
 * 조사 현황 표 기준(세 필터)이라, 표에 안 보이는 조직은 후보에서 빠진다.
 * 링크 화면이 실제로 몇 개를 띄우는지와는 다를 수 있다 — 그건 linkOpensChildren이 따로 본다.
 */
export function tokenScopeOf(orgs: OrgLite[], linkOrgId: number, period: string): OrgLite[] {
  const owner = orgs.find((o) => o.id === linkOrgId);
  if (!owner || !isInSurvey(owner, period)) return [];
  const children = orgs.filter((o) => o.parent_basis === owner.basis && isInSurvey(o, period));
  return [owner, ...children];
}

/**
 * 이 링크를 열면 **자기 조직 말고 다른 조직도 보이는가**.
 *
 * 메일 본문이 "이 링크는 귀 조직 전용입니다"라고 쓸지 광역 고지를 할지를 이 값이 가른다.
 * 그래서 조사 현황 표 기준이 아니라 **링크 화면이 실제로 쓰는 기준**(parent_basis + active)으로 센다
 * (submit/[token]/page.tsx). 표에서는 감춰졌지만 링크 화면에는 뜨는 조직이 있으면
 * 표 기준으로 판정한 문구는 거짓이 된다 — 본문은 링크가 여는 것을 말해야 한다.
 */
export function linkOpensChildren(orgs: OrgLite[], linkOrgId: number): boolean {
  const owner = orgs.find((o) => o.id === linkOrgId);
  if (!owner) return false;
  return orgs.some((o) => o.parent_basis === owner.basis && o.active !== false);
}
