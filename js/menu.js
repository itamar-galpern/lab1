// Retro pixel main menu: PLAY (vs the computer or a friend), RULES (a paged flight manual with live
// board diagrams) and CREDITS. Keyboard (arrows, Enter, Esc), mouse and touch drive the same cursor.

import { SIDES, PIECES, BLACK_HOLES, WORMHOLES, sq, sqName } from './rules.js';
import { LEVELS } from './ai.js';
import { fromFEN, legalMoves, pieceAt } from './engine.js';

// The names in the credits. Add your lab partner here.
const CREW = ['ITAMAR GALPERN'];

const $ = s => document.querySelector(s);
const ORDER = ['K', 'Q', 'R', 'B', 'N', 'P'];
const up = s => s.toUpperCase();
const hole = n => up(sqName(BLACK_HOLES[n]));
const [WA, WB] = WORMHOLES[0];

// ---------- rule diagrams, drawn from real engine positions ----------

const DIAGRAMS = {
  start: { fen: 'rnbkqbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1' },
  holes: { fen: 'k7/8/3B4/8/8/8/8/7K w - - 0 1', from: 'd6' },
  warp: { fen: 'k7/8/8/8/8/1B6/8/7K w - - 0 1', from: 'b3', arc: true },
  orbit: { fen: '7k/8/8/8/R7/8/8/7K w - - 0 1', from: 'a4', wrapArrow: 4 },
  rocket: { fen: 'k7/8/8/8/3N4/8/8/7K w - - 0 1', from: 'd4' },
};

function drawDiagram(canvas, key, portraits) {
  const spec = DIAGRAMS[key];
  const g = canvas.getContext('2d');
  const W = canvas.width, s = W / 8;
  const state = fromFEN(spec.fen);
  const from = spec.from ? sq(spec.from) : -1;
  const moves = from >= 0 ? legalMoves(state).filter(m => m.from === from) : [];
  g.clearRect(0, 0, W, W);
  for (let i = 0; i < 64; i++) {
    const x = (i % 8) * s, y = (i >> 3) * s;
    g.fillStyle = ((i % 8) + (i >> 3)) % 2 ? '#1c3f72' : '#f3e1bd';
    g.fillRect(x, y, s, s);
    if (BLACK_HOLES.includes(i)) {
      const gr = g.createRadialGradient(x + s / 2, y + s / 2, 0, x + s / 2, y + s / 2, s / 2);
      gr.addColorStop(0, '#000'); gr.addColorStop(0.42, '#000'); gr.addColorStop(0.6, '#b07cff'); gr.addColorStop(0.75, '#3a1a6a'); gr.addColorStop(1, '#0b0820');
      g.fillStyle = gr;
      g.fillRect(x, y, s, s);
    }
    if (i === WA || i === WB) {
      g.strokeStyle = '#b07cff';
      g.lineWidth = s * 0.09;
      g.beginPath(); g.arc(x + s / 2, y + s / 2, s * 0.38, 0, Math.PI * 2); g.stroke();
    }
  }
  if (from >= 0) {
    g.fillStyle = 'rgba(127,246,255,0.5)';
    g.fillRect((from % 8) * s, (from >> 3) * s, s, s);
  }
  // Ships.
  for (let i = 0; i < 64; i++) {
    const p = pieceAt(state, i);
    if (!p) continue;
    const img = portraits?.[p.side]?.[p.type];
    const x = (i % 8) * s, y = (i >> 3) * s;
    if (img && img.complete) g.drawImage(img, x - s * 0.1, y - s * 0.22, s * 1.2, s * 1.2);
    else {
      g.fillStyle = SIDES[p.side].color;
      g.font = `${Math.round(s * 0.55)}px "Press Start 2P"`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(p.type, x + s / 2, y + s / 2);
    }
  }
  // Where the selected ship can go.
  for (const m of moves) {
    const x = (m.to % 8) * s + s / 2, y = (m.to >> 3) * s + s / 2;
    g.fillStyle = m.kind === 'warp' ? '#c69bff' : '#4ff0ff';
    g.strokeStyle = '#0b2a33';
    g.lineWidth = 3;
    g.beginPath(); g.arc(x, y, s * (m.kind === 'warp' ? 0.2 : 0.14), 0, Math.PI * 2); g.fill(); g.stroke();
  }
  if (spec.arc) {
    const a = [(WA % 8) * s + s / 2, (WA >> 3) * s + s / 2], b = [(WB % 8) * s + s / 2, (WB >> 3) * s + s / 2];
    g.strokeStyle = '#c69bff';
    g.setLineDash([s * 0.18, s * 0.12]);
    g.lineWidth = 4;
    g.beginPath(); g.moveTo(...a); g.quadraticCurveTo(W * 0.62, W * 0.62, ...b); g.stroke();
    g.setLineDash([]);
  }
  if (spec.wrapArrow !== undefined) {
    // Leave through the left edge, come back in on the right.
    const y = spec.wrapArrow * s + s / 2;
    g.strokeStyle = '#4ff0ff';
    g.lineWidth = 4;
    g.setLineDash([s * 0.16, s * 0.1]);
    g.beginPath(); g.moveTo(s * 0.3, y); g.lineTo(2, y); g.stroke();
    g.beginPath(); g.moveTo(W - 2, y); g.lineTo(W - s * 0.55, y); g.stroke();
    g.setLineDash([]);
    g.fillStyle = '#4ff0ff';
    g.beginPath(); g.moveTo(W - s * 0.55, y); g.lineTo(W - s * 0.3, y - s * 0.16); g.lineTo(W - s * 0.3, y + s * 0.16); g.fill();
  }
}

