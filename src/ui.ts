/*
  뷰 계층 — 상태와 핸들러 콜백을 받아 #app 에 그리고 이벤트를 배선한다.
  상태 변형은 하지 않는다(그건 state.ts/main.ts 의 일). 여기서는 '그리기'만.

  렌더 전략:
    · 화면 전환/라운드 종료 시에만 전체 재렌더(render).
    · 설정 입력은 포커스 보존을 위해 카운트/경고/버튼만 부분 갱신(refreshSetupStatus).
    · 회전 중에는 전체 재렌더를 하지 않는다(로터 누적 회전각 보존) — main.ts 가 흐름 제어.
*/

import type { AppState, DrawResult, Participant } from "./types.js";
import type { SectorView } from "./wheel.js";
import { renderWheelSVG } from "./wheel.js";
import { remainingPrizes } from "./draw.js";
import {
  canStart,
  currentParticipant,
  duplicateLabels,
  eligibleParticipants,
  remainingPrizeCount,
} from "./state.js";

/** 원판 슬롯이 이보다 많으면 라벨을 번호로 바꾸고 범례를 제공한다(EC-8). */
const NUMBER_MODE_THRESHOLD = 24;

export interface Handlers {
  onParticipantsChange(text: string, mode: "names" | "count"): void;
  onPrizesChange(text: string): void;
  onToggleMissOnce(on: boolean): void;
  onSelectionMode(mode: "auto" | "manual"): void;
  onStart(): void;
  onSpin(): void;
  onSelectParticipant(id: string): void;
  onRequestReset(): void;
  onConfirmReset(): void;
  onCancelReset(): void;
  onExportCsv(): void;
}

/* ── 작은 유틸 ───────────────────────────────────────── */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function $(root: HTMLElement, sel: string): HTMLElement | null {
  return root.querySelector(sel);
}

/* ── 슬롯 → 표시용 섹터 변환 ─────────────────────────────
   번호 모드면 경품 슬롯에 범례 번호를, 아니면 경품명을 라벨로 쓴다. */
function buildSectorViews(state: AppState, numberMode: boolean): SectorView[] {
  const legendNo = new Map<string, number>();
  if (numberMode) {
    remainingPrizes(state.prizes).forEach((p, i) => legendNo.set(p.id, i + 1));
  }
  return state.slots.map((slot) => {
    if (slot.kind === "miss") return { kind: "miss", label: "꽝" };
    const prize = state.prizes.find((p) => p.id === slot.prizeId);
    const label = numberMode
      ? String(legendNo.get(slot.prizeId ?? "") ?? "?")
      : prize?.name ?? "?";
    return { kind: "prize", label };
  });
}

/* ── 화면별 마크업 ───────────────────────────────────── */

function setupHtml(state: AppState): string {
  const dups = duplicateLabels(state.participants);
  const warn =
    dups.length > 0
      ? `<p class="warn" id="p-warn">중복 이름: ${escapeHtml(dups.join(", "))} (식별은 내부적으로 구분됩니다)</p>`
      : `<p class="warn" id="p-warn" hidden></p>`;

  return `
    <h1>럭키드로우 추첨 원판</h1>
    <p class="subtitle">참가자와 경품을 입력하고 원판을 돌려 당첨자를 정합니다.</p>

    <div class="setup-grid">
      <section class="field">
        <label for="participants">참가자</label>
        <p class="field-help">이름을 줄바꿈 또는 쉼표로 구분해 입력하세요.</p>
        <textarea id="participants" placeholder="홍길동&#10;김철수&#10;이영희"></textarea>
        <div class="field-count">참가자 <strong id="p-count">0</strong>명</div>
        ${warn}
        <p class="field-help" style="margin-top:12px">또는 인원 수로 자동 생성(1~N 번호)</p>
        <input type="number" id="participant-count" min="1" placeholder="예: 30" />
      </section>

      <section class="field">
        <label for="prizes">경품</label>
        <p class="field-help">한 줄에 하나씩. 같은 경품 여러 개는 같은 이름을 여러 줄로.</p>
        <textarea id="prizes" placeholder="에어팟&#10;스타벅스 기프티콘&#10;커피 쿠폰"></textarea>
        <div class="field-count">경품 <strong id="z-count">0</strong>개</div>
      </section>
    </div>

    <div class="options">
      <label><input type="checkbox" id="miss-once" /> 꽝도 1회만 (꽝이면 즉시 제외)</label>
      <label><input type="checkbox" id="manual-select" /> 참가자 수동 선택</label>
    </div>

    <div class="setup-actions">
      <button class="primary lg" id="start-btn" ${canStart(state) ? "" : "disabled"}>추첨 시작</button>
    </div>`;
}

