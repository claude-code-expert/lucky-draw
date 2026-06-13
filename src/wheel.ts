/*
  원판(SVG) 렌더링 + 회전 애니메이션.
  명세 8.1의 '장식 모션 금지'에서 회전은 예외(결과 전달 수단)지만, 그 외 장식은 넣지 않는다.

  각도 규약: 모든 각도는 12시(포인터 위치)에서 '시계방향'으로 잰다.
    · 슬롯 i 는 [i·seg, (i+1)·seg) 를 차지하고, 중심각은 (i+0.5)·seg.
    · 로터를 R 만큼 시계방향으로 돌리면, 원래 각도 a 의 점은 a+R 로 이동한다.
    · 슬롯 i 를 포인터(0°)에 맞추려면 R ≡ -(i+0.5)·seg (mod 360).
  → 결과 슬롯을 '먼저' 정하고 R 을 역산한다(FR-3.3).
*/

const VIEW = 100;
const CENTER = VIEW / 2;
const RADIUS = 49; // 0.5 여백
const LABEL_RADIUS = 32;
const SPIN_DURATION_MS = 4200;
const SPIN_DURATION_REDUCED_MS = 320;
const FULL_SPINS = 5;

export interface SectorView {
  kind: "prize" | "miss";
  /** 섹터에 표시할 문자열(경품명 또는 번호, 또는 "꽝"). ui.ts 가 해석해 넘긴다. */
  label: string;
}

/** 12시 기준 시계방향 각도(deg)를 SVG 좌표점으로 변환. */
function pointOnCircle(deg: number, r: number): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180;
  return {
    x: CENTER + r * Math.sin(rad),
    y: CENTER - r * Math.cos(rad),
  };
}

/** a0→a1(시계방향) 부채꼴 path. */
function sectorPath(a0: number, a1: number): string {
  const p0 = pointOnCircle(a0, RADIUS);
  const p1 = pointOnCircle(a1, RADIUS);
  const largeArc = a1 - a0 > 180 ? 1 : 0;
  return [
    `M ${CENTER} ${CENTER}`,
    `L ${p0.x.toFixed(3)} ${p0.y.toFixed(3)}`,
    `A ${RADIUS} ${RADIUS} 0 ${largeArc} 1 ${p1.x.toFixed(3)} ${p1.y.toFixed(3)}`,
    "Z",
  ].join(" ");
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 라벨이 너무 길면 가독성을 위해 자른다(EC-8 보조). */
function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/**
 * 원판 전체 마크업을 문자열로 반환.
 * .wheel-rotor <g> 안에 섹터+라벨이 들어가고, 포인터는 회전하지 않도록 바깥에 둔다.
 */
export function renderWheelSVG(sectors: SectorView[]): string {
  const n = sectors.length;
  const seg = 360 / n;
  const maxLabel = n > 16 ? 6 : 12;

  const parts = sectors.map((s, i) => {
    const a0 = i * seg;
    const a1 = (i + 1) * seg;
    // 인접 섹터 구분: 경품은 두 무채색을 번갈아, 꽝은 중간 회색.
    const fill =
      s.kind === "miss"
        ? "var(--surface-2)"
        : i % 2 === 0
          ? "var(--bg)"
          : "var(--surface)";
    const center = (i + 0.5) * seg;
    const lp = pointOnCircle(center, LABEL_RADIUS);
    const labelClass = s.kind === "miss" ? "sector-label is-miss" : "sector-label";
    return `
      <path d="${sectorPath(a0, a1)}" fill="${fill}" stroke="var(--border-strong)" stroke-width="0.3" />
      <text class="${labelClass}" x="${lp.x.toFixed(2)}" y="${lp.y.toFixed(2)}"
            text-anchor="middle" dominant-baseline="central"
            font-weight="${s.kind === "miss" ? 700 : 500}">${escapeXml(truncate(s.label, maxLabel))}</text>`;
  });

  return `
    <div class="wheel-wrap">
      <div class="wheel-pointer" aria-hidden="true"></div>
      <svg class="wheel" viewBox="0 0 ${VIEW} ${VIEW}" role="img" aria-label="추첨 원판">
        <g class="wheel-rotor" data-rotation="0">
          ${parts.join("")}
          <circle cx="${CENTER}" cy="${CENTER}" r="${RADIUS}" fill="none"
                  stroke="var(--border-strong)" stroke-width="0.6" />
        </g>
        <circle cx="${CENTER}" cy="${CENTER}" r="3" fill="var(--text)" />
      </svg>
    </div>`;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * 결과 슬롯 인덱스로 회전을 역산해 애니메이션한다.
 * 결과는 호출 전 이미 결정돼 있고(FR-3.3), 이 함수는 '그 섹터에 멈추도록' 각도만 맞춘다.
 * transitionend 시 resolve. 누적 회전값(dataset.rotation)으로 항상 앞으로만 돌린다.
 */
export function spinTo(
  rotor: SVGGElement,
  slotIndex: number,
  slotCount: number,
  rng: () => number = Math.random
): Promise<void> {
  const seg = 360 / slotCount;
  // 섹터 중앙에서 살짝 벗어나 멈추도록 지터를 더하되, 슬롯 경계는 넘지 않는다.
  const jitter = (rng() - 0.5) * seg * 0.6;
  const targetCenter = (slotIndex + 0.5) * seg;

  const desiredMod = (((-(targetCenter + jitter)) % 360) + 360) % 360;
  const current = parseFloat(rotor.dataset.rotation || "0");
  const currentMod = ((current % 360) + 360) % 360;
  let delta = desiredMod - currentMod;
  if (delta < 0) delta += 360;

  const reduced = prefersReducedMotion();
  const spins = reduced ? 0 : FULL_SPINS;
  const duration = reduced ? SPIN_DURATION_REDUCED_MS : SPIN_DURATION_MS;
  const final = current + spins * 360 + delta;
  rotor.dataset.rotation = String(final);

  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      rotor.removeEventListener("transitionend", onEnd);
      resolve();
    };
    const onEnd = (e: TransitionEvent) => {
      if (e.propertyName === "transform") finish();
    };
    rotor.addEventListener("transitionend", onEnd);
    // 안전망: transitionend 미발화 환경 대비 타임아웃.
    window.setTimeout(finish, duration + 200);

    // transition 을 먼저 적용한 뒤 다음 프레임에 transform 을 바꿔 애니메이션을 보장.
    rotor.style.transition = `transform ${duration}ms cubic-bezier(0.16, 1, 0.3, 1)`;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        rotor.style.transform = `rotate(${final}deg)`;
      });
    });
  });
}