// ---------- the rulebook ----------

const RULE_PAGES = [
  {
    title: 'MISSION',
    diagram: 'start',
    html: () => `<p>Two fleets meet in deep space. The <b class="solar">SOLAR FLEET</b> (gold) launches first, then the
      <b class="nebula">NEBULA FLEET</b> (teal) answers. Turns alternate, one ship per turn.</p>
      <p><b>CHECKMATE</b> the enemy <b>COMMANDER</b>: attack it so it has no escape. You may never leave your own Commander under attack.</p>
      <p>The ships move like chess pieces, but space is strange: <b>black holes</b>, a <b>wormhole</b> and an <b>orbit</b> with no edges.</p>`,
  },
  {
    title: 'THE FLEET',
    fleet: true,
  },
  {
    title: 'BLACK HOLES',
    diagram: 'holes',
    html: () => `<p>Two squares, <b>${hole(0)}</b> and <b>${hole(1)}</b>, have collapsed into black holes.</p>
      <p>Nothing can land on a black hole, and no ship can fly <b>through</b> one. They block the Comet here on both diagonals.</p>
      <p>Only a <b>Rocket</b> can leap over them, like it leaps over everything.</p>`,
  },
  {
    title: 'WORMHOLE',
    diagram: 'warp',
    html: () => `<p>A wormhole joins <b>${up(sqName(WA))}</b> and <b>${up(sqName(WB))}</b>.</p>
      <p>Any ship except an Astronaut that sits on one end can <b class="violet">WARP</b> to the other end as its move, even capturing an enemy waiting there.</p>
      <p>Careful: a ship on one end also <b>attacks</b> the other end.</p>`,
  },
  {
    title: 'ORBIT',
    diagram: 'orbit',
    html: () => `<p>The board is a ring in orbit. The <b>left and right edges are joined</b>.</p>
      <p>A ship that flies off the A-file comes back in on the H-file, and the other way around. Every ship can do it, even Astronauts capturing.</p>
      <p>This Station reaches <b>H4</b> and <b>G4</b> by flying left. Docking (castling) never crosses the edge.</p>`,
  },
  {
    title: 'ROCKET BOOST',
    diagram: 'rocket',
    html: () => `<p>Rockets jump in an <b>L</b> (2 squares then 1), like a chess knight.</p>
      <p>They also have a <b>BOOST</b>: a jump of exactly 2 squares diagonally.</p>
      <p>Rockets leap over ships and black holes, so nothing can block them.</p>`,
  },
  {
    title: 'FLIGHT MANUAL',
    html: () => `<ul>
      <li><b>DOCKING</b> (castling): Commander and Station swap past each other if neither has moved, the way is clear and the Commander is not attacked.</li>
      <li><b>ASTRONAUTS</b> float one square forward (two on their first move) and capture one square diagonally forward. En passant works too.</li>
      <li><b>PROMOTION</b>: an Astronaut reaching the far side becomes a Flagship, Station, Comet or Rocket.</li>
      <li><b>DRAWS</b>: stalemate, 50 moves with no capture or Astronaut move, the same position three times, or too few ships to win.</li>
      <li><b>CONTROLS</b>: click a ship, then a glowing square. Drag to orbit the camera, scroll or pinch to zoom.</li>
    </ul>`,
  },
];

// ---------- the menu ----------

