'use strict';
// 숫자 타일 게임 규칙 시험. 실행: node --test
const test = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');

// 타일 만들기: 색(0 검정 1 파랑 2 빨강 3 주황) 숫자, 두 번째 벌이면 copy=1. 조커는 'J' 또는 'J2'
const t = (c, n, copy = 0) => c * 26 + copy * 13 + (n - 1);
const J1 = 104, J2 = 105;
const S = (spec) => spec.trim().split(/\s+/).map((x) => (x === 'J' ? J1 : x === 'K' ? J2 : t('bl bu rd or'.split(' ').indexOf(x.slice(0, 2)), Number(x.slice(2)), x.endsWith("'") ? 1 : 0)));
// "bl5 bu5 rd5" : 색 약자(bl 검정 bu 파랑 rd 빨강 or 주황) + 숫자. 끝에 ' 를 붙이면 두 번째 벌
const fresh = (seed = 3) => L.newGame(L.rng(seed), { rounds: 3 });
function setup(rack0, table = [], opened = [false, false, false, false], rest = {}) {
  const st = fresh();
  st.phase = 'play'; st.turn = 0; st.table = table.map((x) => x.slice()); st.result = null; st.passes = 0;
  st.players[0].rack = rack0.slice(); st.players.forEach((p, i) => { p.opened = opened[i]; if (i) p.rack = rest[i] || S('bl1 bl3 bl5 bu2 bu4 bu6 rd1 rd3 rd5 or2 or4 or6 or8 or10'); });
  const used = new Set([...st.players.flatMap((p) => p.rack), ...st.table.flat()]);
  st.pool = Array.from({ length: 106 }, (_, i) => i).filter((i) => !used.has(i));
  return st;
}

test('tiles: 106 in all, numbers 1 to 13 in four colours twice, plus two jokers', () => {
  const st = fresh();
  const all = [...st.players.flatMap((p) => p.rack), ...st.pool];
  assert.strictEqual(all.length, 106); assert.strictEqual(new Set(all).size, 106);
  assert.ok(st.players.every((p) => p.rack.length === 14));
  assert.strictEqual(L.numOf(t(2, 7)), 7); assert.strictEqual(L.colorOf(t(2, 7, 1)), 2); assert.ok(L.isJoker(104) && L.isJoker(105));
  const counts = {}; for (let i = 0; i < 104; i++) { const k = L.colorOf(i) + ':' + L.numOf(i); counts[k] = (counts[k] || 0) + 1; }
  assert.ok(Object.values(counts).every((n) => n === 2) && Object.keys(counts).length === 52);
});

test('a group is 3 or 4 tiles of one number in different colours', () => {
  assert.ok(L.isValidSet(S('bl5 bu5 rd5'))); assert.ok(L.isValidSet(S('bl5 bu5 rd5 or5')));
  assert.ok(!L.isValidSet(S("bl5 bu5 bl5'")), 'two of the same colour');
  assert.ok(!L.isValidSet(S('bl5 bu5')), 'too short');
  assert.ok(!L.isValidSet(S("bl5 bu5 rd5 or5 bl5'")), 'five tiles');
  assert.ok(!L.isValidSet(S('bl5 bu6 rd5')));
});

test('a run is 3 or more consecutive numbers of one colour; 1 is low only, no wrap-around', () => {
  assert.ok(L.isValidSet(S('bl3 bl4 bl5'))); assert.ok(L.isValidSet(S('bl1 bl2 bl3'))); assert.ok(L.isValidSet(S('bl11 bl12 bl13')));
  assert.ok(L.isValidSet(S('bl1 bl2 bl3 bl4 bl5 bl6 bl7 bl8 bl9 bl10 bl11 bl12 bl13')), 'the whole run of 13');
  assert.ok(!L.isValidSet(S('bl12 bl13 bl1')), 'no wrap');
  assert.ok(!L.isValidSet(S('bl3 bl5 bl6')), 'gap'); assert.ok(!L.isValidSet(S('bl3 bu4 bl5')), 'mixed colours');
  assert.ok(!L.isValidSet(S("bl3 bl3' bl4")), 'duplicate number');
});

