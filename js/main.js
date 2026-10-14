// Space Chess app: boots the 3D scene and the menu, runs games (input, HUD, dialogs, clocks,
// cosmic events, hints, missions, trophies) and drives the AI.

import { SIDES, PIECES, sqName } from './rules.js';
import { Game } from './game.js';
import { LEVELS, chooseMove } from './ai.js';
import { serialize, kingSquare } from './engine.js';
import { initMenu } from './menu.js';
import { MISSIONS, mateMove, defend } from './missions.js';
import * as trophies from './achievements.js';
import * as sfx from './audio.js';

const $ = s => document.querySelector(s);
const up = s => s.toUpperCase();
const levelName = id => up(LEVELS.find(l => l.id === id)?.name || id);
const wraps = m => m.kind !== 'castle' && m.kind !== 'warp' && ((m.from % 8) + m.vx < 0 || (m.from % 8) + m.vx > 7);
const viaPortal = m => m.kind === 'warp' || m.transit >= 0;

let scene = null, portraits = null, menu = null;
let game = null;
let setup = null;         // how the current game was launched (see startGame)
let controllers = ['human', 'human']; // per side: 'human' or an AI level id
let viewSide = 0;
let selected = -1, targets = [];
let anim = null;          // promise of the move + cosmic event animations in flight
let thinking = false;
let session = 0;          // bumped on restart / undo / quit so stale async work drops out
let aiToken = 0;
let worker = null, reqId = 0;
const pending = new Map();
let clock = null;         // { ms: [solar, nebula], inc, last, lastSec } when playing with a clock
let timeResult = null;    // set when a clock runs out
let mission = null;       // the mission being played, with the player's move count
let lastReplay = null;    // the last move, for the checkmate replay
let hintTimer = 0;

const result = () => timeResult || game?.result || null;
const twoHumans = () => controllers.every(c => c === 'human');

// ---------- boot ----------

async function boot() {
  try {
    const mod = await import('./scene.js');
    scene = await mod.createScene($('#world'), { onSquareClick, onHover, onFx: name => sfx.play(name) });
    portraits = mod.renderPortraits(160);
  } catch (err) {
    console.error(err);
    $('#boot-err').textContent = 'COULD NOT START THE 3D ENGINE. ' + up(err.message || String(err));
    return;
  }
  menu = initMenu({ portraits, onLaunch: startGame, sfx });
  // The fleets stand ready behind the menu (this also compiles their shaders during loading).
  scene.setBoard(new Game().board());
  $('#boot').classList.add('done');
  setTimeout(() => $('#boot').remove(), 900);
  toMenu(false);
  addEventListener('pointerdown', sfx.unlock, { once: true });
  addEventListener('keydown', sfx.unlock, { once: true });
}

// ---------- screens ----------

function toMenu(fly = true, missions = false) {
  cancelAI();
  session++;
  game = null;
  clock = null;
  mission = null;
  selected = -1; targets = [];
  document.body.classList.add('in-menu');
  document.body.classList.remove('in-game');
  $('#hud').classList.add('hidden');
  $('#tip').classList.add('hidden');
  $('#replay').classList.remove('show');
  closeDialog();
  clearHint();
  scene.setHighlights({});
  scene.setInsets({});
  if (fly) {
    const g = new Game();
    scene.setFeatures(g.features);
    scene.setBoard(g.board());
    scene.setMode('menu');
  }
  menu.show({ missions });
}

// opts: { players: 1, side, level, cosmic, clock } | { players: 2, cosmic, clock } | { mission: id }
async function startGame(opts) {
  cancelAI();
  await anim;
  session++;
  setup = opts;
  timeResult = null;
  lastReplay = null;
  mission = null;
  clock = null;
  if (opts.mission) {
    const index = MISSIONS.findIndex(m => m.id === opts.mission);
    mission = { ...MISSIONS[index], index, moves: 0 };
    controllers = ['human', 'admiral'];
    viewSide = 0;
    game = new Game(mission.fen);
  } else {
    controllers = opts.players === 2 ? ['human', 'human'] : opts.side === 0 ? ['human', opts.level] : [opts.level, 'human'];
    viewSide = opts.players === 2 ? 0 : opts.side;
    game = new Game(undefined, { cosmic: !!opts.cosmic });
    clock = makeClock(opts.clock);
  }
  selected = -1; targets = [];
  closeDialog();
  clearHint();
  menu.hide();
  document.body.classList.remove('in-menu');
  document.body.classList.add('in-game');
  $('#hud').classList.remove('hidden');
  scene.setFeatures(game.features);
  scene.setBoard(game.board());
  paint();
  renderHud();
  layoutInsets();
  const sess = session;
  await scene.setMode('game', viewSide);
  if (sess !== session) return;
  if (clock) clock.last = performance.now();
  if (mission) return briefing();
  toast(opts.players === 2 ? 'ENGAGE!' : `${up(SIDES[viewSide].fleet)} · ENGAGE!`, SIDES[viewSide].color);
  maybeAI();
}

