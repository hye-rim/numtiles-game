'use strict';
// 오락실 튜토리얼이 '진짜로 일어난 일'을 알아채는 신호 (튜토리얼이 아니면 아무도 안 듣는다)
const tutorialSignal = (type) => window.dispatchEvent(new CustomEvent('arcade:tutorial', { detail: { type } }));

// 숫자 타일 게임: 화면·입력·소리. 규칙과 컴퓨터는 logic.js (LOGIC_NUMTILES).
// 내 차례에는 '작업 중인 탁자'(W)에서 타일을 자유롭게 옮기고, 「끝내기」를 누를 때 규칙이 맞는지 검사해서 낸다.
const L = LOGIC_NUMTILES;
const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};

// ---------- 소리 ----------
let audio = null;
let muted = store.get('numtilesMuted') === '1';
function tone(freq, dur, type = 'square', vol = 0.045, slide = 0) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audio.destination);
    o.start(t); o.stop(t + dur);
  } catch (_) {}
}
const melody = (notes, step, type = 'sine', vol = 0.06) => notes.forEach((f, i) => { if (f) setTimeout(() => tone(f, step * 0.9 / 1000, type, vol), i * step); });
const sfx = {
  pick: () => tone(660, 0.03, 'triangle', 0.03),
  move: () => tone(440, 0.05, 'triangle', 0.04),
  play: () => melody([523, 659, 784], 60, 'triangle', 0.05),
  draw: () => tone(330, 0.07, 'square', 0.03),
  bad: () => tone(150, 0.14, 'square', 0.05),
  cpu: () => melody([392, 494], 70, 'triangle', 0.04),
  win: () => melody([523, 659, 784, 1047], 90),
  lose: () => melody([330, 262, 196], 160, 'sawtooth', 0.04),
  start: () => melody([392, 494, 587], 90),
};

// ---------- 상태 ----------
let G = L.newGame();
let state = 'title';                           // title · play · paused
let W = null;                                  // 내 차례에 작업 중인 탁자와 내 타일
const sel = new Set();
let sortBy = 'color', msg = '', msgErr = false, cpuT = 0, pausedFrom = null, labels = ['', '', '', ''], flash = new Set(), flashT = 0, badSets = new Set();
let best = Number(store.get('numtilesBest')) || 0;

/* @test-hooks:start */
window.__nt = { get G() { return G; }, get W() { return W; }, get state() { return state; }, L, setG(g) { G = g; }, step: (dt) => update(dt), render: () => render() };
/* @test-hooks:end */

const myTurn = () => state === 'play' && G.phase === 'play' && G.turn === 0;
const canon = (sets) => sets.map((s) => s.slice().sort((a, b) => a - b).join(',')).sort().join('|');
const changed = () => !!W && (W.origin.size > 0 || canon(W.table) !== canon(G.table));
function beginWork() { W = { table: G.table.map((s) => s.slice()), rack: G.players[0].rack.slice(), origin: new Set() }; sel.clear(); badSets.clear(); }

// ---------- 흐름 ----------
function bindOverlay() { document.querySelectorAll('#overlay button').forEach((b) => { b.onclick = () => (b.dataset.act === 'next' ? nextRound() : onOverlayButton(b.dataset.level)); }); }
function nextRound() { hideOverlay(); L.nextRound(G); G.events = []; labels = ['', '', '', '']; beginWork(); say(G.turn === 0 ? '내 차례' : ''); render(); }
function showOverlay(html) { const o = $('overlay'); o.innerHTML = html; o.classList.remove('hidden'); bindOverlay(); }
function hideOverlay() { $('overlay').classList.add('hidden'); }
function onOverlayButton(level) { if (state === 'paused') resume(); else startGame(level); }
function say(t, err = false) { msg = t; msgErr = err; }
function startGame(level) {
  const tut = /[?&]tutorial=1/.test(location.search);
  if (tut) level = 'easy';
  level = level || store.get('numtilesLevel');
  level = level === 'normal' ? 'normal' : 'easy';
  store.set('numtilesLevel', level);
  G = L.newGame(Math.random, { level });
  if (tut) rigTutorial();
  G.events = [];
  labels = ['', '', '', '']; flash.clear(); cpuT = 0; state = 'play'; hideOverlay(); sfx.start();
  beginWork();
  say(G.turn === 0 ? '내 차례: 타일을 골라 묶음을 만들어요' : `${G.players[G.turn].name} 먼저 시작해요`);
  render();
}
// 튜토리얼: 처음부터 내 차례에 합이 30 이 넘는 묶음(10 세 장)을 만들 수 있게 한다
function rigTutorial() {
  const want = [9, 35, 61];                                              // 검정 10 · 파랑 10 · 빨강 10
  const me = G.players[0];
  for (const w of want) {
    if (me.rack.includes(w)) continue;
    const spare = me.rack.find((c) => !want.includes(c) && !L.isJoker(c));
    const holder = G.players.find((p, i) => i > 0 && p.rack.includes(w));
    if (holder) { holder.rack[holder.rack.indexOf(w)] = spare; me.rack[me.rack.indexOf(spare)] = w; }
    else if (G.pool.includes(w)) { G.pool[G.pool.indexOf(w)] = spare; me.rack[me.rack.indexOf(spare)] = w; }
  }
  me.rack.sort((a, b) => a - b);
  G.turn = 0; G.events = [];
}
function pause() { if (state !== 'play') return; pausedFrom = state; state = 'paused'; showOverlay('<h2>일시정지</h2><p>P 키나 아래 버튼으로 계속해요</p><button id="startBtn">계속하기</button>'); }
function resume() { if (state !== 'paused') return; state = pausedFrom; hideOverlay(); }

