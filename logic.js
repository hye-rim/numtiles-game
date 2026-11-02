'use strict';
// 숫자 타일 게임(루미큐브식) 규칙 (DOM 없음). 화면은 game.js, 시험은 test/logic.test.js
// 타일은 0~105: 0~103 은 숫자 타일(색 4 × 숫자 1~13 × 2벌), 104·105 는 조커
const LOGIC_NUMTILES = (() => {
  const HAND = 14, OPEN_MIN = 30, JOKER_PENALTY = 30, ROUNDS = 1;
  const COLORS = ['검정', '파랑', '빨강', '주황'];
  const NAMES = ['나', '민수', '지아', '도윤'];
  const isJoker = (id) => id >= 104;
  const colorOf = (id) => (isJoker(id) ? -1 : Math.floor(id / 26));
  const numOf = (id) => (isJoker(id) ? 0 : (id % 13) + 1);
  const tileName = (id) => (isJoker(id) ? '조커' : `${COLORS[colorOf(id)]} ${numOf(id)}`);

  const rng = (seed) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const emit = (st, e) => { st.events.push(e); };

  // ---------- 묶음 판정 ----------
  // 묶음(같은 숫자 3~4장, 색은 모두 다름) 또는 줄(같은 색 연속 3장 이상, 1 은 맨 앞뿐). 조커는 빈 자리를 채운다.
  // 되돌려 주는 값: { kind, order: [id…], values: [각 타일이 나타내는 숫자], points } 또는 null
  function arrangeSet(ids) {
    const n = ids.length;
    if (n < 3) return null;
    const jokers = ids.filter(isJoker), nj = ids.filter((i) => !isJoker(i));
    if (!nj.length) return null;
    let best = null;
    // 묶음
    const num = numOf(nj[0]);
    if (n <= 4 && nj.every((i) => numOf(i) === num) && new Set(nj.map(colorOf)).size === nj.length) {
      const order = [...nj.sort((a, b) => colorOf(a) - colorOf(b)), ...jokers];
      best = { kind: 'group', order, values: order.map(() => num), points: num * n };
    }
    // 줄
    const color = colorOf(nj[0]);
    if (nj.every((i) => colorOf(i) === color) && new Set(nj.map(numOf)).size === nj.length) {
      const sorted = nj.slice().sort((a, b) => numOf(a) - numOf(b));
      const lo = numOf(sorted[0]), hi = numOf(sorted[sorted.length - 1]);
      const gaps = (hi - lo + 1) - nj.length;
      if (gaps <= jokers.length) {
        let spare = jokers.length - gaps;
        const room = (lo - 1) + (13 - hi);
        if (spare <= room) {
          const slots = []; let ji = 0;
          const byNum = new Map(sorted.map((i) => [numOf(i), i]));
          for (let v = lo; v <= hi; v++) slots.push({ v, id: byNum.has(v) ? byNum.get(v) : jokers[ji++] });
          // 남은 조커는 값이 큰 쪽(오른쪽)부터 붙인다
          let up = hi, down = lo;
          while (spare > 0) { if (up < 13) { up++; slots.push({ v: up, id: jokers[ji++] }); } else { down--; slots.unshift({ v: down, id: jokers[ji++] }); } spare--; }
          const run = { kind: 'run', order: slots.map((s) => s.id), values: slots.map((s) => s.v), points: slots.reduce((s, x) => s + x.v, 0) };
          if (!best || run.points > best.points) best = run;
        }
      }
    }
    return best;
  }
  const isValidSet = (ids) => !!arrangeSet(ids);
  const rackPoints = (ids) => ids.reduce((s, i) => s + (isJoker(i) ? JOKER_PENALTY : numOf(i)), 0);

  // ---------- 게임 만들기 ----------
  function newGame(rand = Math.random, opts = {}) {
    const names = opts.names || NAMES;
    const st = { rand, events: [], round: 0, rounds: opts.rounds || ROUNDS, dealer: -1, phase: 'idle', difficulty: opts.level || 'normal',
      players: names.map((name, i) => ({ name, human: i === 0, rack: [], opened: false, score: 0, easy: opts.level === 'easy' && i > 0 })), table: [], pool: [], turn: 0, passes: 0, result: null };
    startRound(st);
    return st;
  }
  function startRound(st) {
    st.round++;
    st.dealer = (st.dealer + 1) % st.players.length;
    st.pool = Array.from({ length: 106 }, (_, i) => i);
    for (let i = 105; i > 0; i--) { const j = Math.floor(st.rand() * (i + 1)); [st.pool[i], st.pool[j]] = [st.pool[j], st.pool[i]]; }
    st.table = []; st.result = null; st.passes = 0;
    for (const p of st.players) { p.opened = false; p.rack = []; for (let k = 0; k < HAND; k++) p.rack.push(st.pool.pop()); p.rack.sort((a, b) => a - b); }
    st.turn = (st.dealer + 1) % st.players.length;
    st.phase = 'play';
    emit(st, { t: 'round', round: st.round });
    emit(st, { t: 'turn', who: st.turn });
  }

  // ---------- 낸 수 검사 ----------
  // arrangement: 이번 차례가 끝난 뒤의 탁자 전체 (타일 번호 배열들의 배열)
  function check(st, who, arrangement) {
    const p = st.players[who];
    const flat = arrangement.flat();
    if (new Set(flat).size !== flat.length) return { ok: false, why: '같은 타일이 두 번 쓰였어요' };
    const onTable = new Set(st.table.flat()), mine = new Set(p.rack);
    for (const id of flat) if (!onTable.has(id) && !mine.has(id)) return { ok: false, why: '내 것이 아닌 타일이 있어요' };
    const now = new Set(flat);
    for (const id of onTable) if (!now.has(id)) return { ok: false, why: '탁자에 있던 타일은 가져갈 수 없어요 (조커도 다시 써야 해요)' };
    const played = flat.filter((id) => mine.has(id));
    if (!played.length) return { ok: false, why: '내 타일을 한 장 이상 내야 해요' };
    for (const set of arrangement) if (!isValidSet(set)) return { ok: false, why: '맞지 않는 묶음이 있어요', bad: set };
    if (!p.opened) {
      // 처음 내기: 탁자의 묶음은 그대로 두고, 내 타일만으로 만든 새 묶음의 합이 30 이상이어야 한다
      const old = st.table.map((s) => s.slice().sort((a, b) => a - b).join(','));
      const remaining = old.slice();
      let points = 0;
      for (const set of arrangement) {
        const key = set.slice().sort((a, b) => a - b).join(',');
        const k = remaining.indexOf(key);
        if (k >= 0) { remaining.splice(k, 1); continue; }
        if (!set.every((id) => mine.has(id))) return { ok: false, why: '처음에는 탁자의 타일을 건드릴 수 없어요' };
        points += arrangeSet(set).points;
      }
      if (remaining.length) return { ok: false, why: '처음에는 탁자의 타일을 건드릴 수 없어요' };
      if (points < OPEN_MIN) return { ok: false, why: `처음에는 합이 ${OPEN_MIN} 이상이어야 해요 (지금 ${points})`, points };
    }
    return { ok: true, played, points: 0 };
  }
  function commit(st, arrangement) {
    if (st.phase !== 'play') return { ok: false, why: '지금은 낼 수 없어요' };
    const who = st.turn, p = st.players[who];
    const r = check(st, who, arrangement);
    if (!r.ok) return r;
    const played = new Set(r.played);
    p.rack = p.rack.filter((id) => !played.has(id));
    st.table = arrangement.map((s) => s.slice());
    const first = !p.opened; p.opened = true; st.passes = 0;
    emit(st, { t: 'play', who, count: r.played.length, first, tiles: r.played });
    if (!p.rack.length) { finishRound(st, who, 'out'); return { ok: true }; }
    nextTurn(st);
    return { ok: true };
  }
  function drawTurn(st) {
    if (st.phase !== 'play') return false;
    const who = st.turn, p = st.players[who];
    if (st.pool.length) { const id = st.pool.pop(); p.rack.push(id); p.rack.sort((a, b) => a - b); st.passes = 0; emit(st, { t: 'draw', who, tile: p.human ? id : null }); }
    else { st.passes++; emit(st, { t: 'pass', who }); if (st.passes >= st.players.length) { finishRound(st, -1, 'stalemate'); return true; } }
    nextTurn(st);
    return true;
  }
  function nextTurn(st) { st.turn = (st.turn + 1) % st.players.length; emit(st, { t: 'turn', who: st.turn }); }
  function finishRound(st, winner, kind) {
    const totals = st.players.map((p) => rackPoints(p.rack)), deltas = st.players.map(() => 0);
    let w = winner;
    if (kind === 'stalemate') { const min = Math.min(...totals); const lows = totals.map((t, i) => i).filter((i) => totals[i] === min); w = lows.length === 1 ? lows[0] : -1; if (w >= 0) for (let i = 0; i < totals.length; i++) if (i !== w) { deltas[i] -= totals[i] - min; deltas[w] += totals[i] - min; } }
    else for (let i = 0; i < totals.length; i++) if (i !== w) { deltas[i] -= totals[i]; deltas[w] += totals[i]; }
    st.players.forEach((p, i) => { p.score += deltas[i]; });
    st.result = { kind, winner: w, totals, deltas };
    st.phase = st.round >= st.rounds ? 'matchover' : 'roundover';
    emit(st, { t: 'roundend', result: st.result });
  }
  const nextRound = (st) => { if (st.phase !== 'roundover') return false; startRound(st); return true; };
  const ranking = (st) => st.players.map((p, i) => i).sort((a, b) => st.players[b].score - st.players[a].score);

  // ---------- 컴퓨터: 낼 수를 찾는다 ----------
  // 타일 종류별 개수(색 × 숫자)와 조커 수로 다루어 빠르게 찾는다
  const typeKey = (c, n) => c * 13 + (n - 1);
  function countsOf(ids) {
    const cnt = new Array(52).fill(0); let jk = 0;
    for (const id of ids) if (isJoker(id)) jk++; else cnt[typeKey(colorOf(id), numOf(id))]++;
    return { cnt, jk };
  }
  // 만들 수 있는 모든 묶음/줄 후보: { types: [{k, n}], jokers, points }
  function candidates(counts) {
    const out = [];
    const { cnt, jk } = counts;
    for (let n = 1; n <= 13; n++) {                                  // 묶음: 숫자 n, 서로 다른 색 3~4
      const have = []; for (let c = 0; c < 4; c++) if (cnt[typeKey(c, n)] > 0) have.push(c);
      const subsets = [];
      for (let mask = 1; mask < 16; mask++) { const cs = []; for (let c = 0; c < 4; c++) if (mask & (1 << c)) cs.push(c); if (cs.every((c) => have.includes(c))) subsets.push(cs); }
      for (const cs of subsets) for (let j = 0; j <= Math.min(jk, 2); j++) { const size = cs.length + j; if (size >= 3 && size <= 4) out.push({ types: cs.map((c) => typeKey(c, n)), jokers: j, points: n * size, kind: 'group' }); }
    }
    for (let c = 0; c < 4; c++) for (let lo = 1; lo <= 11; lo++) for (let hi = lo + 2; hi <= 13; hi++) {   // 줄: 같은 색 lo..hi
      let missing = 0, types = [], pts = 0;
      for (let v = lo; v <= hi; v++) { if (cnt[typeKey(c, v)] > 0) types.push(typeKey(c, v)); else missing++; pts += v; }
      if (missing <= jk && types.length) out.push({ types, jokers: missing, points: pts, kind: 'run' });
    }
    return out;
  }
  // 겹치지 않게 골라 목적에 가장 맞는 조합 (best: 고른 후보들). goal: 'open' (합 최대) | 'count' (낸 장수 최대, 같으면 합)
  function packBest(counts, goal, budget = 40000) {
    const cands = candidates(counts);
    const byFirst = Array.from({ length: 52 }, () => []);
    for (const cd of cands) byFirst[Math.min(...cd.types)].push(cd);
    const cnt = counts.cnt.slice(); let jk = counts.jk;
    let best = { score: -1, picks: [] }, nodes = 0;
    const score = (picks) => { let tiles = 0, pts = 0; for (const p of picks) { tiles += p.types.length + p.jokers; pts += p.points; } return goal === 'open' ? pts * 100 + tiles : tiles * 1000 + pts; };
    const rec = (k, picks) => {
      if (nodes++ > budget) return;
      const s = score(picks); if (s > best.score) best = { score: s, picks: picks.slice() };
      while (k < 52 && cnt[k] === 0) k++;
      if (k >= 52) return;
      for (const cd of byFirst[k]) {                                  // 이 타일 종류를 포함하는 후보 (가장 앞 종류가 k)
        if (cd.jokers > jk) continue;
        let ok = true; for (const t of cd.types) if (cnt[t] < 1) { ok = false; break; }
        if (!ok) continue;
        for (const t of cd.types) cnt[t]--; jk -= cd.jokers; picks.push(cd);
        rec(k, picks);
        picks.pop(); jk += cd.jokers; for (const t of cd.types) cnt[t]++;
      }
      cnt[k]--; rec(k, picks); cnt[k]++;                              // 이 타일은 쓰지 않음
    };
    rec(0, []);
    return best;
  }
  // 후보를 실제 타일 번호로 바꾼다 (손에서 같은 종류 중 아무거나)
  function realize(picks, rack) {
    const pool = rack.slice();
    const take = (k) => { const i = pool.findIndex((id) => !isJoker(id) && typeKey(colorOf(id), numOf(id)) === k); return i >= 0 ? pool.splice(i, 1)[0] : -1; };
    const takeJ = () => { const i = pool.findIndex(isJoker); return i >= 0 ? pool.splice(i, 1)[0] : -1; };
    const sets = [];
    for (const p of picks) { const s = []; for (const k of p.types) s.push(take(k)); for (let j = 0; j < p.jokers; j++) s.push(takeJ()); if (s.includes(-1)) return null; sets.push(s); }
    return sets;
  }

  // 탁자의 한 묶음에서 한 장(또는 그대로) 빼고도 맞는 나머지 모양들
  function remainders(set, id) {
    const rest = set.filter((x) => x !== id);
    const outs = [];
    if (isValidSet(rest)) outs.push([rest]);
    const a = arrangeSet(set);
    if (a && a.kind === 'run') {                                      // 줄의 가운데에서 빼면 두 줄로 나뉜다
      const pos = a.order.indexOf(id);
      const left = a.order.slice(0, pos), right = a.order.slice(pos + 1);
      if (pos > 0 && pos < a.order.length - 1 && left.length >= 3 && right.length >= 3) outs.push([left, right]);
    }
    return outs;
  }

  // 컴퓨터가 낼 수: 이번 차례가 끝난 뒤의 탁자 전체(arrangement) 또는 null (낼 수 없음)
  function plan(st, who, opts = {}) {
    const p = st.players[who];
    const full = !p.easy && !opts.simple;
    let table = st.table.map((s) => s.slice());
    let rack = p.rack.slice();
    const start = rack.length;
    if (!p.opened) {
      const best = packBest(countsOf(rack), 'open');
      const sets = realize(best.picks, rack);
      if (!sets) return null;
      const pts = sets.reduce((s, x) => s + arrangeSet(x).points, 0);
      if (pts < OPEN_MIN) return null;
      for (const s of sets) { table.push(s); for (const id of s) rack.splice(rack.indexOf(id), 1); }
      // 처음에 낸 뒤에는 남은 타일을 붙일 수 있다
    } else if (full || rack.length > 0) {
      const best = packBest(countsOf(rack), 'count');
      const sets = realize(best.picks, rack) || [];
      for (const s of sets) { table.push(s); for (const id of s) rack.splice(rack.indexOf(id), 1); }
    }
    if (p.opened) {                                                  // 처음 낸 차례에는 탁자를 건드릴 수 없다
      for (let guard = 0; guard < 40; guard++) {
        let changed = false;
        // 1) 한 장씩 기존 묶음에 붙이기
        for (const id of rack.slice()) {
          for (let si = 0; si < table.length; si++) {
            if (isValidSet([...table[si], id])) { table[si] = [...table[si], id]; rack.splice(rack.indexOf(id), 1); changed = true; break; }
          }
        }
        if (full) {
          // 2) 조커 바꿔치기: 탁자 조커가 나타내는 타일이 손에 있으면 바꾸고, 조커는 새 묶음에 쓴다
          for (let si = 0; si < table.length && !changed; si++) {
            const a = arrangeSet(table[si]); if (!a) continue;
            a.order.forEach((id, pos) => {
              if (changed || !isJoker(id)) return;
              const want = a.values[pos];
              const color = a.kind === 'run' ? colorOf(a.order.find((x) => !isJoker(x))) : null;
              const cand = rack.find((r) => !isJoker(r) && numOf(r) === want && (a.kind === 'run' ? colorOf(r) === color : !table[si].some((t) => !isJoker(t) && colorOf(t) === colorOf(r))));
              if (cand === undefined) return;
              const nset = table[si].map((x) => (x === id ? cand : x));
              if (!isValidSet(nset)) return;
              const r2 = rack.filter((x) => x !== cand).concat([id]);
              const best = packBest(countsOf(r2), 'count'); const sets = realize(best.picks, r2);
              if (sets && sets.some((s) => s.includes(id))) {
                table[si] = nset; rack = r2;
                for (const s of sets) { table.push(s); for (const t of s) rack.splice(rack.indexOf(t), 1); }
                changed = true;
              }
            });
          }
          // 3) 탁자에서 한 장 빌려 새 묶음 만들기
          if (!changed) {
            outer:
            for (let si = 0; si < table.length; si++) for (const id of table[si]) {
              if (isJoker(id)) continue;
              for (const rem of remainders(table[si], id)) {
                const r2 = rack.concat([id]);
                const best = packBest(countsOf(r2), 'count', 8000); const sets = realize(best.picks, r2);
                if (!sets) continue;
                const used = sets.filter((s) => s.includes(id));
                if (!used.length) continue;
                const playedFromRack = sets.reduce((n, s) => n + s.filter((t) => t !== id).length, 0);
                if (playedFromRack < 2) continue;
                const nextTable = table.slice(); nextTable.splice(si, 1, ...rem);
                for (const s of sets) { nextTable.push(s); }
                const nr = rack.slice(); for (const s of sets) for (const t of s) if (t !== id) nr.splice(nr.indexOf(t), 1);
                table = nextTable; rack = nr; changed = true; break outer;
              }
            }
          }
        }
        if (!changed) break;
      }
    }
    if (rack.length === start) return null;
    const arr = table.filter((s) => s.length);
    return check({ ...st, table: st.table }, who, arr).ok ? arr : null;
  }
  function cpuTurn(st) {
    if (st.phase !== 'play' || st.players[st.turn].human) return false;
    const who = st.turn, p = st.players[who];
    let arr = plan(st, who);
    if (arr && p.easy && p.opened && st.rand() < 0.3 && p.rack.length > 3) arr = null;              // 쉬움: 가끔 낼 수 있어도 안 냄
    if (arr) { const r = commit(st, arr); if (r.ok) return true; }
    return drawTurn(st);
  }
  // 사람에게 보여 줄 추천 수 (컴퓨터와 같은 방법)
  const suggest = (st, who) => plan({ ...st, players: st.players.map((p, i) => (i === who ? { ...p, easy: false } : p)) }, who);

  return {
    HAND, OPEN_MIN, JOKER_PENALTY, ROUNDS, COLORS, NAMES,
    rng, isJoker, colorOf, numOf, tileName, arrangeSet, isValidSet, rackPoints,
    newGame, startRound, nextRound, check, commit, drawTurn, ranking, cpuTurn, suggest, plan, packBest, countsOf, candidates, realize, remainders,
  };
})();
if (typeof module !== 'undefined') module.exports = LOGIC_NUMTILES;