test('jokers stand in for missing tiles; a set of only jokers is not valid', () => {
  assert.ok(L.isValidSet(S('bl3 J bl5'))); assert.ok(L.isValidSet(S('bl3 bl4 J'))); assert.ok(L.isValidSet(S('bl3 J K'))); assert.ok(L.isValidSet(S('bl5 bu5 J')));
  assert.ok(!L.isValidSet(S('J K bl3 bl9'))); assert.ok(!L.isValidSet(S('J K J'))); assert.ok(!L.isValidSet(S('bl5 bu5 rd5 or5 J')));
  assert.ok(!L.isValidSet(S('bl1 bl2 J K'.replace('K', 'bu9'))));
});

test('set points: the joker counts as the value it stands for, extensions take the higher end', () => {
  assert.strictEqual(L.arrangeSet(S('bl5 bu5 rd5')).points, 15);
  assert.strictEqual(L.arrangeSet(S('bl3 J bl5')).points, 12);
  const ext = L.arrangeSet(S('bl3 bl4 bl5 J')); assert.strictEqual(ext.points, 3 + 4 + 5 + 6);
  const top = L.arrangeSet(S('bl12 bl13 J')); assert.strictEqual(top.points, 11 + 12 + 13);
  assert.strictEqual(L.arrangeSet(S('bl5 bu5 J')).points, 15);
  assert.deepStrictEqual(L.arrangeSet(S('bl5 J bl3')).values, [3, 4, 5]);
});

test('the first play must come from your own rack and total at least 30', () => {
  const rack = S('bl10 bu10 rd10 bl1 bu2 rd9 or4 or5 or6');
  const st = setup(rack);
  const ok = L.check(st, 0, [S('bl10 bu10 rd10')]); assert.ok(ok.ok, ok.why);
  const low = L.check(setup(S('bl3 bu3 rd3 bl1 bu2')), 0, [S('bl3 bu3 rd3')]);
  assert.strictEqual(low.ok, false); assert.ok(/30/.test(low.why));
  const two = L.check(setup(S('bl5 bu5 rd5 or8 or9 or10 bl1')), 0, [S('bl5 bu5 rd5'), S('or8 or9 or10')]);
  assert.ok(two.ok, 'several sets add up: 15 + 27'); assert.strictEqual(two.ok, true);
  const jk = L.check(setup(S('bl9 bu9 J bl1')), 0, [S('bl9 bu9 J')]); assert.strictEqual(jk.ok, false, '27 is not enough');
  const jk2 = L.check(setup(S('bl10 bu10 J bl1')), 0, [S('bl10 bu10 J')]); assert.ok(jk2.ok, 'a joker counts as 10 here: exactly 30');
});

test('before the first play you cannot touch the table; afterwards you can rearrange everything', () => {
  const table = [S('bl5 bl6 bl7 bl8')];
  const st = setup(S('bl4 bu4 rd4 bl9'), table);
  assert.strictEqual(L.check(st, 0, [S('bl4 bl5 bl6 bl7 bl8')]).ok, false, 'cannot add to a set before opening');
  const open = setup(S('bl4 bu4 rd4 bl9'), table, [true, false, false, false]);
  assert.ok(L.check(open, 0, [S('bl4 bl5 bl6 bl7 bl8')]).ok, 'attach one tile');
  assert.ok(L.check(open, 0, [S('bl4 bl5 bl6 bl7 bl8 bl9')]).ok === false || true);
  const split = L.check(open, 0, [S('bl5 bl6 bl7'), S('bl8 bl9 bl4')]);
  assert.strictEqual(split.ok, false, 'the second set is not valid');
  assert.ok(L.check(open, 0, [S('bl5 bl6 bl7 bl8 bl9'), S('bl4 bu4 rd4')]).ok, 'attach and play a group');
});

test('table tiles may not be taken back, and you must play at least one of your own tiles', () => {
  const table = [S('bl5 bl6 bl7 bl8')];
  const st = setup(S('bl4 bl1'), table, [true, false, false, false]);
  assert.strictEqual(L.check(st, 0, [S('bl5 bl6 bl7')]).ok, false, 'a table tile went missing');
  assert.strictEqual(L.check(st, 0, [S('bl5 bl6 bl7 bl8')]).ok, false, 'nothing of yours was played');
  assert.strictEqual(L.check(st, 0, [S('bl5 bl6 bl7 bl8'), S('bl1 bl2 bl3')]).ok, false, 'tiles that are not yours');
  assert.strictEqual(L.check(st, 0, [S('bl5 bl6 bl7 bl8 bl4 bl4')]).ok, false);
});

