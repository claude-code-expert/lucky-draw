/*
  컨트롤러 — 앱 상태를 소유하고, 뷰(ui.ts)와 도메인(state.ts/draw.ts/wheel.ts)을 잇는다.
  핵심은 회전의 비동기 흐름이다(FR-3.3, FR-3.4):
    1) 결과 슬롯을 '먼저' 무작위로 정한다(pickResultSlot).
    2) 입력/버튼을 잠근다(beginSpin + lockForSpin).
    3) 그 슬롯에 멈추도록 회전을 역산해 애니메이션(spinTo).
    4) 끝나면 결과를 확정하고(resolveSpin) 다음 참가자를 정한 뒤 전체 재렌더.
*/

import { pickResultSlot } from "./draw.js";
import {
  assignNextParticipant,
  beginSpin,
  createInitialState,
  reset,
  resolveSpin,
  selectParticipant,
  setMissOnceMode,
  setParticipantsFromCount,
  setParticipantsFromNames,
  setPrizes,
  setSelectionMode,
  startDraw,
} from "./state.js";
import { clearState, loadState, saveState } from "./storage.js";
import type { AppState } from "./types.js";
import type { Handlers } from "./ui.js";
import { lockForSpin, refreshSetupStatus, render } from "./ui.js";
import { spinTo } from "./wheel.js";

const root = document.getElementById("app");
if (!root) throw new Error("#app 마운트 지점을 찾을 수 없습니다.");
const app = root; // non-null 보장

let state: AppState = loadState() ?? createInitialState();
let showResetModal = false;

function renderAll(): void {
  render(app, state, handlers, showResetModal);
}

const handlers: Handlers = {
  // ── 설정 입력: 포커스 보존을 위해 전체 재렌더 없이 부분 갱신 ──
  onParticipantsChange(text, mode) {
    state =
      mode === "names"
        ? setParticipantsFromNames(state, text)
        : setParticipantsFromCount(state, Number(text));
    refreshSetupStatus(app, state);
  },
  onPrizesChange(text) {
    state = setPrizes(state, text);
    refreshSetupStatus(app, state);
  },
  onToggleMissOnce(on) {
    state = setMissOnceMode(state, on);
  },
  onSelectionMode(mode) {
    state = setSelectionMode(state, mode);
  },

  // ── 추첨 시작 ──
  onStart() {
    state = startDraw(state);
    saveState(state);
    renderAll();
  },

  // ── 회전(비동기 흐름) ──
  onSpin() {
    void runSpin();
  },

  onSelectParticipant(id) {
    state = id ? selectParticipant(state, id) : { ...state, currentParticipantId: null };
    renderAll();
  },

  // ── 초기화(확인 모달) ──
  onRequestReset() {
    showResetModal = true;
    renderAll();
  },
  onCancelReset() {
    showResetModal = false;
    renderAll();
  },
  onConfirmReset() {
    clearState();
    state = reset();
    showResetModal = false;
    renderAll();
  },

  onExportCsv() {
    exportCsv(state);
  },
};

/** 회전 1회의 전체 수명주기. */
async function runSpin(): Promise<void> {
  if (state.isSpinning || state.currentParticipantId == null) return;

  const slotCount = state.slots.length;
  // ① 결과를 먼저 결정한다(무결성: 연출과 독립).
  const resultIndex = pickResultSlot(slotCount);

  // ② 잠금. 전체 재렌더 없이 버튼·배너만 잠금 상태로(로터 보존).
  state = beginSpin(state);
  lockForSpin(app, state);

  const rotor = app.querySelector(".wheel-rotor") as SVGGElement | null;
  // ③ 그 슬롯에 멈추도록 역산 애니메이션.
  if (rotor) {
    await spinTo(rotor, resultIndex, slotCount);
  }

  // ④ 결과 확정 → 재배치/종료판정 → 다음 참가자 → 재렌더.
  state = resolveSpin(state, resultIndex, Date.now());
  if (state.phase === "drawing" && state.selectionMode === "auto") {
    state = assignNextParticipant(state);
  }
  saveState(state);
  renderAll();
}

/** 결과 목록을 CSV로 내보낸다(FR-7.3). */
function exportCsv(s: AppState): void {
  const header = ["round", "participant", "result", "time"];
  const escapeCell = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = [header.join(",")];
  for (const r of s.results) {
    lines.push(
      [
        String(r.round),
        escapeCell(r.participantLabel),
        escapeCell(r.prizeName ?? "꽝"),
        new Date(r.timestamp).toISOString(),
      ].join(",")
    );
  }
  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "lucky-draw-results.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

renderAll();
