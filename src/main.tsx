import { render } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import './ui/styles.css';
import { t, LANGS } from './i18n';
import { SOURCES, MissionId } from './engine/catalog';
import { SNAPSHOT } from './data/snapshot';
import { NASA } from './data/nasa';
import { loadLive } from './net/live';
import { app, screen, chooseLang, toggleSound, openModal, quit, derived, notify, startSolo, drawCrew } from './ui/store';
import { useApp, Seg, Icon, Btn, cx, eonetTargets } from './ui/common';
import { Home, CrewDraft, Lobby, Missions, Chat, browseMission } from './ui/screens';
import { Guided, guidedView } from './ui/guided';
import { Review, Sim, Report, currentEntry } from './ui/flight';
import { createScene, Scene3D } from './ui/scene';
import { decodeDesign } from './engine/codec';
import { fmtDate } from './i18n';

const STEPS = ['crew', 'missions', 'studio', 'review', 'sim', 'report'];
let scene: Scene3D | null = null;
let browsing: MissionId = browseMission;

function syncScene() {
  if (!scene) return;
  const s = screen(), g = app.g, d = g.design, inGame = ['studio', 'review', 'sim', 'report'].includes(s);
  const mission = s === 'missions' ? browsing : d.mission;
  const mk = eonetTargets(mission === 'leo' && inGame ? d : { ...d, mission: 'leo', objective: 'hot' }).main;
  let phase, lander = false, lost = false;
  if (s === 'sim') { const { r, e, i } = currentEntry(); phase = e?.phase; lander = r.m.orbit.kind === 'lander'; lost = r.lost && i >= r.timeline.length - 1; }
  scene.design(inGame ? d : null);
  scene.set({ guided: s === 'studio', view: s, mission, phase, lander, lost, show: s === 'studio' ? guidedView() : s === 'sim' && phase === 'launch' ? 'rocket' : 'craft', marker: mission === 'leo' ? { lat: mk.lat, lon: mk.lon } : null });
}

function Credits() {
  return <div class="modal" role="dialog" aria-modal="true" aria-label={t('cr.title')} onClick={e => { if (e.target === e.currentTarget) openModal(null); }}>
    <div class="panel col">
      <div class="row"><h2 class="h-m">{t('cr.title')}</h2><span style="flex:1" /><button type="button" class="iconbtn" aria-label={t('nav.close')} onClick={() => openModal(null)}><Icon n="x" /></button></div>
      <p class="mut">{t('cr.data', { date: fmtDate(SNAPSHOT.date) })}</p><p class="mut">{t('cr.nasa', { date: fmtDate(NASA.date) })}</p><p class="mut">{t('cr.model')}</p><p class="mut">{t('cr.assets')}</p>
      <ul class="clean">{SOURCES.map(s => <li><a href={s.url} target="_blank" rel="noreferrer">{s.label}</a></li>)}</ul>
      <p class="dim small">{t('cr.team')}</p>
    </div>
  </div>;
}

function App() {
  useApp();
  const s = screen(), ref = useRef<HTMLDivElement>(null);
  useEffect(() => { syncScene(); });
  useEffect(() => { ref.current?.scrollTo(0, 0); scene?.scroll(0); }, [s]);
  const stepIx = STEPS.indexOf(s === 'lobby' ? 'crew' : s);
  if (s === 'studio') { const k = app.g.design.mission + ':' + app.g.design.difficulty; if (app.stepFor !== k) { app.stepFor = k; app.step = 0; } }
  return <>
    <header class="top">
      <button type="button" class="brand" onClick={quit} title={t('nav.home')}>{t('app.name')} <small>{t('app.sub')}</small></button>
      {s !== 'home' && <ol class="steps" aria-label="progress">{STEPS.map((k, i) => <li class={cx(i === stepIx && 'on', i < stepIx && 'done')} aria-current={i === stepIx ? 'step' : undefined}>{t('step.' + k)}</li>)}</ol>}
      <div class="right">
        <Seg id="lang" label={t('nav.lang')} value={app.lang} onChange={chooseLang} options={LANGS.map(v => ({ v, label: v.toUpperCase() }))} />
        <button type="button" class="iconbtn" id="sound" aria-label={t('nav.sound')} aria-pressed={app.sound} onClick={toggleSound}><Icon n={app.sound ? 'sound' : 'mute'} /></button>
        <button type="button" class="iconbtn" id="credits" aria-label={t('nav.credits')} title={t('nav.credits')} onClick={() => openModal('credits')}><Icon n="info" /></button>
      </div>
    </header>
    <main class="screen" ref={ref} key={s} onScroll={e => scene?.scroll(innerWidth <= 900 ? (e.currentTarget as HTMLElement).scrollTop : 0)}>
      {s === 'home' ? <Home /> : s === 'crew' ? <CrewDraft /> : s === 'lobby' ? <Lobby /> : s === 'missions' ? <Missions onBrowse={m => { browsing = m; syncScene(); }} />
        : s === 'studio' ? <Guided scene={scene} /> : s === 'review' ? <Review /> : s === 'sim' ? <Sim scene={scene} /> : <Report />}
    </main>
    {app.mode === 'team' && app.net === 'on' && !['home', 'crew', 'lobby'].includes(s) && <details class="chatfab panel" style="padding:10px 14px"><summary class="row" style="cursor:pointer"><Icon n="chat" /> {t('lobby.chat')} · {app.code}</summary><Chat /></details>}
    {app.modal === 'credits' && <Credits />}
    {app.toast && <div class="toast" role="status">{app.toast}</div>}
  </>;
}

function start() {
  const root = document.getElementById('app')!, canvas = document.getElementById('stage') as HTMLCanvasElement;
  scene = createScene(canvas);
  if (!scene.ok) { canvas.hidden = true; document.body.classList.add('nogl'); }
  let dragging: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', e => { dragging = { x: e.clientX, y: e.clientY }; });
  addEventListener('pointermove', e => { if (dragging && screen() === 'missions') { scene?.rotate(e.clientX - dragging.x, 0); dragging = { x: e.clientX, y: e.clientY }; } });
  addEventListener('pointerup', () => { dragging = null; });
  render(<App />, root);
  loadLive(notify);
  const open = () => { const code = (location.hash || '').slice(1); if (code && decodeDesign(code) && screen() === 'home') { if (!app.crew) drawCrew(); startSolo(code); } };
  open(); addEventListener('hashchange', open);
  (window as any).__sa = { app, derived, notify, scene };
}
start();