function briefing() {
  const d = dialog(`MISSION ${mission.index + 1}`, mission.title);
  d.insertAdjacentHTML('beforeend', `<p class="dlg-brief">${mission.brief}</p>
    <p class="note center">CHECKMATE IN ${mission.mateIn} · YOU COMMAND THE <span style="color:${SIDES[0].color}">SOLAR FLEET</span></p>`);
  d.append(actions([['MISSIONS', 'cream', () => toMenu(true, true)], ['LAUNCH', 'green', () => { closeDialog(); toast('ENGAGE!', SIDES[0].color); }]]));
}

function layoutInsets() {
  const panel = $('#hud-panel');
  if (!panel || $('#hud').classList.contains('hidden')) return scene.setInsets({});
  const r = panel.getBoundingClientRect();
  if (innerWidth > 820) scene.setInsets({ right: r.width + 24 });
  else scene.setInsets({ bottom: innerHeight - r.top + 8 });
}
addEventListener('resize', () => { if (game) layoutInsets(); });

// The current space layout: black holes, meteor craters (with turns left) and wormhole links.
function layout() {
  const f = game ? game.features : { holes: [], meteors: [], wormholes: [] };
  const twin = new Map();
  for (const w of f.wormholes) { twin.set(w.a, { to: w.b, ttl: w.ttl }); twin.set(w.b, { to: w.a, ttl: w.ttl }); }
  return { holes: new Set(f.holes), meteors: new Map(f.meteors.map(m => [m.sq, m.ttl])), twin };
}

// ---------- board input ----------

const isHumanTurn = () => game && !result() && controllers[game.turn] === 'human';

function onSquareClick(i) {
  if (!isHumanTurn() || anim || thinking || !$('#overlay').classList.contains('hidden')) return;
  const options = targets.filter(m => m.to === i);
  if (options.length) {
    if (options.length > 1) choosePromotion(options);
    else doMove(options[0]);
    return;
  }
  const p = game.pieceAt(i);
  if (p && p.side === game.turn && i !== selected) {
    selected = i;
    targets = game.movesFrom(i);
    sfx.play('pick');
  } else {
    selected = -1;
    targets = [];
  }
  paint();
}

function paint() {
  if (!game) return scene.setHighlights({});
  const lm = game.lastMove;
  scene.setHighlights({
    selected,
    targets: targets.map(m => ({ to: m.to, cap: !!m.cap, warp: viaPortal(m) })),
    last: lm ? { from: lm.from, to: lm.transit >= 0 ? lm.transit : lm.to } : null,
    check: !result() && game.inCheck() ? kingSquare(game.state, game.turn) : -1,
  });
}

function onHover(i, x, y) {
  const tip = $('#tip');
  let text = '';
  if (i >= 0 && game) {
    const p = game.pieceAt(i), L = layout(), name = up(sqName(i)), w = L.twin.get(i);
    const turns = n => `${n} MORE TURN${n === 1 ? '' : 'S'}`;
    if (L.holes.has(i)) text = `<b class="amber">BLACK HOLE</b> ${name}<br>NOTHING CAN LAND ON IT OR FLY THROUGH IT. ONLY ROCKETS LEAP OVER.`;
    else if (L.meteors.has(i)) text = `<b class="amber">METEOR CRATER</b> ${name}<br>BLOCKED LIKE A BLACK HOLE FOR ${turns(L.meteors.get(i))}.`;
    else if (p) {
      text = `<b style="color:${SIDES[p.side].color}">${up(SIDES[p.side].name)} ${up(PIECES[p.type].name)}</b> ${name}`;
      if (w) text += p.type === 'P'
        ? `<br><span class="violet">ON A WORMHOLE · ASTRONAUTS CAN'T WARP</span>`
        : `<br><span class="violet">PARKED ON A WORMHOLE · CAN WARP TO ${up(sqName(w.to))}</span>`;
    } else if (w) {
      const to = up(sqName(w.to));
      text = `<b class="violet">WORMHOLE</b> ${name} ↔ ${to}<br>ANY SHIP EXCEPT AN ASTRONAUT THAT LANDS HERE IS FLUNG OUT AT ${to}, IF IT'S FREE.`;
      if (w.ttl != null) text += `<br><span class="violet">CLOSES IN ${turns(w.ttl)}.</span>`;
    }
  }
  if (!text) return tip.classList.add('hidden');
  tip.innerHTML = text;
  tip.classList.remove('hidden');
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = Math.min(innerWidth - w - 8, x + 16) + 'px';
  tip.style.top = Math.min(innerHeight - h - 8, y + 18) + 'px';
}

