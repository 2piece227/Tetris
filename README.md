# 블럭아웃 · 3D 테트리스로 보는 공간지각

Babylon.js + WebXR로 만든 블럭아웃 방식 3D 테트리스. 정육면체 우물(pit)에
조각이 떨어지고 세 방향으로 굴려가며 놓고, 한 층이 가득 차면 사라진다.

사이트 하나에 모드가 셋이다. 첫 화면(`index.html`)이 메뉴다.

| 페이지 | 모드 | 기기 |
|---|---|---|
| `vr.html` | **VR 체험** — 수조를 둘러보며 연습. 층고 18, 3분 + 층당 10초 | Quest (데스크톱에선 키보드로 미리보기) |
| `review.html` | **AI 리뷰** — VR에서 받은 4자리 코드로 복기 *(준비 중: 화면만 있음)* | 모니터 PC |
| `versus.html` | **AI와 대결** — 위에서 내려다보는 고정 시점, 1:1. 층고 12 | 모니터 PC |

헤드셋 브라우저에서는 메뉴에 VR만 보이고, 리뷰·대결 페이지는 열려도 메뉴로
돌려보낸다(`src/device.ts`). 데스크톱에서 헤드셋 메뉴를 확인하려면 `?device=quest`.

### 코드 구조

- `src/game/` — 모드 공용 게임 로직. 렌더링과 무관해서 화면 없이도 돈다.
  모드마다 다른 값(우물 크기·낙하 속도·시간·조각 단계)은
  [`src/game/rules.ts`](src/game/rules.ts)의 `VR_RULES` / `VERSUS_RULES`.
- `src/vr/` — VR 방·수조·씬 안 UI·컨트롤러 입력
- `src/versus/` — 탑다운 분할 화면·층 게이지·대전 진행 (구 1v1-Tetris 저장소에서 이식)
- `src/review/`, `src/menu/` — 평면 웹페이지

대전 상대와 VR 시연은 같은 자동 플레이어([`autoPlay.ts`](src/game/autoPlay.ts))가
두고, 어디에 둘지는 평가 엔진([`src/engine/placements.ts`](src/engine/placements.ts))이
정한다. 대전 난이도는 두는 속도와 "최선 대신 차선을 고르는 비율"이다.

### 회전

조각은 **자기 중심**을 축으로 돈다(예전엔 모서리 칸이 축이라 벽 옆에서 조각이
크게 휘둘러지며 막혔다). 회전한 모양이 걸리면 가까운 순서로 옆 2칸·아래 3칸까지
밀어서 맞는 자리를 찾고, 위로는 밀지 않는다. 그래도 안 되면 돌리려던 모양을
빨간 반투명으로 잠깐 보여주고 둔탁한 소리(VR은 오른손 진동까지)를 낸다.
쌓인 판 위에서 회전이 막히는 비율이 약 13%에서 2% 아래로 줄었다.

## 실행

```bash
npm install
npm run dev        # http://localhost:5173  (LAN에도 노출됨 → Quest 브라우저로 접속)
                   # 메뉴 /, VR /vr.html, 대전 /versus.html, 리뷰 /review.html
```

Quest 3에서 플레이하려면 같은 Wi-Fi에서 헤드셋 브라우저로 PC의 LAN 주소
(`http://<PC-IP>:5173`)를 열고 우하단 고글 버튼을 누른다.
※ WebXR은 **HTTPS**가 필요하다. 실제 배포는 아래 참고.

## 시연 모드

20초 동안 아무 입력이 없으면 기계가 스스로 두기 시작한다. 헤드셋 화면은 줄 선
사람들에게 미러링되는데, 그 화면이 끝난 판만 띄우고 있는 것보다는 낫다.
블럭이 반투명해지고 "시연 중" 안내가 떠서, 남의 판이 아니라 데모라는 게
한눈에 보인다.

