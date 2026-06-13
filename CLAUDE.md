# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 무엇을 만드는가

참가자 명단과 경품 목록을 받아 원판을 돌려 경품을 배정하는 단일 페이지 추첨 앱. 행사장 대형 화면 투사를 가정한다. 무서버 정적 SPA이며 외부 API/네트워크 의존이 없어야 한다(NFR-5).

## 스택 / 빌드 / 실행

**순수 HTML + TypeScript + SVG, 번들러 없음.** `tsc`가 `src/*.ts`를 `dist/*.js`로 컴파일하고, 브라우저가 이를 네이티브 ES 모듈로 직접 로드한다. 따라서 **소스의 import 경로는 반드시 `.js` 확장자를 명시**한다(예: `import { x } from "./draw.js"`). `tsconfig`의 `moduleResolution: "bundler"`가 `.js` 지정자를 `.ts`로 해석하고, 출력 JS에는 경로를 그대로 보존한다. import 경로를 확장자 없이 쓰면 브라우저에서 모듈 로드가 깨진다.

```bash
npm install            # typescript 설치
npm run build          # tsc → dist/ 생성
npm run watch          # tsc --watch (개발 중 자동 컴파일)
npm run serve          # python3 -m http.server 5173 (정적 서빙)
# 개발: 터미널1 `npm run watch` + 터미널2 `npm run serve` → http://localhost:5173
```

배포물 = `index.html` + `styles.css` + `dist/`. 빌드 후 정적 호스팅에 그대로 올리면 된다.

**순수 로직 테스트**: `draw.ts`/`state.ts`는 DOM 의존이 없으므로 컴파일 후 Node에서 `dist/state.js`를 직접 import해 검증할 수 있다(seeded rng 주입으로 결정적 테스트). 정식 테스트 러너는 아직 없다.

## 아키텍처 — 단방향 흐름과 계층 분리

상태는 `main.ts`가 단독 소유하고, 도메인 로직은 부수효과 없는 순수 함수로, 뷰는 그리기만 한다. 흐름은 `(state, action) → 새 state → 재렌더` 단방향이다.

- [src/types.ts](src/types.ts) — 명세 5장 데이터 모델(`AppState` 등). DOM/로직 의존 없음.
- [src/draw.ts](src/draw.ts) — **순수 도메인**: 셔플(Fisher-Yates), `buildSlots`(남은 경품 + 꽝 1, 셔플), `pickResultSlot`(결과 선차 결정). 난수는 `Rng` 인자로 주입 가능(테스트 결정성).
- [src/state.ts](src/state.ts) — **상태 기계**: 입력 파싱, 전이(`startDraw`/`resolveSpin`/`assignNextParticipant` 등), 파생 선택자, 종료 조건(`applyEndConditions`). `draw.ts`에만 의존(DOM 없음).
- [src/wheel.ts](src/wheel.ts) — SVG 원판 마크업 + 회전 애니메이션. 각도는 12시 기준 시계방향. `spinTo`가 결과 슬롯에서 회전각을 역산(FR-3.3).
- [src/ui.ts](src/ui.ts) — 뷰. 상태+핸들러를 받아 `#app`에 그리고 이벤트 배선. 상태 변형 안 함.
- [src/main.ts](src/main.ts) — 컨트롤러. 상태 소유, 회전 비동기 흐름 조율, 영속성/CSV.
- [src/storage.ts](src/storage.ts) — localStorage 보존(NFR-3).

### 회전 흐름에서 절대 깨면 안 되는 두 규칙

1. **결과를 먼저 정하고 각도를 역산한다.** `main.ts`의 `runSpin()`은 `pickResultSlot()`으로 결과 슬롯을 먼저 뽑고, `wheel.spinTo()`가 그 슬롯이 포인터에 멈추도록 회전을 역산한다. 애니메이션이 결과를 정하면 안 된다(NFR-1).
2. **회전 중에는 전체 재렌더(`render`)를 호출하지 않는다.** `innerHTML` 재작성은 로터 `<g>`를 재생성해 누적 회전각(`dataset.rotation`)을 잃는다. 회전 중에는 `lockForSpin()`으로 버튼/배너만 부분 갱신하고, 애니메이션 종료 후에만 `resolveSpin` + `render`한다. 설정 화면 입력도 같은 이유로 `refreshSetupStatus()`로 부분 갱신(포커스 보존)한다.