// ---------- moves ----------

const EVENT_TITLES = {
  drift: ['BLACK HOLE DRIFT!', '#ffa555'],
  'wormhole-open': ['WORMHOLE OPENS!', '#c69bff'],
  'wormhole-close': ['WORMHOLE CLOSES', '#c69bff'],
  meteor: ['METEOR SHOWER!', '#ffa555'],
  'meteor-clear': ['CRATERS CLEARED', '#f3e3c3'],
};

async function doMove(mv) {
  const sess = session, mover = game.turn;
  const before = game.board();
  selected = -1; targets = [];
  clearHint();
  const rec = game.play(mv);
  if (clock) clock.ms[mover] += clock.inc;
  scene.setHighlights({});
  if (mv.kind !== 'warp') sfx.play(mv.piece === 'N' ? 'jump' : 'move');
  renderHud();
  anim = (async () => {
    await scene.animateMove(mv, game.board());
    for (const e of rec.events || []) {
      if (sess !== session) return;
      const [title, color] = EVENT_TITLES[e.type] || ['COSMIC EVENT', '#c69bff'];
      toast(title, color);
      sfx.play('event');
      await scene.playEvents([e]);
    }
    if (sess === session && rec.events?.length) scene.setFeatures(game.features);
  })();
  await anim;
  anim = null;
  if (sess !== session) return;
  lastReplay = { mv, before, after: game.board(), side: mover };
  paint();
  renderHud();
  announce(rec, mv);
  checkTrophies(rec, mover);
  if (mission && controllers[mover] === 'human') mission.moves++;
  if (result()) return endGame();
  if (mission && controllers[mover] === 'human' && mission.moves >= mission.mateIn) return missionFailed();
  // Two humans on one screen: swing the camera round to the fleet that moves next.
  if (twoHumans()) scene.resetView(game.turn, { keepZoom: true, ms: 1100 });
  maybeAI();
}

function announce(rec, mv) {
  const fromX = mv.from % 8;
  const L = layout();
  if (rec.mate || game.result?.reason === 'checkmate') toast('CHECKMATE!', '#ff6b5b');
  else if (rec.check) { toast('CHECK!', '#ff6b5b'); sfx.play('check'); }
  else if (mv.promo) toast(`PROMOTED · ${up(PIECES[mv.promo].name)}`, '#ffd34d');
  else if (viaPortal(mv)) toast('WARP!', '#c69bff');
  else if (mv.kind !== 'castle' && (fromX + mv.vx < 0 || fromX + mv.vx > 7)) toast('ORBIT WRAP!', '#4ff0ff');
  else if (mv.kind === 'castle') toast('DOCKED!', '#ffd34d');
  else if (L.twin.has(mv.to)) toast(mv.piece === 'P' ? "ASTRONAUTS CAN'T WARP" : 'EXIT BLOCKED · WARP NEXT TURN', '#c69bff');
}

function choosePromotion(options) {
  const side = game.turn;
  const d = dialog('PROMOTION', 'YOUR ASTRONAUT BECOMES A...');
  const row = document.createElement('div');
  row.className = 'promo';
  for (const mv of options) {
    const b = document.createElement('button');
    b.className = 'promo-btn';
    b.innerHTML = `<img src="${portraits[side][mv.promo]}" alt=""><span>${up(PIECES[mv.promo].name)}</span>`;
    b.onclick = () => { closeDialog(); doMove(mv); };
    row.append(b);
  }
  d.append(row);
  d.append(actions([['CANCEL', 'red', closeDialog]]));
}

// ---------- AI and hints ----------