function handleEvents() {
  const evs = G.events; G.events = [];
  for (const e of evs) {
    if (e.t === 'play') {
      labels[e.who] = `${e.count}장 냈어요${e.first ? ' (처음 내기)' : ''}`;
      if (e.who !== 0) { flash = new Set(e.tiles); flashT = 1.4; sfx.cpu(); say(`${G.players[e.who].name}가 ${e.count}장을 냈어요`); } else { sfx.play(); tutorialSignal('commit'); }
    } else if (e.t === 'draw') { labels[e.who] = '타일을 뽑았어요'; if (e.who !== 0) say(`${G.players[e.who].name}가 타일을 뽑았어요`); else tutorialSignal('draw'); sfx.draw(); }
    else if (e.t === 'pass') { labels[e.who] = '넘김'; }
    else if (e.t === 'turn') { if (e.who === 0 && G.phase === 'play') { beginWork(); say(G.players[0].opened ? '내 차례: 탁자를 다시 짜서 타일을 더 낼 수 있어요' : '내 차례: 합이 30 이상인 묶음을 만들어 처음 내요'); } }
    else if (e.t === 'roundend') showEnd();
  }
}
function showEnd() {
  const r = G.result, final = G.phase === 'matchover', won = r.winner === 0;
  if (r.deltas[0] > 0) sfx.win(); else if (r.deltas[0] < 0) sfx.lose();
  const rows = G.players.map((p, i) => `<tr><td>${esc(p.name)}</td><td>${r.totals[i]}점 남음</td><td style="color:${r.deltas[i] >= 0 ? '#9ae8a8' : '#ff9a9a'}">${r.deltas[i] >= 0 ? '+' : ''}${r.deltas[i]}</td><td>${p.score}</td></tr>`).join('');
  const title = r.kind === 'stalemate' ? (r.winner >= 0 ? `타일이 바닥나서 ${esc(G.players[r.winner].name)} 승` : '타일이 바닥나서 무승부') : `${esc(G.players[r.winner].name)}가 타일을 모두 냈어요!`;
  let extra = '';
  if (final && G.difficulty === 'normal' && G.players[0].score > best) { best = G.players[0].score; store.set('numtilesBest', String(best)); extra = '<p>🏆 최고 기록!</p>'; }
  const buttons = final ? '<div class="lv"><button id="startBtn" data-level="easy">쉬움으로 다시<small>컴퓨터가 서툴러요</small></button><button id="startBtn2" data-level="normal">보통으로 다시<small>컴퓨터가 능숙해요</small></button></div>' : '<div class="lv"><button id="startBtn" data-act="next">다음 판</button></div>';
  setTimeout(() => showOverlay(`<h2>${won ? '🏆 내가 이겼어요!' : '한 판 끝'}</h2><p class="big">${title}</p><table style="font-size:12px;border-spacing:8px 2px"><tr style="opacity:.6"><td></td><td>손</td><td>이번</td><td>합계</td></tr>${rows}</table>${extra}${buttons}${final ? '<p class="note">쉬움에서는 최고 기록이 저장되지 않아요</p>' : ''}`), 900);
}

