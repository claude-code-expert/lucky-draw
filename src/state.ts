/*
  상태 기계 — AppState 와 순수 전이 함수들.
  모든 전이는 (state, ...) => 새 state 형태로, 입력 state 를 변형하지 않는다.
  UI 는 이 함수들이 만든 새 상태를 받아 다시 그리기만 한다(단방향 흐름).
*/

import type {
  AppState,
  DrawResult,
  Participant,
  ParticipantId,
  Prize,
} from "./types.js";
import { buildSlots, randomInt, remainingPrizes, type Rng } from "./draw.js";

const defaultRng: Rng = Math.random;

/* ── ID 생성 ─────────────────────────────────────────────
   라벨이 중복돼도(FR-1.2) 내부 id 는 고유해야 하므로 단조 증가 카운터를 쓴다. */
let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${idCounter}`;
}

/* ── 초기 상태 ───────────────────────────────────────── */
export function createInitialState(): AppState {
  return {
    phase: "setup",
    participants: [],
    prizes: [],
    slots: [],
    results: [],
    currentParticipantId: null,
    isSpinning: false,
    missOnceMode: false,
    selectionMode: "auto",
  };
}

/* ── 입력 파싱 (FR-1, FR-2) ──────────────────────────── */

/** 줄바꿈/쉼표로 구분된 이름 목록 → 라벨 배열. 공백/빈 항목 제거(FR-1.3). */
export function parseNames(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** 인원 수 N → "1".."N" 라벨. 0 이하면 빈 배열. */
export function rangeLabels(n: number): string[] {
  if (!Number.isFinite(n) || n < 1) return [];
  const count = Math.floor(n);
  return Array.from({ length: count }, (_, i) => String(i + 1));
}

/** 줄바꿈으로 구분된 경품 목록 → 이름 배열. 각 줄 = 1개(FR-2.2). */
export function parsePrizeNames(text: string): string[] {
  return text
    .split(/\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function toParticipants(labels: string[]): Participant[] {
  return labels.map((label) => ({ id: nextId("p"), label, status: "eligible" }));
}

function toPrizes(names: string[]): Prize[] {
  return names.map((name) => ({ id: nextId("z"), name, consumed: false }));
}

export function setParticipantsFromNames(state: AppState, text: string): AppState {
  return { ...state, participants: toParticipants(parseNames(text)) };
}

export function setParticipantsFromCount(state: AppState, n: number): AppState {
  return { ...state, participants: toParticipants(rangeLabels(n)) };
}

export function setPrizes(state: AppState, text: string): AppState {
  return { ...state, prizes: toPrizes(parsePrizeNames(text)) };
}

export function setMissOnceMode(state: AppState, on: boolean): AppState {
  return { ...state, missOnceMode: on };
}

export function setSelectionMode(state: AppState, mode: "auto" | "manual"): AppState {
  return { ...state, selectionMode: mode };
}

/** 중복 라벨 목록(경고 표시용, FR-1.2). 식별 자체는 고유 id 로 한다. */
export function duplicateLabels(participants: readonly Participant[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const p of participants) {
    if (seen.has(p.label)) dup.add(p.label);
    seen.add(p.label);
  }
  return [...dup];
}

/* ── 파생 선택자 ─────────────────────────────────────── */

export function eligibleParticipants(state: AppState): Participant[] {
  return state.participants.filter((p) => p.status === "eligible");
}

export function remainingPrizeCount(state: AppState): number {
  return remainingPrizes(state.prizes).length;
}

/** 진행 라운드 번호(1-base) = 지금까지 확정된 결과 수 + 1. */
export function roundNumber(state: AppState): number {
  return state.results.length + 1;
}

export function getParticipant(state: AppState, id: ParticipantId | null): Participant | null {
  if (id == null) return null;
  return state.participants.find((p) => p.id === id) ?? null;
}

export function currentParticipant(state: AppState): Participant | null {
  return getParticipant(state, state.currentParticipantId);
}

/** 시작 가능 여부 — 경품>0 AND 참가자>0 (FR-2.3, EC-6). */
export function canStart(state: AppState): boolean {
  return state.prizes.length > 0 && state.participants.length > 0;
}

/* ── 전이 ─────────────────────────────────────────────── */

/**
 * 추첨 시작 — phase setup→drawing, 첫 슬롯 구성.
 * auto 모드면 첫 참가자도 무작위 지정한다(FR-6.1).
 */
export function startDraw(state: AppState, rng: Rng = defaultRng): AppState {
  const next: AppState = {
    ...state,
    phase: "drawing",
    slots: buildSlots(state.prizes, rng),
    results: [],
    isSpinning: false,
    currentParticipantId: null,
  };
  return state.selectionMode === "auto" ? assignNextParticipant(next, rng) : next;
}

/** auto 모드: 남은 참가자 중 무작위 1명을 현재 참가자로 지정. 없으면 null 유지. */
export function assignNextParticipant(state: AppState, rng: Rng = defaultRng): AppState {
  const pool = eligibleParticipants(state);
  if (pool.length === 0) return { ...state, currentParticipantId: null };
  const pick = pool[randomInt(pool.length, rng)]!;
  return { ...state, currentParticipantId: pick.id };
}

/** manual 모드: 사용자가 명단에서 직접 지정. */
export function selectParticipant(state: AppState, id: ParticipantId): AppState {
  const target = state.participants.find((p) => p.id === id);
  if (!target || target.status !== "eligible") return state;
  return { ...state, currentParticipantId: id };
}

/** 회전 시작 — 입력/재시작 잠금(FR-3.4). */
export function beginSpin(state: AppState): AppState {
  return { ...state, isSpinning: true };
}

/**
 * 회전 종료 처리 — 결과 슬롯 인덱스를 받아 당첨/꽝을 확정한다(FR-4).
 * 경품 정착 시: 경품 소진 + 참가자 won + 원판 재배치(reshuffle, FR-5).
 * 꽝 정착 시: 기록만. missOnceMode 면 참가자 out.
 * 마지막에 종료 조건을 검사해 phase 를 갱신한다(EC-1~4).
 */
export function resolveSpin(
  state: AppState,
  slotIndex: number,
  timestamp: number,
  rng: Rng = defaultRng
): AppState {
  const slot = state.slots[slotIndex];
  const participant = currentParticipant(state);
  // 방어적: 잘못된 인덱스/참가자 없음이면 잠금만 해제하고 종료.
  if (!slot || !participant) {
    return { ...state, isSpinning: false };
  }

  const isWin = slot.kind === "prize" && slot.prizeId != null;
  const prize = isWin ? state.prizes.find((p) => p.id === slot.prizeId) ?? null : null;

  const result: DrawResult = {
    round: roundNumber(state),
    participantId: participant.id,
    participantLabel: participant.label,
    prizeId: prize?.id ?? null,
    prizeName: prize?.name ?? null,
    timestamp,
  };

  let prizes = state.prizes;
  let participants = state.participants;

  if (isWin && prize) {
    // 경품 소진 + 참가자 풀에서 제외(중복 수령 금지, FR-4.1/4.3).
    prizes = prizes.map((p) => (p.id === prize.id ? { ...p, consumed: true } : p));
    participants = participants.map((p) =>
      p.id === participant.id ? { ...p, status: "won" } : p
    );
  } else if (state.missOnceMode) {
    // 꽝도 1회만 모드: 즉시 탈락(FR-4.2 옵션).
    participants = participants.map((p) =>
      p.id === participant.id ? { ...p, status: "out" } : p
    );
  }
  // 일반 꽝(기본 정책): 참가자는 풀에 잔류 — 변경 없음.

  // 당첨으로 경품이 빠졌으면 남은 경품으로 원판을 재배치(셔플). 꽝이면 원판 유지.
  const slots = isWin ? buildSlots(prizes, rng) : state.slots;

  const next: AppState = {
    ...state,
    prizes,
    participants,
    slots,
    results: [...state.results, result],
    isSpinning: false,
    currentParticipantId: null,
  };

  return applyEndConditions(next);
}

/**
 * 종료 조건 — 경품 소진(EC-3) 또는 참가자 소진(EC-4)이면 finished.
 * 그 외에는 drawing 유지.
 */
export function applyEndConditions(state: AppState): AppState {
  const noPrizesLeft = remainingPrizes(state.prizes).length === 0;
  const noEligibleLeft = eligibleParticipants(state).length === 0;
  if (noPrizesLeft || noEligibleLeft) {
    return { ...state, phase: "finished", currentParticipantId: null };
  }
  return state;
}

/** 전체 초기화 — 입력 단계로 되돌림(FR-6.3). */
export function reset(): AppState {
  return createInitialState();
}