function drawingHtml(state: AppState): string {
  const numberMode = state.slots.length > NUMBER_MODE_THRESHOLD;
  const sectors = buildSectorViews(state, numberMode);
  const cur = currentParticipant(state);
  const last = state.results[state.results.length - 1] ?? null;

  return `
    <div class="draw-header">
      <span class="round">라운드 <span class="mono">${state.results.length + 1}</span></span>
      <span class="current">${currentLabel(state, cur)}</span>
    </div>

    <div class="draw-grid">
      <div class="stage">
        ${renderWheelSVG(sectors)}
        ${resultBannerHtml(state, last)}
        <div class="draw-controls">
          ${selectionControlHtml(state)}
          <button class="primary lg" id="spin-btn" ${canSpin(state) ? "" : "disabled"}>돌리기</button>
          <button id="reset-btn">초기화</button>
        </div>
        ${numberMode ? legendHtml(state) : ""}
      </div>

      <aside class="side">
        ${statusbarHtml(state)}
        ${winnersHtml(state)}
      </aside>
    </div>`;
}

function currentLabel(state: AppState, cur: Participant | null): string {
  if (state.isSpinning) return `<span class="name">${cur ? escapeHtml(cur.label) : ""}</span> 회전 중…`;
  if (cur) return `현재 참가자 <span class="name">${escapeHtml(cur.label)}</span>`;
  if (state.selectionMode === "manual") return `참가자를 선택하세요`;
  return `대기 중`;
}

function selectionControlHtml(state: AppState): string {
  if (state.selectionMode !== "manual") return "";
  const pool = eligibleParticipants(state);
  const options = pool
    .map(
      (p) =>
        `<option value="${escapeHtml(p.id)}" ${p.id === state.currentParticipantId ? "selected" : ""}>${escapeHtml(p.label)}</option>`
    )
    .join("");
  return `
    <select id="participant-select" ${state.isSpinning ? "disabled" : ""}>
      <option value="">참가자 선택…</option>
      ${options}
    </select>`;
}

function resultBannerHtml(state: AppState, last: DrawResult | null): string {
  if (state.isSpinning) {
    return `<div class="result-banner"><span class="tag">진행</span> 결과를 기다리는 중…</div>`;
  }
  if (!last) {
    return `<div class="result-banner">돌리기 버튼을 눌러 추첨을 시작하세요.</div>`;
  }
  if (last.prizeName) {
    return `<div class="result-banner win"><span class="tag">당첨</span> ${escapeHtml(last.participantLabel)} — ${escapeHtml(last.prizeName)}</div>`;
  }
  return `<div class="result-banner miss"><span class="tag">꽝</span> ${escapeHtml(last.participantLabel)} — 경품 없음</div>`;
}

function statusbarHtml(state: AppState): string {
  return `
    <div class="statusbar">
      <div class="stat"><div class="value">${eligibleParticipants(state).length}</div><div class="label">남은 참가자</div></div>
      <div class="stat"><div class="value">${remainingPrizeCount(state)}</div><div class="label">남은 경품</div></div>
      <div class="stat"><div class="value">${state.results.length}</div><div class="label">진행 라운드</div></div>
    </div>`;
}