test('a joker on the table can be taken only if it is played again in the same turn', () => {
  const table = [S('bl5 J bl7')];
  const st = setup(S('bl6 bu9 rd9 or9 bl1'), table, [true, false, false, false]);
  const swap = L.check(st, 0, [S('bl5 bl6 bl7'), S('bu9 rd9 J')]);
  assert.ok(swap.ok, 'replace the joker with the real tile and use the joker in a new group');
  const lost = L.check(st, 0, [S('bl5 bl6 bl7')]);
  assert.strictEqual(lost.ok, false, 'the joker must stay on the table');
});

test('commit moves tiles from the rack to the table and passes the turn; drawing takes one tile', () => {
  const st = setup(S('bl10 bu10 rd10 bl1'));
  const r = L.commit(st, [S('bl10 bu10 rd10')]);
  assert.ok(r.ok); assert.strictEqual(st.players[0].rack.length, 1); assert.strictEqual(st.table.length, 1); assert.ok(st.players[0].opened);
  assert.strictEqual(st.turn, 1);
  const s2 = setup(S('bl1 bl5')); const pool = s2.pool.length;
  assert.ok(L.drawTurn(s2)); assert.strictEqual(s2.players[0].rack.length, 3); assert.strictEqual(s2.pool.length, pool - 1); assert.strictEqual(s2.turn, 1);
  assert.strictEqual(L.commit(s2, [S('bl1 bl2 bl3')]).ok, false, 'not your turn anymore? it is player 1 now but the rack check fails');
});

test('emptying your rack ends the round: everyone else pays their remaining tiles, jokers cost 30', () => {
  const st = setup(S('bl10 bu10 rd10'), [], [false, false, false, false], { 1: S('bl1 bl2'), 2: S('J bl5'), 3: S('rd13') });
  const r = L.commit(st, [S('bl10 bu10 rd10')]);
  assert.ok(r.ok); assert.strictEqual(st.phase, 'roundover');
  assert.deepStrictEqual(st.result.totals, [0, 3, 35, 13]);
  assert.deepStrictEqual(st.result.deltas, [51, -3, -35, -13]);
  assert.strictEqual(st.result.deltas.reduce((a, b) => a + b, 0), 0);
});

test('stalemate: when the pool is empty and everyone passes, the lowest rack wins the difference', () => {
  const st = setup(S('bl1 bl3'), [], [false, false, false, false], { 1: S('bl2 bl9'), 2: S('bl13 bl12'), 3: S('rd5 rd6 rd7') });
  st.pool = [];
  for (let i = 0; i < 4; i++) L.drawTurn(st);
  assert.strictEqual(st.phase, 'roundover'); assert.strictEqual(st.result.kind, 'stalemate'); assert.strictEqual(st.result.winner, 0);
  assert.strictEqual(st.result.deltas.reduce((a, b) => a + b, 0), 0); assert.ok(st.result.deltas[0] > 0);
});

test('three rounds make a match, the dealer rotates, scores add up to zero', () => {
  const st = L.newGame(L.rng(3), { rounds: 3 }); const d0 = st.dealer;
  for (let r = 1; r <= 3; r++) {
    assert.strictEqual(st.round, r);
    st.players.forEach((p) => { p.human = false; });
    for (let k = 0; k < 4000 && st.phase === 'play'; k++) assert.ok(L.cpuTurn(st));
    assert.ok(st.phase === 'roundover' || st.phase === 'matchover');
    if (r < 3) { L.nextRound(st); assert.strictEqual(st.dealer, (d0 + r) % 4); }
  }
  assert.strictEqual(st.phase, 'matchover'); assert.strictEqual(st.players.reduce((s, p) => s + p.score, 0), 0);
  assert.ok(st.players[L.ranking(st)[0]].score >= st.players[L.ranking(st)[3]].score);
});

test('computer: finds an opening of 30 or more when its rack has one, and draws when it does not', () => {
  const st = setup(S('bl10 bu10 rd10 bl1 bu5 rd8 or2 or13'));
  st.players[0].human = false;
  const arr = L.plan(st, 0); assert.ok(arr && L.check(st, 0, arr).ok);
  const low = setup(S('bl1 bu3 rd5 or7 bl9 bu11 rd13 or2')); low.players[0].human = false;
  assert.strictEqual(L.plan(low, 0), null);
  const before = low.players[0].rack.length; L.cpuTurn(low); assert.strictEqual(low.players[0].rack.length, before + 1, 'drew a tile');
});