// ---------- 화면 ----------
const tileHtml = (id, extra = '') => {
  const cls = L.isJoker(id) ? 'tile joker' : `tile c${L.colorOf(id)}`;
  return `<div class="${cls}${sel.has(id) ? ' sel' : ''}${W && W.origin.has(id) && myTurn() ? ' fresh' : ''}${flash.has(id) ? ' pulse' : ''}${extra}" data-id="${id}">${L.isJoker(id) ? '☺' : L.numOf(id)}</div>`;
};
const orderedSet = (s) => { const a = L.arrangeSet(s); return a ? a.order : s.slice().sort((x, y) => L.numOf(x) - L.numOf(y) || L.colorOf(x) - L.colorOf(y)); };
function render() {
  if (state === 'title') { $('opps').innerHTML = ''; $('table').innerHTML = ''; $('rack').innerHTML = ''; $('msg').textContent = ''; ['btnNew', 'btnBack', 'btnUndo', 'btnHint', 'btnDraw', 'btnDone'].forEach((id) => { $(id).disabled = true; }); return; }
  const mine = myTurn();
  $('opps').innerHTML = G.players.slice(1).map((p, k) => { const i = k + 1; return `<div class="opp${G.turn === i && G.phase === 'play' ? ' turn' : ''}">${esc(p.name)}${p.easy ? '' : ''}<small>🔢 ${p.rack.length}장${p.opened ? ' ✓' : ''}</small><small>${esc(labels[i] || '')}</small></div>`; }).join('');
  const sets = mine && W ? W.table : G.table;
  const rack = mine && W ? W.rack : G.players[0].rack;
  $('table').innerHTML = sets.length ? sets.map((s, i) => `<div class="set${mine && !L.isValidSet(s) ? ' bad' : ''}${badSets.has(i) ? ' bad' : ''}" data-set="${i}">${orderedSet(s).map((id) => tileHtml(id)).join('')}${mine ? `<button class="add" data-add="${i}" title="고른 타일을 여기에 붙이기">＋</button>` : ''}</div>`).join('') : '<div style="opacity:.55;font-size:13px;padding:8px">탁자가 비어 있어요. 타일을 골라 「새 묶음」을 만들어 봐요</div>';
  const r2 = rack.slice();
  if (sortBy === 'color') r2.sort((a, b) => (L.isJoker(a) ? 9 : L.colorOf(a)) - (L.isJoker(b) ? 9 : L.colorOf(b)) || L.numOf(a) - L.numOf(b)); else r2.sort((a, b) => (L.isJoker(a) ? 99 : L.numOf(a)) - (L.isJoker(b) ? 99 : L.numOf(b)) || L.colorOf(a) - L.colorOf(b));
  $('rack').innerHTML = r2.map((id) => tileHtml(id)).join('');
  // 처음 내기 안내
  let m = msg;
  if (mine && W && !G.players[0].opened && W.origin.size) {
    let pts = 0; for (const s of W.table) if (s.length && s.every((id) => W.origin.has(id)) && L.isValidSet(s)) pts += L.arrangeSet(s).points;
    m = `처음 내기: 새로 낸 묶음의 합 ${pts} / ${L.OPEN_MIN}`;
  } else if (!mine && state === 'play' && G.phase === 'play' && !flashT) m = `${G.players[G.turn].name} 차례…`;
  $('msg').textContent = m; $('msg').className = msgErr ? 'err' : '';
  const hasSel = sel.size > 0, back = mine && W && [...sel].some((id) => W.origin.has(id) && W.table.some((s) => s.includes(id)));
  $('btnNew').disabled = !(mine && hasSel); $('btnBack').disabled = !back; $('btnUndo').disabled = !(mine && changed());
  $('btnHint').disabled = !mine; $('btnDraw').disabled = !(mine && !changed()); $('btnDone').disabled = !(mine && changed());
  $('btnDraw').innerHTML = G.pool.length ? `타일 뽑기<br><small>${G.pool.length}장 남음</small>` : '넘기기<br><small>더미 없음</small>';
  $('btnDone').classList.toggle('hidden', false);
}

