/*
  핵심 추첨 로직 — 부수효과 없는 순수 함수.
  명세 무결성/공정성 요구를 코드로 못박는 계층:
    · NFR-2 공정성: 모든 섹터 등확률(1/slots.length). 가중치 없음.
    · FR-3.2/3.3: 결과(슬롯 인덱스)를 '먼저' 무작위로 정한다. 회전 각도는 wheel.ts가 역산.
    · FR-5: 경품 소진 후 남은 경품 + 꽝 1칸으로 재배치, 순서 무작위 셔플.
*/

import type { Prize, WheelSlot } from "./types.js";

/** 0 이상 1 미만 난수 공급자. 테스트에서 시드 rng를 주입해 결정적으로 만들 수 있다. */
export type Rng = () => number;

const defaultRng: Rng = Math.random;

/** [0, n) 정수 균등 추출. */
export function randomInt(n: number, rng: Rng = defaultRng): number {
  return Math.floor(rng() * n);
}

/** Fisher-Yates 셔플 — 새 배열을 반환(입력 불변). 편향 없는 균등 셔플. */
export function shuffle<T>(input: readonly T[], rng: Rng = defaultRng): T[] {
  const arr = input.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1, rng);
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

/** 아직 소진되지 않은(원판에 남아 있는) 경품. */
export function remainingPrizes(prizes: readonly Prize[]): Prize[] {
  return prizes.filter((p) => !p.consumed);
}

/**
 * 원판 슬롯 구성 — FR-3.1, FR-5.
 * 남은 경품 각각을 prize 슬롯으로 만들고, 꽝 슬롯 1칸을 더해 순서를 셔플한다.
 * 불변식: 반환 길이 === 남은 경품 수 + 1.
 */
export function buildSlots(prizes: readonly Prize[], rng: Rng = defaultRng): WheelSlot[] {
  const slots: WheelSlot[] = remainingPrizes(prizes).map((p) => ({
    kind: "prize",
    prizeId: p.id,
  }));
  slots.push({ kind: "miss", prizeId: null }); // 꽝은 항상 정확히 1칸 (FR-5.3)
  return shuffle(slots, rng);
}

/**
 * 회전 결과 슬롯 인덱스를 '먼저' 결정한다 — FR-3.3, NFR-1.
 * 모든 슬롯이 등확률이므로 단순 균등 추출. 애니메이션은 이 인덱스를 따라가도록 역산된다.
 */
export function pickResultSlot(slotCount: number, rng: Rng = defaultRng): number {
  return randomInt(slotCount, rng);
}

/** 현재 원판이 '꽝만 남은' 상태인지 — 경품 소진 종료 판정(EC-3)에 사용. */
export function isWheelExhausted(slots: readonly WheelSlot[]): boolean {
  return slots.every((s) => s.kind === "miss");
}