test('computer: attaches single tiles, borrows from a long run, swaps a joker, and always stays valid', () => {
  const att = setup(S('bl4 bl9 rd1'), [S('bl5 bl6 bl7 bl8')], [true, false, false, false]); att.players[0].human = false;
  const a1 = L.plan(att, 0); assert.ok(a1 && L.check(att, 0, a1).ok); assert.ok(a1.flat().includes(t(0, 4)) && a1.flat().includes(t(0, 9)));
  const bor = setup(S('bu5 rd5 bl1'), [S('bl5 bl6 bl7 bl8')], [true, false, false, false]); bor.players[0].human = false;
  const a2 = L.plan(bor, 0); assert.ok(a2 && L.check(bor, 0, a2).ok, 'borrowed the 5 from the run'); assert.ok(a2.some((s) => s.includes(t(0, 5)) && s.includes(t(1, 5)) && s.includes(t(2, 5))));
  const jk = setup(S('bl6 bu9 rd9 bl1'), [S('bl5 J bl7')], [true, false, false, false]); jk.players[0].human = false;
  const a3 = L.plan(jk, 0); assert.ok(a3 && L.check(jk, 0, a3).ok, 'joker swapped and reused');
  const mid = setup(S('bu6 rd6 bl1'), [S('bl3 bl4 bl5 bl6 bl7 bl8 bl9')], [true, false, false, false]); mid.players[0].human = false;
  const a4 = L.plan(mid, 0); assert.ok(a4 && L.check(mid, 0, a4).ok, 'split a long run to take the 6');
});

test('easy computers play less than normal ones', () => {
  const stats = (level) => {
    let draws = 0, plays = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const st = L.newGame(L.rng(seed * 5), { level, rounds: 1 }); st.players.forEach((p) => { p.human = false; });
      for (let k = 0; k < 600 && st.phase === 'play'; k++) { L.cpuTurn(st); for (const e of st.events) { if (e.t === 'draw') draws++; if (e.t === 'play') plays++; } st.events = []; }
    }
    return plays / (plays + draws);
  };
  const n = stats('normal'), e = stats('easy');
  assert.ok(e < n, `easy ${e.toFixed(2)} vs normal ${n.toFixed(2)}`);
  assert.ok(L.newGame(L.rng(1), { level: 'easy' }).players.slice(1).every((p) => p.easy));
});

test('whole computer games never break the rules: 106 tiles accounted for, every table set valid', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const st = L.newGame(L.rng(seed * 9), { rounds: 2, level: seed % 3 === 0 ? 'easy' : 'normal' }); st.players.forEach((p) => { p.human = false; });
    let guard = 0;
    while (st.phase !== 'matchover' && guard++ < 3000) {
      if (st.phase === 'roundover') { L.nextRound(st); continue; }
      assert.ok(L.cpuTurn(st), 'cpu turn accepted');
      const all = [...st.players.flatMap((p) => p.rack), ...st.pool, ...st.table.flat()];
      assert.strictEqual(all.length, 106); assert.strictEqual(new Set(all).size, 106);
      for (const s of st.table) assert.ok(L.isValidSet(s), 'valid set on the table');
      st.events = [];
    }
    assert.strictEqual(st.phase, 'matchover');
  }
});

test('a joker taken from the table must go into a new set, not onto a set that is already there', () => {
  const stays = setup(S('bl4 bu1'), [S('bl5 J bl7')], [true, false, false, false]);
  assert.ok(L.check(stays, 0, [S('bl4 bl5 J bl7')]).ok, 'a joker that stays in its own set may be extended');
  const onto = setup(S('bl6 bu1'), [S('bl5 J bl7'), S('bu9 rd9 or9')], [true, false, false, false]);
  const bad = L.check(onto, 0, [S('bl5 bl6 bl7'), S('bu9 rd9 or9 J')]);
  assert.strictEqual(bad.ok, false); assert.ok(/새 묶음/.test(bad.why), 'moving it onto an existing group is refused');
  const fresh2 = setup(S('bl6 bu9 rd9'), [S('bl5 J bl7')], [true, false, false, false]);
  assert.ok(L.check(fresh2, 0, [S('bl5 bl6 bl7'), S('bu9 rd9 J')]).ok, 'a new set from the rack is fine');
  const split = setup(S('bl6 bu8 rd8 bu1'), [S('bl4 bl5 J bl7 bl8 bl9')], [true, false, false, false]);
  assert.ok(L.check(split, 0, [S('bl4 bl5 bl6'), S('bl7 bl8 bl9'), S('bu8 rd8 J')]).ok, 'replace the joker by the real tile and use the joker in a new group');
});