function winnersHtml(state: AppState): string {
  const rows = [...state.results].reverse();
  const body =
    rows.length === 0
      ? `<div class="empty">아직 당첨 기록이 없습니다.</div>`
      : `<ul>${rows
          .map((r) => {
            const isMiss = r.prizeName == null;
            return `<li class="${isMiss ? "is-miss" : ""}">
              <span class="mono">#${r.round}</span>
              <span class="who">${escapeHtml(r.participantLabel)}</span>
              <span class="prize">${isMiss ? "꽝" : escapeHtml(r.prizeName!)}</span>
              <time>${formatTime(r.timestamp)}</time>
            </li>`;
          })
          .join("")}</ul>`;
  return `<section class="winners"><h2>당첨자 명단</h2>${body}</section>`;
}

function legendHtml(state: AppState): string {
  const items = remainingPrizes(state.prizes)
    .map((p) => `<li>${escapeHtml(p.name)}</li>`)
    .join("");
  return `<section class="legend"><h2>원판 번호 범례</h2><ol>${items}</ol></section>`;
}

function finishedHtml(state: AppState): string {
  const leftoverPrizes = remainingPrizes(state.prizes);
  const nonWinners = state.participants.filter((p) => p.status !== "won");

  return `
    <div class="finished-head">
      <div>
        <h1>추첨 종료</h1>
        <p class="subtitle">총 <span class="mono">${state.results.filter((r) => r.prizeName).length}</span>건 당첨 · ${state.results.length} 라운드 진행</p>
      </div>
      <div class="finished-actions">
        <button id="export-btn" ${state.results.length === 0 ? "disabled" : ""}>CSV 내보내기</button>
        <button class="primary" id="reset-btn">새 추첨</button>
      </div>
    </div>

    ${winnersHtml(state)}

    ${
      nonWinners.length > 0
        ? `<section class="legend"><h2>미당첨 참가자 (${nonWinners.length})</h2><ol>${nonWinners
            .map((p) => `<li>${escapeHtml(p.label)}</li>`)
            .join("")}</ol></section>`
        : ""
    }
    ${
      leftoverPrizes.length > 0
        ? `<section class="legend"><h2>잔여 경품 (${leftoverPrizes.length})</h2><ol>${leftoverPrizes
            .map((p) => `<li>${escapeHtml(p.name)}</li>`)
            .join("")}</ol></section>`
        : ""
    }`;
}

function resetModalHtml(): string {
  return `
    <div class="modal-backdrop" id="reset-modal">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="reset-title">
        <h2 id="reset-title">전체 초기화</h2>
        <p>모든 참가자·경품·당첨 기록이 삭제되고 입력 단계로 돌아갑니다. 계속할까요?</p>
        <div class="modal-actions">
          <button id="reset-cancel">취소</button>
          <button class="primary" id="reset-confirm">초기화</button>
        </div>
      </div>
    </div>`;
}

/* ── 시작 가능/회전 가능 판정 ──────────────────────────── */

function canSpin(state: AppState): boolean {
  return (
    state.phase === "drawing" &&
    !state.isSpinning &&
    state.currentParticipantId != null &&
    remainingPrizeCount(state) > 0
  );
}

/* ── 공개 API: 렌더 + 배선 ─────────────────────────────── */

/** 모달 표시 여부는 main 이 별도 플래그로 관리하지 않고, render 인자로 전달한다. */
export function render(
  root: HTMLElement,
  state: AppState,
  handlers: Handlers,
  showResetModal = false
): void {
  let html: string;
  if (state.phase === "setup") html = setupHtml(state);
  else if (state.phase === "drawing") html = drawingHtml(state);
  else html = finishedHtml(state);

  root.innerHTML = html + (showResetModal ? resetModalHtml() : "");

  if (state.phase === "setup") wireSetup(root, handlers);
  else if (state.phase === "drawing") wireDrawing(root, handlers);
  else wireFinished(root, handlers);

  if (showResetModal) wireResetModal(root, handlers);
}