시연은 **자기 판에서 따로 돈다.** 플레이어의 우물도 점수도 남은 시간도 건드리지
않으니, 다음 수를 고민하느라 20초 가만히 있어도 판이 날아가지 않는다. 아무
버튼이나 누르면 시연이 걷히고 원래 판이 그대로 돌아온다. 새로 시작하려면 Y.

두는 방식은 밸런스 측정에 썼던 것과 같은 기준이다 — 낮게 놓고, 빈 칸 위를
덮지 않는다. 잘 두는 게 목적이 아니라 **구경하는 사람 눈에 어설퍼 보이지 않는
것**이 목적이다. 조절은 [`src/game/autoPlay.ts`](src/game/autoPlay.ts)의
`DEMO_PACE`(수 놓는 속도)와 [`src/engine/placements.ts`](src/engine/placements.ts)의
점수 가중치.

## 배포 (GitHub Pages, HTTPS 자동)

```bash
npm run build      # dist/ 생성
# dist/ 내용을 gh-pages 브랜치나 Pages 설정 경로에 올림
```

## 조작 (VR)

| | 키보드(데스크톱) | VR(Quest 컨트롤러) |
|---|---|---|
| 이동 X/Z | ← → ↑ ↓ | 왼쪽 스틱 |
| 눕히기 (앞으로 넘김) | Q / W | 오른쪽 스틱 상하 |
| 돌리기 (제자리 회전) | A / S | 오른쪽 스틱 좌우 |
| 굴리기 (옆으로 넘어짐) | Z / X | A / B 버튼 |
| 하드 드롭 | Space | 오른쪽 트리거 |
| 소프트 드롭 | Shift(홀드) | 왼쪽 그립/트리거 |
| 위치 재조정 | — | 왼쪽 X 버튼 |
| 처음부터 다시 | Y | 왼쪽 Y 버튼 |

VR 조작법은 씬 안의 패널에도 떠 있다. **DOM으로 만든 UI는 헤드셋에서 보이지
않는다** — immersive 세션에 들어가면 브라우저가 WebXR 프레임버퍼만 그리고 HTML
페이지는 사라지기 때문이다. 그래서 점수·조작법·게임오버는 전부 Babylon GUI
평면([`src/vr/vrui.ts`](src/vr/vrui.ts))으로 씬 안에 들어가 있고,
vr.html에 남은 것은 데스크톱 전용 키보드 안내뿐이다.

대전 모드는 키보드: 이동 <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>, 회전
<kbd>Q</kbd><kbd>E</kbd><kbd>R</kbd> / 반대 <kbd>Z</kbd><kbd>C</kbd><kbd>V</kbd>, 떨구기 <kbd>Space</kbd>
([`src/versus/keyboard.ts`](src/versus/keyboard.ts)).

## 배치

우물은 받침대 위에 놓인 유리 수조다(44cm 폭, 윗면 테두리가 바닥에서 1.28m).
눈높이보다 낮아서 자연스럽게 내려다보게 되고, 유리벽 덕분에 옆에서도 쌓인
높이가 보인다. VR 세션을 시작하거나 왼쪽 X를 누르면 플레이어 앞
[`XR_DISTANCE`](src/vr/config.ts)만큼 떨어진 곳으로 수조가 다시 놓인다.

## 튜닝

- 우물 크기·낙하 속도·시간·조각 단계: [`src/game/rules.ts`](src/game/rules.ts) (모드별)
- 조각 세트와 단계 구성: [`src/game/pieces.ts`](src/game/pieces.ts)
- VR 배치(수조 높이·거리): [`src/vr/config.ts`](src/vr/config.ts)
- 방·수조·받침대: [`src/vr/environment.ts`](src/vr/environment.ts)
- 탑다운 카메라 높이·화각·층 색: [`src/versus/config.ts`](src/versus/config.ts)
- 효과음: [`src/audio/sfx.ts`](src/audio/sfx.ts). 배경음은 VR `bgm.mp3`, 대전 `bgm-versus.mp3`

> 대전 낙하 속도는 VR판 값을 그대로 쓰고 있어서 대전용으로는 느릴 수 있다.
