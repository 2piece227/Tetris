# VR 블럭아웃 · 3D 테트리스 (Meta Quest 3)

Babylon.js + WebXR로 만든 블럭아웃 방식 3D 테트리스. 정육면체 우물(pit)에
조각이 떨어지고 세 방향으로 굴려가며 놓고, 한 층이 가득 차면 사라진다.
회전은 축이 아니라 **보이는 결과** 기준이다 — 어느 쪽에 서 있든 "눕히기"는
항상 조각을 몸 바깥으로 넘긴다.
Quest 3 브라우저에서 URL만 열면 실행되므로 앱 설치·사이드로드가 필요 없다.

## 실행

```bash
npm install
npm run dev        # http://localhost:5173  (LAN에도 노출됨 → Quest 브라우저로 접속)
```

Quest 3에서 플레이하려면 같은 Wi-Fi에서 헤드셋 브라우저로 PC의 LAN 주소
(`http://<PC-IP>:5173`)를 열고 우하단 고글 버튼을 누른다.
※ WebXR은 **HTTPS**가 필요하다. 실제 배포는 아래 참고.

## 배포 (GitHub Pages, HTTPS 자동)

```bash
npm run build      # dist/ 생성
# dist/ 내용을 gh-pages 브랜치나 Pages 설정 경로에 올림
```

## 조작

| | 키보드(데스크톱) | VR(Quest 컨트롤러) |
|---|---|---|
| 이동 X/Z | ← → ↑ ↓ | 왼쪽 스틱 |
| 눕히기 (앞으로 넘김) | Q / W | 오른쪽 스틱 상하 |
| 돌리기 (제자리 회전) | A / S | 오른쪽 스틱 좌우 |
| 굴리기 (옆으로 넘어짐) | Z / X | A / B 버튼 |
| 하드 드롭 | Space | 오른쪽 트리거 |
| 소프트 드롭 | Shift(홀드) | 왼쪽 그립/트리거 |
| 위치 재조정 | — | 왼쪽 X 버튼 |

VR 조작법은 씬 안의 패널에도 떠 있다. **DOM으로 만든 UI는 헤드셋에서 보이지
않는다** — immersive 세션에 들어가면 브라우저가 WebXR 프레임버퍼만 그리고 HTML
페이지는 사라지기 때문이다. 그래서 점수·조작법·게임오버는 전부 Babylon GUI
평면([`src/render/vrui.ts`](src/render/vrui.ts))으로 씬 안에 들어가 있고,
index.html에 남은 것은 데스크톱 전용 키보드 안내뿐이다.

## 배치

우물은 받침대 위에 놓인 유리 수조다(44cm 폭, 윗면 테두리가 바닥에서 1.28m).
눈높이보다 낮아서 자연스럽게 내려다보게 되고, 유리벽 덕분에 옆에서도 쌓인
높이가 보인다. VR 세션을 시작하거나 왼쪽 X를 누르면 플레이어 앞
[`XR_DISTANCE`](src/config.ts)만큼 떨어진 곳으로 수조가 다시 놓인다.

## 튜닝

- 우물 크기(4×4×8)·낙하 속도·점수·배치: [`src/config.ts`](src/config.ts)
- 조각 세트: [`src/game/pieces.ts`](src/game/pieces.ts)
- 방·수조·받침대: [`src/render/environment.ts`](src/render/environment.ts)
- 효과음(WebAudio 합성, 에셋 없음): [`src/audio/sfx.ts`](src/audio/sfx.ts)