// ---------- 타일 옮기기 ----------
function removeFromWork(id) {
  const ri = W.rack.indexOf(id);
  if (ri >= 0) { W.rack.splice(ri, 1); W.origin.add(id); return; }
  for (const s of W.table) { const i = s.indexOf(id); if (i >= 0) { s.splice(i, 1); return; } }
}
function moveSelected(target) {
  if (!myTurn() || !sel.size) return;
  const ids = [...sel];
  const targetSet = target === 'new' ? [] : W.table[target];
  for (const id of ids) removeFromWork(id);
  if (target === 'new') W.table.push(ids); else targetSet.push(...ids);
  W.table = W.table.filter((s) => s.length);
  sel.clear(); badSets.clear(); say(''); sfx.move(); render();
}
function backToRack() {
  if (!myTurn()) return;
  const ids = [...sel].filter((id) => W.origin.has(id) && W.table.some((s) => s.includes(id)));
  for (const id of ids) { for (const s of W.table) { const i = s.indexOf(id); if (i >= 0) s.splice(i, 1); } W.rack.push(id); W.origin.delete(id); }
  W.table = W.table.filter((s) => s.length); sel.clear(); badSets.clear(); sfx.move(); render();
}
function undoAll() { if (!myTurn()) return; beginWork(); say('처음 상태로 되돌렸어요'); render(); }
function done() {
  if (!myTurn() || !changed()) return;
  const arr = W.table.filter((s) => s.length);
  const r = L.commit(G, arr);
  if (!r.ok) {
    badSets.clear(); arr.forEach((s, i) => { if (!L.isValidSet(s)) badSets.add(i); });
    say(r.why, true); sfx.bad(); render(); return;
  }
  say(''); sel.clear(); handleEvents(); render();
}
function drawTile() {
  if (!myTurn()) return;
  if (changed()) { say('먼저 「모두 되돌리기」를 눌러야 뽑을 수 있어요', true); render(); return; }
  L.drawTurn(G); handleEvents(); render();
}
function hint() {
  if (!myTurn()) return;
  const arr = L.suggest(G, 0);
  if (!arr) { say('낼 수 있는 수를 못 찾았어요. 타일을 뽑아요', true); render(); return; }
  const onTable = new Set(G.table.flat());
  W.table = arr.map((s) => s.slice()); W.origin = new Set(arr.flat().filter((id) => !onTable.has(id)));
  const played = new Set(W.origin); W.rack = G.players[0].rack.filter((id) => !played.has(id));
  sel.clear(); badSets.clear(); say('추천 수를 놓아 봤어요. 마음에 들면 「끝내기」!'); render();
}

// ---------- 입력 ----------
$('wrap').addEventListener('click', (e) => {
  if (state !== 'play') return;
  const add = e.target.closest('[data-add]');
  if (add) { moveSelected(Number(add.dataset.add)); return; }
  const tile = e.target.closest('.tile');
  if (tile && myTurn()) { const id = Number(tile.dataset.id); if (sel.has(id)) sel.delete(id); else { sel.add(id); if (sel.size === 1) tutorialSignal('select'); } sfx.pick(); render(); }
});
$('btnNew').onclick = () => { if (sel.size) { moveSelected('new'); tutorialSignal('newset'); } };
$('btnBack').onclick = backToRack; $('btnUndo').onclick = undoAll; $('btnDone').onclick = done; $('btnDraw').onclick = drawTile; $('btnHint').onclick = hint;
$('btnSort').onclick = () => { sortBy = sortBy === 'color' ? 'number' : 'color'; render(); };
addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (state === 'title') { if (k === 'enter' || k === ' ') { e.preventDefault(); onOverlayButton(); } return; }
  if (state === 'paused') { if (k === 'p' || k === 'enter') resume(); return; }
  if (!$('overlay').classList.contains('hidden')) { if (k === 'enter') onOverlayButton(); return; }
  if (k === 'p') pause(); else if (k === 'm') toggleMute();
  else if (k === 'enter') done(); else if (k === 'd') drawTile(); else if (k === 'u') undoAll(); else if (k === 'n') $('btnNew').click();
});

// ---------- 매 프레임 ----------
function update(dt) {
  if (state !== 'play') return;
  if (flashT > 0) { flashT -= dt; if (flashT <= 0) { flash.clear(); render(); } }
  if (G.phase === 'play' && G.turn !== 0) {
    cpuT += dt;
    if (cpuT >= 1.2) { cpuT = 0; L.cpuTurn(G); handleEvents(); render(); }
  } else cpuT = 0;
}
let last = 0;
function frame(ts) { const dt = Math.min(0.1, (ts - (last || ts)) / 1000); last = ts; update(dt); requestAnimationFrame(frame); }
function toggleMute() { muted = !muted; store.set('numtilesMuted', muted ? '1' : '0'); $('muteBtn').textContent = muted ? '🔇' : '🔊'; }
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); };
$('pauseBtn').onclick = (e) => { e.currentTarget.blur(); state === 'paused' ? resume() : pause(); };
$('muteBtn').textContent = muted ? '🔇' : '🔊';
addEventListener('blur', pause);
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
bindOverlay();
render();
requestAnimationFrame(frame);
