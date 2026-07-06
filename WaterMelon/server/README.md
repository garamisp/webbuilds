# 🍉 수박게임 io — 권위 물리 서버

WebSocket 기반 **권위(authoritative) 물리 서버**. 서버가 Matter.js 로 모든 공의 물리·병합·게임오버를
단독 계산하고, 클라이언트(`../`)는 조준/투하 입력만 보내고 상태를 렌더링한다.
클라이언트는 GitHub Pages 같은 정적 호스팅에 올리고, 이 서버는 Railway 에 배포해 연결한다.

## 하는 일
- 접속한 클라이언트에게 `welcome`(월드 설정 + 내 id + 다음 공 tier) 전송.
- `aim`(조준 x) / `drop`(투하 x) 입력 수신. `drop` 은 쿨다운·개수 상한을 서버가 강제.
- 같은 tier 공이 충돌하면 다음 tier 로 **병합**(수박까지).
- 공이 **멈춘 채** 경계선 위에 2초 지속되면 전체 **게임오버 → 리셋** 브로드캐스트.
  - 생성 유예(1.6초) + 정지속도 게이트로, 갓 떨어진 공이나 충돌로 튕겨 잠깐 넘어간 공은 리셋을 유발하지 않음.
- 30Hz 로 전체 상태(`state`: 공 목록·플레이어 조준·점수)를 브로드캐스트.

## 로컬 실행
```bash
cd WaterMelon/server
npm install
npm start          # ws://localhost:8790 (+ ../ 클라이언트도 http://localhost:8790 로 서빙)
```
로컬에서는 서버가 옆 폴더의 클라이언트까지 서빙하므로 `http://localhost:8790` 하나로 바로 플레이 가능.
클라이언트를 따로 열어도 `localhost` 이면 자동으로 `ws://localhost:8790` 에 붙는다.

## Railway 배포

### 방법 A — CLI 직접 업로드 (권장)
`WaterMelon/server` 안에서 실행 → 이 폴더가 프로젝트 루트가 되어 root-dir 설정 불필요.
`.railwayignore` 로 `node_modules` 는 제외(클라우드에서 재설치).
```bash
npm i -g @railway/cli
railway login                 # 브라우저 인증 (안 열리면: railway login --browserless)
cd WaterMelon/server
railway init                  # 새 프로젝트 생성 (이름: watermelon-io 등)
railway up                    # 폴더 업로드 → Nixpacks 빌드 → 배포
railway domain                # 공개 도메인 발급 (예: watermelon-io-production.up.railway.app)
railway logs                  # "Watermelon.io server listening on :XXXX" 확인
```
- 코드 수정 후 다시 `railway up` → 재배포.

### 방법 B — 대시보드 + GitHub 연동
1. `WaterMelon/` 를 `garamisp/webbuilds` 에 push.
2. Railway → New Project → **Deploy from GitHub repo** → `garamisp/webbuilds`.
3. **Settings → Source → Root Directory = `WaterMelon/server`**.
4. Nixpacks 자동 감지 → `npm install` → `node server.js` (PORT 주입).
5. Settings → Networking → **Generate Domain**.

## 클라이언트에 서버 주소 연결
`WaterMelon/js/net.js` 상단의 `RAILWAY_URL` 에 **wss://** 주소를 넣는다 (현재 배포 도메인):
```js
var RAILWAY_URL = 'wss://webbuilds-production-5ab3.up.railway.app';
```
> GitHub Pages 는 https 이므로 반드시 `wss://` 사용.
> 테스트용으로 URL 쿼리 덮어쓰기도 가능: `.../WaterMelon/?server=wss://...`

## 환경변수
- `PORT` — Railway 자동 주입 (로컬 기본 8790).
