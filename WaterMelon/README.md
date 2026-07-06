# 🍉 수박게임 io (Co-op Watermelon)

여러 명이 **협동**하는 [수박게임(Suika Game)](https://en.wikipedia.org/wiki/Suika_Game) io 버전.
가로로 넓은 필드에 각자 공을 떨어뜨리고, 같은 등급끼리 부딪히면 커집니다.
목표는 없습니다 — 다 같이 오래 버티는 게임. 공이 상단 경계선 위에 **멈춘 채 오래 있으면** 전체 리셋.

`webbuilds` 저장소의 게임 폴더 컨벤션을 따릅니다: **클라이언트(정적) = 이 폴더**, **서버 = `server/`(Railway)**.

## 구조
```
WaterMelon/
├─ index.html          클라이언트 진입점 (GitHub Pages)
├─ css/style.css
├─ js/net.js           WebSocket 클라이언트 (Railway 서버 연결)
├─ js/game.js          렌더링 + 입력
└─ server/             권위 물리 서버 (Railway)
   ├─ server.js        ws + Matter.js
   ├─ railway.json
   └─ README.md        ← 배포 방법 상세
```

- **서버가 물리를 단독 계산**(authoritative). 클라이언트는 조준/투하 입력만 보내고 상태를 렌더링.
- 로컬에서는 서버가 클라이언트까지 서빙 → `http://localhost:8790` 하나로 바로 플레이.

### 게임오버 규칙 (오발 방지)
공이 아래를 **동시에·연속으로** 만족할 때만 게임오버:
1. 생성 후 유예(1.6초) 경과,
2. 속도가 느려 **멈춰 있고**(settled),
3. 경계선 위로 삐져나온 상태가 **2초간 지속**.

→ 방금 떨어뜨린 공, 충돌로 튕겨 빠르게 움직이는 공, 서로 부딪혀 잠깐 넘어간 공은 리셋시키지 않습니다.

## 로컬 실행
```bash
cd server
npm install
npm start            # http://localhost:8790 을 여러 탭/기기에서 열면 협동 플레이
```

## 배포
- 클라이언트: `WaterMelon/` 를 `garamisp/webbuilds` 에 올리면 GitHub Pages 로 서빙
  (`https://garamisp.github.io/webbuilds/WaterMelon/`).
- 서버: `server/` 를 Railway 에 배포 후, 발급된 `wss://` 도메인을 `js/net.js` 의 `RAILWAY_URL` 에 기입.
- 자세한 배포 절차는 [`server/README.md`](server/README.md) 참고.

## 조작
- 마우스 이동 / 터치: 조준
- 클릭 / 터치 / 스페이스바: 공 떨어뜨리기 (쿨다운 0.6초)
