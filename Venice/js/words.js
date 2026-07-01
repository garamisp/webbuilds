// words.js — 단어 데이터 (한국어 / English)
// 난이도 티어별로 길이를 나눠 둔다. 레벨이 오를수록 더 긴 단어가 섞인다.
// 모든 파일은 UTF-8 로 저장 — 한글이 깨지지 않도록 charset=utf-8 와 함께 사용.
(function (global) {
  'use strict';

  // 한국어: 2글자 / 3글자 / 4글자 이상 으로 나눈다.
  var KO = {
    short: [
      '사과', '바다', '하늘', '구름', '나무', '바람', '강물', '햇살', '달빛', '별빛',
      '꽃잎', '단풍', '눈송', '얼음', '모래', '조개', '파도', '등대', '갈매', '소금',
      '여행', '기차', '버스', '자전', '골목', '시장', '국밥', '김밥', '라면', '떡볶',
      '커피', '녹차', '우유', '사탕', '과자', '꿀떡', '만두', '치킨', '피자', '햄버',
      '책상', '의자', '연필', '지우', '가방', '신발', '모자', '안경', '시계', '거울',
      '강아', '고양', '토끼', '여우', '거북', '두루', '제비', '참새', '나비', '벌집',
      '용기', '지혜', '우정', '약속', '미소', '눈물', '추억', '소망', '행운', '평화'
    ],
    mid: [
      '베네치아', '도시락', '미나리', '코스모', '봉선화', '진달래', '개나리', '무궁화',
      '해바라기', '민들레', '강아지', '고양이', '다람쥐', '고슴도', '너구리', '오소리',
      '비행기', '잠수함', '자동차', '오토바', '헬리콥', '소방차', '구급차', '경찰차',
      '도서관', '박물관', '미술관', '체육관', '수영장', '놀이터', '운동장', '정류장',
      '떡볶이', '김치찌', '된장국', '비빔밥', '냉면집', '순두부', '갈비탕', '삼계탕',
      '무지개', '반딧불', '소나기', '함박눈', '안개비', '이슬비', '눈보라', '돌풍우',
      '컴퓨터', '키보드', '마우스', '모니터', '스피커', '이어폰', '충전기', '배터리',
      '바이올', '피아노', '드럼통', '기타줄', '하모니', '트럼펫', '오르간', '실로폰'
    ],
    long: [
      '베네치아온라인', '타자연습장', '컴퓨터공학', '인공지능시대', '우주정거장',
      '해바라기씨앗', '도서관사서', '비빔냉면집', '떡볶이가게', '오징어볶음밥',
      '무지개다리', '반딧불이숲', '소나기구름', '함박눈송이', '안개낀항구',
      '키보드워리어', '게임프로그래머', '네트워크통신', '데이터베이스', '알고리즘공부',
      '바이올린연주', '오케스트라단', '뮤지컬배우', '발레리나춤', '재즈피아노',
      '한국어공부방', '받아쓰기시험', '맞춤법검사', '띄어쓰기연습', '국어사전찾기',
      '베네치아곤돌라', '물의도시여행', '운하위의배', '수상가옥마을', '가라앉는도시'
    ]
  };

  // English
  var EN = {
    short: [
      'sky', 'sea', 'sun', 'moon', 'star', 'wave', 'sand', 'rock', 'wind', 'rain',
      'fire', 'ice', 'tree', 'leaf', 'rose', 'lily', 'bird', 'fish', 'frog', 'bear',
      'cat', 'dog', 'fox', 'owl', 'bee', 'ant', 'cow', 'pig', 'hen', 'bat',
      'book', 'pen', 'desk', 'lamp', 'cup', 'key', 'door', 'wall', 'road', 'ship',
      'cake', 'milk', 'tea', 'rice', 'soup', 'bean', 'corn', 'salt', 'pizza', 'taco',
      'hope', 'love', 'luck', 'calm', 'glow', 'dawn', 'dusk', 'echo', 'mist', 'flux'
    ],
    mid: [
      'venice', 'island', 'harbor', 'lagoon', 'bridge', 'canal', 'gondola', 'sunset',
      'thunder', 'rainbow', 'blizzard', 'tempest', 'glacier', 'volcano', 'horizon',
      'rabbit', 'turtle', 'dolphin', 'penguin', 'octopus', 'pelican', 'sparrow',
      'machine', 'circuit', 'network', 'monitor', 'speaker', 'battery', 'charger',
      'guitar', 'violin', 'trumpet', 'cymbal', 'melody', 'rhythm', 'harmony',
      'noodle', 'pretzel', 'biscuit', 'pudding', 'waffle', 'sundae', 'muffin',
      'castle', 'tower', 'cannon', 'shield', 'banner', 'knight', 'dragon', 'wizard'
    ],
    long: [
      'venezia', 'submarine', 'lighthouse', 'waterfall', 'butterfly', 'chameleon',
      'astronaut', 'spaceship', 'satellite', 'telescope', 'microscope', 'helicopter',
      'algorithm', 'database', 'keyboard', 'developer', 'programmer', 'simulation',
      'orchestra', 'symphony', 'crescendo', 'percussion', 'saxophone', 'xylophone',
      'adventure', 'expedition', 'wilderness', 'sanctuary', 'cathedral', 'aqueduct',
      'veniceonline', 'floatingcity', 'sinkingtown', 'risingwater', 'finalround'
    ]
  };

  // 레벨(1+)에 맞춰 풀을 구성한다. 낮은 레벨은 짧은 단어 위주, 높을수록 긴 단어 비중↑
  function poolForLevel(lang, level) {
    var src = lang === 'en' ? EN : KO;
    var pool = src.short.slice();
    if (level >= 3) pool = pool.concat(src.mid);
    if (level >= 6) pool = pool.concat(src.mid); // mid 비중 강화
    if (level >= 8) pool = pool.concat(src.long);
    if (level >= 12) pool = pool.concat(src.long);
    return pool;
  }

  // 무작위 단어 하나. 화면에 이미 떠 있는 단어(busy set)와 겹치지 않게 시도.
  function pick(lang, level, busySet) {
    var pool = poolForLevel(lang, level);
    for (var i = 0; i < 12; i++) {
      var w = pool[(Math.random() * pool.length) | 0];
      if (!busySet || !busySet.has(w)) return w;
    }
    return pool[(Math.random() * pool.length) | 0];
  }

  global.VeniceWords = {
    KO: KO,
    EN: EN,
    poolForLevel: poolForLevel,
    pick: pick
  };
})(window);