export function initMenu({ portraits, onLaunch, sfx }) {
  let settings = { side: 0, level: 'captain' };
  try { settings = { ...settings, ...JSON.parse(localStorage.getItem('spacechess.settings') || '{}') }; } catch {}
  if (!LEVELS.some(l => l.id === settings.level)) settings.level = 'captain';
  const save = () => { try { localStorage.setItem('spacechess.settings', JSON.stringify(settings)); } catch {} };

  const imgs = [0, 1].map(side => Object.fromEntries(ORDER.map(t => {
    const im = new Image();
    im.src = portraits[side][t];
    return [t, im];
  })));

  const tabs = [...document.querySelectorAll('[data-tab]')];
  const page = $('#page');
  const st = { tab: 'play', sub: null, focus: 'nav', cursor: 0, rule: 0, visible: false };

  // ----- page renderers: each returns the number of selectable items -----

  function renderPlay() {
    page.innerHTML = `<h2 class="px-head">START NEW GAME</h2>
      <button class="item" data-i="0"><span class="big">1 PLAYER</span><small>VS THE COMPUTER</small></button>
      <button class="item" data-i="1"><span class="big">2 PLAYERS</span><small>SAME SCREEN</small></button>`;
    return 2;
  }

  function renderSetup() {
    const lv = LEVELS.find(l => l.id === settings.level);
    const side = SIDES[settings.side];
    page.innerHTML = `<h2 class="px-head">VS COMPUTER</h2>
      <div class="item opt" data-i="0"><span class="lbl">FLEET</span>
        <button class="arrow" data-d="-1" aria-label="Previous fleet"><i class="tri left small"></i></button>
        <span class="val" style="color:${side.color}">${up(side.name)}</span>
        <button class="arrow" data-d="1" aria-label="Next fleet"><i class="tri right small"></i></button></div>
      <p class="note">${settings.side === 0 ? 'GOLD · YOU LAUNCH FIRST' : 'TEAL · THE COMPUTER LAUNCHES FIRST'}</p>
      <div class="item opt" data-i="1"><span class="lbl">LEVEL</span>
        <button class="arrow" data-d="-1" aria-label="Easier"><i class="tri left small"></i></button>
        <span class="val">${up(lv.name)}</span>
        <button class="arrow" data-d="1" aria-label="Harder"><i class="tri right small"></i></button></div>
      <p class="note">${'★'.repeat(LEVELS.indexOf(lv) + 1)}${'☆'.repeat(LEVELS.length - LEVELS.indexOf(lv) - 1)} ${up(lv.blurb || '')}</p>
      <button class="item launch" data-i="2"><span class="big">LAUNCH</span></button>`;
    return 3;
  }

  function renderRules() {
    const p = RULE_PAGES[st.rule];
    const head = `<h2 class="px-head">${p.title}<span class="dim">${st.rule + 1}/${RULE_PAGES.length}</span></h2>`;
    if (p.fleet) {
      page.innerHTML = head + `<div class="fleet-grid">${ORDER.map(t => `
        <div class="ship"><img src="${portraits[0][t]}" alt=""><img src="${portraits[1][t]}" alt="">
          <div><b>${up(PIECES[t].name)}</b> <span class="dim">${PIECES[t].classic}</span><p>${PIECES[t].move}</p></div></div>`).join('')}</div>`;
    } else {
      page.innerHTML = head + `<div class="rule${p.diagram ? '' : ' wide'}"><div class="rule-text">${p.html()}</div>
        ${p.diagram ? '<canvas class="diagram" width="320" height="320"></canvas>' : ''}</div>`;
      const cv = page.querySelector('canvas');
      if (cv) {
        const draw = () => drawDiagram(cv, p.diagram, imgs);
        draw();
        Promise.all(imgs.flatMap(o => Object.values(o)).map(im => im.decode?.().catch(() => {}))).then(() => { if (cv.isConnected) draw(); });
      }
    }
    page.insertAdjacentHTML('beforeend', `<div class="pager">
      <button class="pill cream small" data-page="-1" ${st.rule ? '' : 'disabled'}>PREV</button>
      <button class="pill green small" data-page="1" ${st.rule < RULE_PAGES.length - 1 ? '' : 'disabled'}>NEXT</button></div>`);
    return 0;
  }

  function renderCredits() {
    const rows = [
      ['CREATED BY', CREW.join('<br>')],
      ['CODE PILOT', 'CLAUDE CODE'],
      ['3D ENGINE', 'THREE.JS'],
      ['FONTS', 'PRESS START 2P · VT323'],
      ['MISSION', 'AGENTIC AI · LAB 1'],
    ];
    page.innerHTML = `<h2 class="px-head">CREDITS</h2><dl class="credits">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
      <p class="note center">THANKS FOR PLAYING</p>`;
    return 0;
  }

  let count = 0;
  function render() {
    tabs.forEach(b => {
      b.classList.toggle('active', b.dataset.tab === st.tab);
      b.classList.toggle('focus', st.focus === 'nav' && b.dataset.tab === st.tab);
    });
    if (st.tab === 'play') count = st.sub === 'setup' ? renderSetup() : renderPlay();
    else if (st.tab === 'rules') count = renderRules();
    else count = renderCredits();
    st.cursor = Math.min(st.cursor, Math.max(0, count - 1));
    page.querySelectorAll('.item').forEach(el => el.classList.toggle('focus', st.focus === 'page' && +el.dataset.i === st.cursor));
    page.classList.toggle('active', st.focus === 'page');
  }

  // ----- actions -----

  function setTab(tab, focusPage = false) {
    if (tab !== st.tab) { st.tab = tab; st.sub = null; st.cursor = 0; st.rule = 0; }
    st.focus = focusPage && (tab !== 'credits') ? 'page' : 'nav';
    render();
  }

  function activate() {
    if (st.focus === 'nav') {
      sfx.play('select');
      if (st.tab === 'credits') return;
      st.focus = 'page';
      st.cursor = 0;
      return render();
    }
    if (st.tab === 'rules') return turnPage(1);
    if (st.tab !== 'play') return;
    if (!st.sub) {
      sfx.play('select');
      if (st.cursor === 0) { st.sub = 'setup'; st.cursor = 2; return render(); }
      return onLaunch({ players: 2 });
    }
    if (st.cursor < 2) return change(1);
    sfx.play('select');
    save();
    onLaunch({ players: 1, side: settings.side, level: settings.level });
  }

  function change(d) {
    if (st.tab !== 'play' || st.sub !== 'setup' || st.cursor > 1) return false;
    if (st.cursor === 0) settings.side = 1 - settings.side;
    else {
      const k = LEVELS.findIndex(l => l.id === settings.level);
      settings.level = LEVELS[(k + d + LEVELS.length) % LEVELS.length].id;
    }
    save();
    sfx.play('nav');
    render();
    return true;
  }

  function turnPage(d) {
    const next = st.rule + d;
    if (next < 0 || next >= RULE_PAGES.length) return;
    st.rule = next;
    sfx.play('nav');
    render();
  }

  function back() {
    sfx.play('back');
    if (st.focus === 'page' && st.sub) { st.sub = null; st.cursor = 0; }
    else st.focus = 'nav';
    render();
  }

  function moveCursor(d) {
    if (st.focus === 'nav') {
      const k = tabs.findIndex(b => b.dataset.tab === st.tab);
      st.tab = tabs[(k + d + tabs.length) % tabs.length].dataset.tab;
      st.sub = null; st.cursor = 0; st.rule = 0;
    } else if (count) st.cursor = (st.cursor + d + count) % count;
    sfx.play('nav');
    render();
  }

  function horizontal(d) {
    if (st.focus === 'nav') { if (d > 0) activate(); return; }
    if (st.tab === 'rules') return turnPage(d);
    if (change(d)) return;
    if (d < 0) back();
  }

  // ----- input -----

  addEventListener('keydown', e => {
    if (!st.visible || !$('#overlay').classList.contains('hidden')) return;
    const k = e.key;
    if (k === 'ArrowUp' || k === 'w') moveCursor(-1);
    else if (k === 'ArrowDown' || k === 's') moveCursor(1);
    else if (k === 'ArrowLeft' || k === 'a') horizontal(-1);
    else if (k === 'ArrowRight' || k === 'd') horizontal(1);
    else if (k === 'Enter' || k === ' ') activate();
    else if (k === 'Escape' || k === 'Backspace') back();
    else return;
    e.preventDefault();
  });

  tabs.forEach(b => b.addEventListener('click', () => { sfx.play('select'); setTab(b.dataset.tab, true); }));
  page.addEventListener('click', e => {
    const pager = e.target.closest('[data-page]');
    if (pager) return turnPage(+pager.dataset.page);
    const item = e.target.closest('.item');
    if (!item) return;
    st.focus = 'page';
    st.cursor = +item.dataset.i;
    const arrow = e.target.closest('.arrow');
    if (arrow) return change(+arrow.dataset.d);
    if (item.classList.contains('opt')) return change(1);
    activate();
  });
  page.addEventListener('pointermove', e => {
    const item = e.target.closest('.item');
    if (!item || st.focus !== 'page' || +item.dataset.i === st.cursor) return;
    st.cursor = +item.dataset.i;
    page.querySelectorAll('.item').forEach(el => el.classList.toggle('focus', +el.dataset.i === st.cursor));
  });
  $('#sel-prev').onclick = () => horizontal(-1);
  $('#sel-next').onclick = () => horizontal(1);
  $('#sel-go').onclick = activate;

  return {
    show() {
      st.visible = true;
      st.focus = 'nav';
      st.sub = null;
      $('#menu').classList.remove('hidden');
      render();
    },
    hide() {
      st.visible = false;
      $('#menu').classList.add('hidden');
    },
  };
}