function getWorker() {
  if (worker === null) {
    try {
      worker = new Worker(new URL('./ai-worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }) => { const cb = pending.get(data.id); pending.delete(data.id); cb?.(data.move); };
      worker.onerror = e => {
        console.warn('AI worker failed, thinking on the main thread instead', e);
        worker = false;
        for (const [, cb] of pending) cb(null);
        pending.clear();
      };
    } catch {
      worker = false;
    }
  }
  return worker;
}

// Asks the engine for a move at `level`, off the main thread when possible.
function think(level) {
  const sess = session, state = game.state;
  return new Promise(resolve => {
    const w = getWorker();
    if (!w) return setTimeout(() => resolve(chooseMove(state, level)), 30);
    const id = ++reqId;
    pending.set(id, resolve);
    w.postMessage({ id, state: serialize(state), level });
  }).then(mv => mv || (sess === session && game && !worker ? chooseMove(game.state, level) : mv));
}

function maybeAI() {
  if (!game || result()) return;
  const level = controllers[game.turn];
  if (level === 'human') return;
  thinking = true;
  renderHud();
  const token = ++aiToken, sess = session, started = performance.now();
  // In a mission the computer plays the defence that holds out longest (an exact search).
  const ask = mission ? Promise.resolve(defend(game.state, mission.mateIn - mission.moves + 1)) : think(level);
  ask.then(mv => {
    if (token !== aiToken || sess !== session) return;
    const wait = Math.max(0, 700 - (performance.now() - started));
    setTimeout(() => {
      if (token !== aiToken || sess !== session || result()) return;
      thinking = false;
      const legal = game.moves();
      const pick = legal.find(m => m.from === mv?.from && m.to === mv?.to && (m.promo || null) === (mv?.promo || null)) || legal[0];
      if (pick) doMove(pick);
    }, wait);
  });
}

function cancelAI() {
  aiToken++;
  thinking = false;
}

async function hint() {
  if (!isHumanTurn() || anim || thinking) return;
  const sess = session, side = game.turn, btn = $('#btn-hint');
  btn.disabled = true;
  btn.textContent = 'THINKING';
  // Missions know the exact winning line; everywhere else the Admiral suggests a move.
  const mv = mission ? mateMove(game.state, mission.mateIn - mission.moves) : await think('admiral');
  btn.disabled = false;
  btn.textContent = 'HINT';
  if (sess !== session || !game || game.turn !== side || !mv) return;
  const full = game.moves().find(m => m.from === mv.from && m.to === mv.to && (m.promo || null) === (mv.promo || null));
  if (!full) return;
  clearHint();
  scene.setHint(full);
  sfx.play('hint');
  toast('TRY THIS!', '#5fd068');
  if (mission) info(`<b>HINT:</b> ${mission.hint}`);
  hintTimer = setTimeout(clearHint, 8000);
}

function clearHint() {
  clearTimeout(hintTimer);
  scene?.setHint(null);
}

// ---------- clocks ----------

function makeClock(spec) {
  if (!spec || spec === 'off') return null;
  const [min, inc] = spec.split('+').map(Number);
  return { ms: [min * 60000, min * 60000], inc: inc * 1000, last: performance.now(), lastSec: -1 };
}

const fmt = ms => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

setInterval(() => {
  if (!clock || !game) return;
  const t = performance.now(), dt = t - clock.last;
  clock.last = t;
  // The clock stops while ships are flying, while a dialog is open and once the game is over.
  if (result() || anim || !$('#overlay').classList.contains('hidden')) return;
  const side = game.turn;
  clock.ms[side] = Math.max(0, clock.ms[side] - dt);
  const sec = Math.ceil(clock.ms[side] / 1000);
  if (clock.ms[side] <= 10000 && controllers[side] === 'human' && sec !== clock.lastSec) { clock.lastSec = sec; sfx.play('tick'); }
  if (clock.ms[side] <= 0) return flag(side);
  renderClocks();
}, 100);

function renderClocks() {
  if (!clock) return;
  document.querySelectorAll('.clock').forEach(el => {
    const side = +el.dataset.side;
    el.textContent = fmt(clock.ms[side]);
    el.classList.toggle('low', clock.ms[side] <= 10000);
    el.classList.toggle('run', !result() && game.turn === side);
  });
}

function flag(side) {
  cancelAI();
  timeResult = { winner: side ^ 1, reason: 'on time' };
  selected = -1; targets = [];
  sfx.play('alarm');
  toast('TIME UP!', '#ff6b5b');
  paint();
  renderHud();
  endGame();
}

// ---------- trophies ----------

const trophyQueue = [];
let trophyShowing = false;

function award(id) {
  const t = trophies.unlock(id);
  if (!t) return;
  trophyQueue.push(t);
  if (!trophyShowing) nextTrophy();
}

function nextTrophy() {
  const t = trophyQueue.shift();
  const el = $('#trophy');
  if (!t) { trophyShowing = false; el.classList.remove('show'); return; }
  trophyShowing = true;
  el.innerHTML = `<i>${t.icon}</i><div><small>TROPHY UNLOCKED</small><b>${t.name}</b></div>`;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  sfx.play('trophy');
  setTimeout(nextTrophy, 3200);
}

function checkTrophies(rec, mover) {
  if (controllers[mover] !== 'human') return;
  const m = rec.move;
  if (viaPortal(m)) award('first-warp');
  if (m.cap && wraps(m)) award('orbit');
  if (m.cap && m.piece === 'N' && Math.abs(m.vx) === 2 && Math.abs(m.vy) === 2) award('boost');
  if (m.promo) award('promote');
  if (rec.mate && viaPortal(m)) award('mate-warp');
  if (rec.mate && wraps(m)) award('mate-orbit');
}

// ---------- game over ----------

async function endGame() {
  const r = result(), sess = session;
  cancelAI();
  renderHud();
  if (r.reason === 'checkmate' && lastReplay) {
    $('#replay').classList.add('show');
    await scene.replay(lastReplay.mv, lastReplay.before, lastReplay.after, lastReplay.side);
    $('#replay').classList.remove('show');
    if (sess !== session) return;
    paint();
  }
  if (mission) return r.winner === 0 && r.reason === 'checkmate' ? missionComplete() : missionFailed();

  const vsAI = controllers.includes('human') && controllers.some(c => c !== 'human');
  const humanWon = r.winner !== null && controllers[r.winner] === 'human';
  let title, color;
  if (r.winner === null) { title = 'DRAW'; color = '#f3e3c3'; sfx.play('draw'); }
  else if (vsAI) { title = humanWon ? 'VICTORY!' : 'DEFEAT'; color = humanWon ? '#5fd068' : '#ff6b5b'; sfx.play(humanWon ? 'win' : 'lose'); }
  else { title = `${up(SIDES[r.winner].name)} WINS!`; color = SIDES[r.winner].color; sfx.play('win'); }
  scene.celebrate(r.winner);
  if (humanWon) {
    if (vsAI) award('beat-' + controllers[r.winner ^ 1]);
    if (game.cosmic) award('cosmic');
    if (clock) award('blitz');
  }
  setTimeout(() => {
    if (sess !== session) return;
    const who = r.winner === null ? 'NO FLEET PREVAILS' : `THE ${up(SIDES[r.winner].fleet)} WINS ${r.reason === 'on time' ? 'ON TIME' : 'BY ' + up(r.reason)}`;
    const d = dialog(title, r.winner === null ? up(r.reason) : who, color);
    const n = Math.ceil(game.log.length / 2);
    d.insertAdjacentHTML('beforeend', `<p class="note center">${n} MOVE${n === 1 ? '' : 'S'}</p>`);
    d.append(actions([
      ['VIEW BOARD', 'cream', closeDialog],
      ['MENU', 'red', () => toMenu()],
      ['PLAY AGAIN', 'green', () => startGame(setup)],
    ]));
  }, 900);
}

function missionComplete() {
  const sess = session;
  const done = trophies.markMission(mission.id);
  award('first-mission');
  if (MISSIONS.every(m => done.has(m.id))) award('all-missions');
  sfx.play('win');
  scene.celebrate(0);
  const next = MISSIONS[mission.index + 1];
  setTimeout(() => {
    if (sess !== session) return;
    const d = dialog('MISSION COMPLETE!', mission.title, '#5fd068');
    d.insertAdjacentHTML('beforeend', `<p class="note center">${done.size}/${MISSIONS.length} MISSIONS DONE</p>`);
    const list = [['MISSIONS', 'cream', () => toMenu(true, true)]];
    if (next) list.push(['NEXT MISSION', 'green', () => startGame({ mission: next.id })]);
    d.append(actions(list));
  }, 900);
}

function missionFailed() {
  cancelAI();
  const sess = session;
  sfx.play('lose');
  setTimeout(() => {
    if (sess !== session) return;
    const r = result();
    const why = r && r.winner === 1 ? 'THE NEBULA FLEET TURNED THE TABLES' : r ? up(r.reason) : `NO CHECKMATE IN ${mission.mateIn} MOVE${mission.mateIn === 1 ? '' : 'S'}`;
    const d = dialog('MISSION FAILED', why, '#ff6b5b');
    d.insertAdjacentHTML('beforeend', `<p class="dlg-brief"><b>HINT:</b> ${mission.hint}</p>`);
    d.append(actions([['MISSIONS', 'cream', () => toMenu(true, true)], ['RETRY', 'green', () => startGame(setup)]]));
  }, 700);
}

// ---------- HUD ----------

function info(html) {
  const el = $('#info');
  el.innerHTML = html || '';
  el.classList.toggle('hidden', !html);
}

function renderHud() {
  if (!game) return;
  const r = result();
  const banner = $('#banner');
  const turn = game.turn, fleet = SIDES[turn];
  if (r) {
    banner.innerHTML = r.winner === null
      ? `DRAW · ${up(r.reason)}`
      : `<span style="color:${SIDES[r.winner].color}">${up(SIDES[r.winner].fleet)}</span> WINS · ${up(r.reason)}`;
  } else if (thinking) {
    banner.innerHTML = `<span style="color:${fleet.color}">${up(fleet.fleet)}</span> IS THINKING<i class="dots"></i>`;
  } else {
    const who = twoHumans() ? `<span style="color:${fleet.color}">${up(fleet.fleet)}</span> TO MOVE` : `<span style="color:${fleet.color}">YOUR MOVE</span>`;
    banner.innerHTML = who + (game.inCheck() ? ' · <span class="alert">CHECK!</span>' : '');
  }
  banner.classList.toggle('alert-pulse', !r && game.inCheck());

  const material = side => game.captured[side].reduce((s, t) => s + PIECES[t].value, 0);
  $('#fleets').innerHTML = SIDES.map((s, side) => {
    const ctrl = controllers[side] === 'human' ? (twoHumans() ? 'HUMAN' : 'YOU') : `CPU · ${levelName(controllers[side])}`;
    const lead = Math.round((material(side) - material(1 - side)) / 100);
    const caps = [...game.captured[side]].sort((a, b) => PIECES[b].value - PIECES[a].value)
      .map(t => `<img src="${portraits[1 - side][t]}" alt="${PIECES[t].name}" title="${PIECES[t].name}">`).join('');
    const active = !r && turn === side;
    return `<div class="fleet${active ? ' active' : ''}" style="--fc:${s.color}">
      <div class="fleet-head"><i class="sw"></i><b>${up(s.name)}</b><span class="ctrl">${ctrl}${active && thinking ? '<i class="dots"></i>' : ''}</span></div>
      <div class="caps">${caps || '<span class="dim">NO CAPTURES YET</span>'}${lead > 0 ? `<span class="lead">+${lead}</span>` : ''}
        ${clock ? `<span class="clock" data-side="${side}"></span>` : ''}</div>
    </div>`;
  }).join('');
  renderClocks();

  if (mission) info(`<b>MISSION ${mission.index + 1}:</b> ${mission.title}<br>CHECKMATE IN ${mission.mateIn} · MOVE ${Math.min(mission.moves + 1, mission.mateIn)} OF ${mission.mateIn}`);
  else if (game.cosmic && game.nextEvent != null && !r) {
    const n = game.nextEvent;
    info(`<b class="violet">☄ COSMIC EVENT</b> IN ${n} TURN${n === 1 ? '' : 'S'}`);
  } else info('');

  const log = $('#log');
  log.innerHTML = game.log.map((e, k) =>
    `<li><span class="n">${k % 2 === 0 ? (k / 2 + 1) + '.' : ''}</span><i class="sw" style="background:${SIDES[e.side].color}"></i>${e.text}</li>` +
    (e.events || []).map(ev => `<li class="ev"><span class="n"></span>☄ ${ev.text}</li>`).join('')).join('');
  log.scrollTop = log.scrollHeight;

  const humanMoved = game.log.some(e => controllers[e.side] === 'human');
  $('#btn-undo').disabled = !humanMoved || !!clock || !!mission;
  $('#btn-hint').disabled = !isHumanTurn() || thinking;
  $('#btn-sound').textContent = sfx.isEnabled() ? 'SOUND ON' : 'SOUND OFF';
}

let toastTimer = 0;
function toast(text, color = '#ffd34d') {
  const t = $('#toast');
  t.textContent = text;
  t.style.color = color;
  t.classList.remove('show');
  void t.offsetWidth; // restart the animation
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1700);
}

// ---------- dialogs ----------

function dialog(title, sub = '', color = '#ffd34d') {
  $('#overlay').classList.remove('hidden');
  const d = $('#dialog');
  d.innerHTML = `<h2 class="dlg-title" style="color:${color}">${title}</h2>${sub ? `<p class="dlg-sub">${sub}</p>` : ''}`;
  return d;
}

function actions(list) {
  const row = document.createElement('div');
  row.className = 'dlg-actions';
  for (const [label, color, fn] of list) {
    const b = document.createElement('button');
    b.className = `pill ${color}`;
    b.textContent = label;
    b.onclick = () => { sfx.play('select'); fn(); };
    row.append(b);
  }
  return row;
}

function closeDialog() { $('#overlay').classList.add('hidden'); }

// ---------- HUD buttons ----------

$('#btn-menu').onclick = () => {
  if (!game || result() || !game.log.length) return toMenu(true, !!mission);
  const d = dialog(mission ? 'ABORT MISSION?' : 'ABANDON GAME?', 'THIS GAME WILL BE LOST.', '#ff6b5b');
  d.append(actions([['STAY', 'cream', closeDialog], ['LEAVE', 'red', () => toMenu(true, !!mission)]]));
};

$('#btn-restart').onclick = () => {
  if (!game) return;
  if (result() || !game.log.length) return startGame(setup);
  const d = dialog('RESTART?', 'START THIS GAME OVER FROM THE BEGINNING.');
  d.append(actions([['NO', 'cream', closeDialog], ['RESTART', 'green', () => startGame(setup)]]));
};

$('#btn-hint').onclick = hint;

$('#btn-undo').onclick = async () => {
  if (!game || clock || mission) return;
  cancelAI();
  await anim;
  if (!game.log.some(e => controllers[e.side] === 'human')) return;
  session++;
  // Take back moves until it is a human's turn again, with at least one human move undone.
  let undoneHuman = false;
  while (game.canUndo && (!undoneHuman || controllers[game.turn] !== 'human')) {
    const last = game.log[game.log.length - 1];
    if (controllers[last.side] === 'human') undoneHuman = true;
    game.undo();
  }
  timeResult = null;
  selected = -1; targets = [];
  closeDialog();
  clearHint();
  scene.setFeatures(game.features);
  scene.setBoard(game.board());
  paint();
  renderHud();
  sfx.play('back');
  if (twoHumans()) scene.resetView(game.turn, { keepZoom: true });
  maybeAI();
};

$('#btn-view').onclick = () => {
  if (!game) return;
  scene.resetView(twoHumans() ? game.turn : viewSide);
  sfx.play('nav');
};

$('#btn-sound').onclick = () => {
  sfx.setEnabled(!sfx.isEnabled());
  sfx.play('select');
  renderHud();
};

$('#overlay').addEventListener('click', e => { if (e.target.id === 'overlay' && result() && !mission) closeDialog(); });

addEventListener('keydown', e => {
  if (!game || $('#hud').classList.contains('hidden')) return;
  if (e.key === 'Escape') {
    if (!$('#overlay').classList.contains('hidden')) { if (result()) closeDialog(); }
    else { selected = -1; targets = []; paint(); }
  } else if ((e.key === 'h' || e.key === 'H') && $('#overlay').classList.contains('hidden')) hint();
});

// Test hook for automated browser checks: open the page with ?debug.
if (new URLSearchParams(location.search).has('debug')) {
  window.spaceChess = {
    click: i => onSquareClick(i),
    square: i => scene.project(i),
    // Replace the current game's position (keeps the players): spaceChess.setup('FEN', { cosmic, seed }).
    setup(fen, opts) {
      cancelAI(); session++; timeResult = null;
      game = new Game(fen, opts); selected = -1; targets = [];
      scene.setFeatures(game.features); scene.setBoard(game.board()); paint(); renderHud(); maybeAI();
    },
    hint,
    get game() { return game; },
    get clock() { return clock; },
    get mission() { return mission; },
    get busy() { return !!anim || thinking; },
  };
}

boot();
