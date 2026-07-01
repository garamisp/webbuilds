// words.js — 단어 데이터 (한국어 / English)
// 모든 항목은 "완전한 실단어"만. (예전 버전의 '강아'/'김치찌' 같은 잘린 조각 금지)
// 티어는 음절 길이 기준. 레벨이 오를수록 더 긴 단어가 섞인다.
(function (global) {
  'use strict';

  // 한국어: 2글자 / 3글자 / 4글자+ — 전부 완전한 단어
  var KO = {
    short: [
      '사과', '바다', '하늘', '구름', '나무', '바람', '강물', '햇살', '달빛', '별빛',
      '꽃잎', '단풍', '얼음', '모래', '조개', '파도', '등대', '소금', '여행', '기차',
      '버스', '골목', '시장', '국밥', '김밥', '라면', '커피', '녹차', '우유', '사탕',
      '과자', '만두', '치킨', '피자', '책상', '의자', '연필', '가방', '신발', '모자',
      '안경', '시계', '거울', '토끼', '여우', '거북', '참새', '나비', '용기', '지혜',
      '우정', '약속', '미소', '눈물', '추억', '소망', '행운', '평화', '노래', '그림',
      '편지', '지도', '창문', '계단', '우산', '장갑', '촛불', '부엌', '마당', '지붕',
      '대문', '화분', '이불', '베개', '수건', '비누', '거미', '개미'
    ],
    mid: [
      '자전거', '지우개', '햄버거', '갈매기', '두루미', '도시락', '미나리', '봉선화',
      '진달래', '개나리', '무궁화', '민들레', '강아지', '고양이', '다람쥐', '너구리',
      '비행기', '잠수함', '자동차', '소방차', '구급차', '경찰차', '도서관', '박물관',
      '미술관', '체육관', '수영장', '놀이터', '운동장', '정류장', '떡볶이', '비빔밥',
      '순두부', '갈비탕', '삼계탕', '무지개', '소나기', '함박눈', '이슬비', '눈보라',
      '컴퓨터', '키보드', '마우스', '모니터', '스피커', '이어폰', '충전기', '배터리',
      '피아노', '트럼펫', '오르간', '실로폰', '숟가락', '젓가락', '냉장고', '세탁기',
      '청소기', '선풍기', '다리미', '손수건', '운동화', '목걸이', '코끼리', '원숭이',
      '병아리', '잠자리', '맞춤법', '색소폰', '탬버린'
    ],
    long: [
      '베네치아', '해바라기', '고슴도치', '오토바이', '헬리콥터', '김치찌개', '된장찌개',
      '바이올린', '하모니카', '무당벌레', '잠자리채', '컴퓨터공학', '프로그래머', '알고리즘',
      '데이터베이스', '네트워크', '오케스트라', '아이스크림', '초코케이크', '코스모스',
      '받아쓰기', '띄어쓰기', '국어사전', '무지개다리', '반딧불이', '트라이앵글',
      '캐스터네츠', '클라리넷', '아코디언', '개나리꽃', '진달래꽃'
    ]
  };

  // English (전부 실단어)
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
      'adventure', 'expedition', 'wilderness', 'sanctuary', 'cathedral', 'aqueduct'
    ]
  };

  // 레벨(1+)에 맞춰 풀 구성. 낮으면 짧은 단어, 높을수록 긴 단어 비중↑
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