### 핵심 불변식 (코드로 강제됨)

- `slots.length === remainingPrizes + 1`, 꽝은 항상 정확히 1칸 → `draw.ts`의 `buildSlots`.
- 모든 섹터 등확률 `1/slots.length`, 가중치 없음 → 균등 추출 `pickResultSlot`.
- 당첨 시: 경품 소진 + 참가자 `won` + 원판 재배치(셔플); 꽝 시: 기본 잔류, `missOnceMode`면 `out` → `resolveSpin`.
- 종료: 남은 경품 0(EC-3) 또는 eligible 0(EC-4) → `applyEndConditions`.

## 비자명한 핵심 로직 (구현 전 반드시 숙지)

여러 요구사항에 흩어져 있어 한 번에 보이지 않는 규칙들이다.

- **슬롯 구성과 확률**: 원판 슬롯 = `소진되지 않은 경품 수 + 꽝 1칸`. 모든 섹터는 균등 각도이므로 각 슬롯 확률 = `1 / slots.length`. 경품이 줄수록 꽝 확률이 자연히 오른다(경품 1개 남으면 꽝 1/2). 가중치는 절대 두지 않는다(NFR-2).
- **결과 우선, 애니메이션 역산**: 무작위 결과를 **먼저 결정**한 뒤 그 섹터에 멈추도록 회전 각도를 역산한다(FR-3.3, NFR-1). 애니메이션이 결과를 정하면 안 된다 — 연출과 결과는 독립적이고 조작 불가해야 한다.
- **재배치(Reshuffle)**: 경품 당첨으로 소진되면 남은 경품으로 슬롯을 재생성하고 **순서를 무작위 셔플**한다(위치 예측 방지). 꽝 슬롯은 셔플 후에도 정확히 1칸 유지(FR-5.x).
- **참가자 풀 규칙**: 당첨자는 풀에서 제외되어 재당첨 불가(`status: won`). 꽝은 기본적으로 풀에 잔류하되, "꽝도 1회만" 모드(`missOnceMode`)면 즉시 탈락(`status: out`).
- **종료 조건**: 경품 소진 또는 참가자 소진. 원판에 꽝만 남으면 회전을 막고 "추첨 종료" 상태로 전환한다(EC-3, EC-4).
- **회전 중 잠금**: 회전 중에는 입력 변경·재시작을 잠가 중복 클릭을 막는다(FR-3.4).

데이터 모델의 정식 형태는 [Requirement.md](Requirement.md) 5장의 TypeScript 인터페이스(`AppState`, `Participant`, `Prize`, `WheelSlot`, `DrawResult`)를 따른다. 핵심 불변식: `slots.length === (소진 안 된 경품 수) + 1`.

상태 phase는 `setup → drawing → finished` 흐름이며 화면도 이에 1:1 대응한다(6장).

## 강제 디자인 제약 — Anti-AI-Slop (MUST)

[Requirement.md](Requirement.md) 8장은 모든 화면/컴포넌트에 **MUST**로 적용된다. 이 프로젝트에서 가장 어기기 쉬운 규칙이므로 UI 코드 작성·리뷰 시 반드시 점검한다.

- **금지**: 모든 그라데이션(배경·텍스트), 색 box-shadow·글로우·glassmorphism(`backdrop-filter: blur`), 장식 모션(hover `transform`, load fade/stagger, pulse/shimmer/float/glow), 배경 워터마크·닷/그리드, 카드 상단 컬러 액센트 바, 이모지 장식, 마케팅 단어(Seamlessly/Elevate/Unlock 등).
- **허용 예외**: **원판 회전 애니메이션**은 결과 전달 수단이므로 장식 모션 금지의 예외다. 그 외 `transition`은 색·투명도 등 기능적 상태 변화에만, 150ms 이하.
- **강제**: 무채색 베이스 + **액센트 1색**(의미/위계에만 사용, 예: 당첨=액센트, 꽝=중성 회색). `border-radius` 0~8px. 구획은 `1px solid border` + 여백으로. 위계는 크기·굵기·여백·정렬로만.
- **폰트(목적형 강제)**: 본문/UI = **IBM Plex Sans KR**, 번호/카운트/시각 = **IBM Plex Mono**(tabular). system 기본값/Inter/Roboto/Arial로 수렴 금지.
- 출력 전 8.3장 자가 점검 체크리스트를 통과시킨다.