function wireSetup(root: HTMLElement, h: Handlers): void {
  const names = $(root, "#participants") as HTMLTextAreaElement | null;
  const count = $(root, "#participant-count") as HTMLInputElement | null;
  const prizes = $(root, "#prizes") as HTMLTextAreaElement | null;
  const missOnce = $(root, "#miss-once") as HTMLInputElement | null;
  const manual = $(root, "#manual-select") as HTMLInputElement | null;
  const start = $(root, "#start-btn") as HTMLButtonElement | null;

  // 이름 입력 시 숫자 입력은 비우고, 그 반대도 마찬가지(두 방식 상호 배타).
  names?.addEventListener("input", () => {
    if (count) count.value = "";
    h.onParticipantsChange(names.value, "names");
  });
  count?.addEventListener("input", () => {
    if (names) names.value = "";
    h.onParticipantsChange(count.value, "count");
  });
  prizes?.addEventListener("input", () => h.onPrizesChange(prizes.value));
  missOnce?.addEventListener("change", () => h.onToggleMissOnce(missOnce.checked));
  manual?.addEventListener("change", () =>
    h.onSelectionMode(manual.checked ? "manual" : "auto")
  );
  start?.addEventListener("click", () => h.onStart());
}

function wireDrawing(root: HTMLElement, h: Handlers): void {
  ($(root, "#spin-btn") as HTMLButtonElement | null)?.addEventListener("click", () => h.onSpin());
  ($(root, "#reset-btn") as HTMLButtonElement | null)?.addEventListener("click", () => h.onRequestReset());
  const sel = $(root, "#participant-select") as HTMLSelectElement | null;
  sel?.addEventListener("change", () => h.onSelectParticipant(sel.value));
}

function wireFinished(root: HTMLElement, h: Handlers): void {
  ($(root, "#export-btn") as HTMLButtonElement | null)?.addEventListener("click", () => h.onExportCsv());
  ($(root, "#reset-btn") as HTMLButtonElement | null)?.addEventListener("click", () => h.onConfirmReset());
}

function wireResetModal(root: HTMLElement, h: Handlers): void {
  ($(root, "#reset-cancel") as HTMLButtonElement | null)?.addEventListener("click", () => h.onCancelReset());
  ($(root, "#reset-confirm") as HTMLButtonElement | null)?.addEventListener("click", () => h.onConfirmReset());
}

/** 설정 화면 부분 갱신 — 포커스를 잃지 않도록 카운트/경고/시작버튼만 바꾼다. */
export function refreshSetupStatus(root: HTMLElement, state: AppState): void {
  const pCount = $(root, "#p-count");
  if (pCount) pCount.textContent = String(state.participants.length);
  const zCount = $(root, "#z-count");
  if (zCount) zCount.textContent = String(state.prizes.length);

  const warn = $(root, "#p-warn");
  if (warn) {
    const dups = duplicateLabels(state.participants);
    if (dups.length > 0) {
      warn.textContent = `중복 이름: ${dups.join(", ")} (식별은 내부적으로 구분됩니다)`;
      warn.hidden = false;
    } else {
      warn.hidden = true;
    }
  }

  const start = $(root, "#start-btn") as HTMLButtonElement | null;
  if (start) start.disabled = !canStart(state);
}

/** 회전 직전, 전체 재렌더 없이 잠금 상태만 반영(버튼 비활성 + 배너 갱신). */
export function lockForSpin(root: HTMLElement, state: AppState): void {
  const spin = $(root, "#spin-btn") as HTMLButtonElement | null;
  if (spin) spin.disabled = true;
  const reset = $(root, "#reset-btn") as HTMLButtonElement | null;
  if (reset) reset.disabled = true;
  const sel = $(root, "#participant-select") as HTMLSelectElement | null;
  if (sel) sel.disabled = true;
  const banner = $(root, ".result-banner");
  if (banner) {
    banner.className = "result-banner";
    banner.innerHTML = `<span class="tag">진행</span> 결과를 기다리는 중…`;
  }
  const cur = currentParticipant(state);
  const header = $(root, ".draw-header .current");
  if (header) header.innerHTML = `<span class="name">${cur ? escapeHtml(cur.label) : ""}</span> 회전 중…`;
}
