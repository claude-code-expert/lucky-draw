/*
  데이터 모델 — 명세 5장의 TypeScript 인터페이스를 그대로 따른다.
  핵심 불변식(반드시 유지):
    · slots.length === (소진되지 않은 경품 수) + 1   // 경품 섹터들 + 꽝 1칸
    · P(특정 슬롯) === 1 / slots.length              // 모든 섹터 등확률
*/

export type ParticipantId = string;
export type PrizeId = string;

/** 참가자 상태. won/out 은 다음 라운드 대상에서 제외된다. */
export type ParticipantStatus = "eligible" | "won" | "out";

export interface Participant {
  id: ParticipantId;
  label: string; // 표시값(이름 또는 번호)
  status: ParticipantStatus;
}

export interface Prize {
  id: PrizeId;
  name: string;
  consumed: boolean; // 소진(당첨) 여부
}

/** 원판의 한 칸. kind === "miss" 이면 prizeId 는 null. */
export interface WheelSlot {
  kind: "prize" | "miss";
  prizeId: PrizeId | null;
}

export interface DrawResult {
  round: number;
  participantId: ParticipantId;
  participantLabel: string;
  prizeId: PrizeId | null; // null = 꽝
  prizeName: string | null;
  timestamp: number;
}

/** 화면 흐름과 1:1 대응: setup → drawing → finished */
export type Phase = "setup" | "drawing" | "finished";

export interface AppState {
  phase: Phase;
  participants: Participant[];
  prizes: Prize[];
  slots: WheelSlot[]; // 남은 경품 + 꽝 1
  results: DrawResult[];
  currentParticipantId: ParticipantId | null;
  isSpinning: boolean;
  missOnceMode: boolean; // 꽝도 1회만 모드 (FR-4.2 옵션)
  /** 다음 참가자 선택 방식 (FR-6.1). manual 이면 사용자가 명단에서 고른다. */
  selectionMode: "auto" | "manual";
}
