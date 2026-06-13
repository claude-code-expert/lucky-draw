/*
  상태 보존(NFR-3) — localStorage 에 마지막 '확정' 상태를 저장해 새로고침에 대비.
  EC-7: 회전 중 새로고침은 진행 라운드를 무효화한다 → 회전 중 상태는 저장하지 않고,
        복원 시 isSpinning 은 항상 false, currentParticipantId 는 비워 다음 라운드부터 재개.
*/

import type { AppState } from "./types.js";

const KEY = "lucky-draw/state";
const VERSION = 1;

interface Envelope {
  version: number;
  state: AppState;
}

/** 확정 상태만 저장. 회전 중(isSpinning)이면 저장을 건너뛴다. */
export function saveState(state: AppState): void {
  if (state.isSpinning) return;
  try {
    const env: Envelope = { version: VERSION, state };
    localStorage.setItem(KEY, JSON.stringify(env));
  } catch {
    // 용량 초과/비활성 환경 등은 무시(저장은 선택 기능).
  }
}

/** 저장된 상태 복원. 없거나 버전이 다르면 null. 복원 시 회전 상태는 정리한다. */
export function loadState(): AppState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const env = JSON.parse(raw) as Envelope;
    if (env.version !== VERSION || !env.state) return null;
    return {
      ...env.state,
      isSpinning: false, // 진행 중이던 회전은 무효(EC-7)
      currentParticipantId: null, // 다음 라운드부터 다시 지정
    };
  } catch {
    return null;
  }
}

export function clearState(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 무시 */
  }
}
