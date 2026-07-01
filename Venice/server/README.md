# 타자 아레나 — 중개 서버

WebSocket 기반 매치메이킹 + 릴레이 서버. 클라이언트(`Venice/`)는 GitHub Pages 같은 정적 호스팅에 올리고,
이 서버는 Railway 에 배포해 연결한다.

## 하는 일
- `hello` 받은 클라이언트를 빈 자리가 있는 **공개방**(최대 `ROOM_CAP`명)에 배정. 비공개는 1인 전용방.
- 같은 방 사람에게 입장/퇴장(`join`/`leave`) 알림.
- `attack`(맞춘 단어 발사) / `snap`(상대 화면 미니뷰) / `chat` 릴레이.
- `dead`(수몰) 추적 → 방에 살아있는 사람이 1명이면 `winner` 브로드캐스트.

## 로컬 실행
```bash
cd Venice/server
npm install
npm start          # ws://localhost:8787
```
클라이언트를 localhost 에서 열면 자동으로 `ws://localhost:8787` 에 붙는다.

## Railway 배포

### 방법 A — CLI 직접 업로드 (GitHub 불필요, 권장)
`railway up` 은 **현재 폴더를 그대로 업로드**해 클라우드에서 Nixpacks 로 빌드한다. GitHub 저장소가 필요 없다.
`Venice/server` 안에서 실행하므로 프로젝트 루트가 곧 server 폴더 → 별도 root-dir 설정 불필요.
`.railwayignore` 로 `node_modules` 는 업로드 제외(클라우드에서 재설치).

```bash
npm i -g @railway/cli
railway login                 # 브라우저 인증. 브라우저가 안 열리면: railway login --browserless
cd Venice/server
railway init                  # 새 프로젝트 생성 (이름 입력)
railway up                    # 폴더 업로드 → 빌드 → 배포
railway domain                # 공개 도메인 발급 (예: typing-arena-production.up.railway.app)
railway logs                  # 로그 확인 ("Typing Arena relay listening on :XXXX")
```
- 이후 코드 수정 시 **다시 `railway up`** 하면 재배포된다 (git push 자동배포는 없음 — 직접 업로드 방식의 특성).
- 완전 비대화식으로 돌리려면(선택): 대시보드에서 **Project/Service Token** 발급 후
  `RAILWAY_TOKEN=xxxx railway up` 로 로그인 없이 배포 가능.

### 방법 B — 대시보드 + GitHub 연동
1. `Venice/` 를 GitHub 에 push.
2. https://railway.app → New Project → **Deploy from GitHub repo** → `garamisp/webbuilds`.
3. **Settings → Source → Root Directory = `Venice/server`**.
4. Nixpacks 자동 감지 → `npm install` → `node server.js` (PORT 주입).
5. Settings → Networking → **Generate Domain**.

## 클라이언트에 서버 주소 연결
`Venice/js/net.js` 상단의 `RAILWAY_URL` 에 **wss://** 주소를 넣는다:
```js
var RAILWAY_URL = 'wss://venice-production.up.railway.app';
```
> http 도메인이라도 클라이언트가 https(GitHub Pages)이면 반드시 `wss://` 사용.

테스트용으로는 URL 쿼리로도 덮어쓸 수 있다:
`https://garamisp.github.io/webbuilds/Venice/?server=wss://...`

## 하이스코어
- 게임오버 시 클라이언트가 점수를 보내면 서버가 전역 랭킹(아이디별 최고점, TOP 3 표시)을 갱신·브로드캐스트.
- `scores.json` 에 저장. **재배포 시 초기화됨**(파일시스템이 배포마다 리셋). 영구 보존하려면
  Railway 에 **Volume** 을 붙이고 환경변수 `DATA_DIR` 을 볼륨 마운트 경로로 지정.
- **랭킹 초기화**: 환경변수 `ADMIN_KEY` 를 설정한 뒤
  `https://<도메인>/reset?key=<ADMIN_KEY>` 접속 → 랭킹 리셋(모두에게 즉시 반영). 키 없으면 비활성(403).

## 환경변수
- `PORT` — Railway 자동 주입.
- `ROOM_CAP` — 방 최대 인원 (기본 6).
- `AFK_MS` — 자리비움 후 매치 제외까지 유예(ms, 기본 20000).
- `DATA_DIR` — `scores.json` 저장 경로(볼륨 마운트 시 지정, 기본 현재 폴더).
- `ADMIN_KEY` — 설정 시 `/reset?key=...` 로 랭킹 초기화 허용.
