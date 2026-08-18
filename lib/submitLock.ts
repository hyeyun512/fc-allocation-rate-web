/**
 * 조사 링크 화면의 잠금 상태.
 *
 * **'이미 제출되었습니다' 안내와 수정 가능한 입력칸은 절대 함께 나타나면 안 된다.**
 * 제출이 끝났으면 고칠 수 없어야 하고, 아직 제출 전이면 그런 안내가 뜰 이유가 없다.
 *
 * 예전에는 입력칸의 editable과 안내를 띄우는 조건을 화면 두 곳에서 따로 적었다.
 * 그래서 서버가 '이미 제출됨'으로 막은 응답을 오류 문구로만 띄우면, 아래에는 제출됐다는
 * 안내가 뜨고 위 표는 여전히 고칠 수 있는 어긋난 화면이 됐다(지식재산팀 사례).
 *
 * 두 값을 여기서 **함께** 계산해 서로 어긋날 수 없게 한다 — showLockedNotice는 정의상
 * editable의 반대이므로, 둘이 동시에 참이 되는 상태는 만들 수 없다.
 */
export interface SubmitLockInput {
  /** 이번 분기에 제출된 값이 있는가 (lib/rollup.ts hasSubmittedValue와 같은 판정). */
  submitted: boolean;
  /** 관리자가 열어줬거나, 아직 제출 전 임시저장 중이라 고칠 수 있는가. */
  unlocked: boolean;
}

export interface SubmitLockState {
  /** 입력칸을 고칠 수 있는가. */
  editable: boolean;
  /** '이미 제출되었습니다' 안내를 띄울 것인가. */
  showLockedNotice: boolean;
}

export function submitLockState({ submitted, unlocked }: SubmitLockInput): SubmitLockState {
  const editable = !submitted || unlocked;
  // 정의상 서로 반대다. 이 한 줄이 '안내 + 수정 가능'이라는 조합을 구조적으로 막는다.
  return { editable, showLockedNotice: !editable };
}
