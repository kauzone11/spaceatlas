import { useEffect, useState } from 'preact/hooks';
import { t, fmt, fmtDate, getLang } from '../i18n';
import { MISSION, MISSIONS, MissionId, Difficulty, ROLES, Role } from '../engine/catalog';
import { evaluate, defaultDesign, lightTimeS, solarFlux } from '../engine/engine';
import { CREW_BY_ID, MENTOR } from '../data/crew';
import { PORTRAIT } from '../data/assets';
import { roomAvailable } from '../net/room';
import { app, act, drawCrew, goLocal, startSolo, enterRoom, randomCode, isHost, myRole, canEdit, unlocked, unlockAll, sendChat, derived, crewPerks, quit } from './store';
import { Btn, Seg, Chip, Icon, cx, crewName, eonetTargets, neoTarget, objKeyOf, NasaNow } from './common';
import { decodeDesign } from '../engine/codec';
import { sfx, startDrone } from './audio';

let pendingMode: 'solo' | 'team' = 'solo', pendingCode: string | undefined;

export function Home() {
  const [code, setCode] = useState(''); const [bad, setBad] = useState(false);
  const go = (mode: 'solo' | 'team', c?: string) => { pendingMode = mode; pendingCode = c; startDrone(); if (!app.crew) drawCrew(); goLocal('crew'); };
  return <div class="wrap"><div class="home enter">
    <div><h1 class="h-xl">{t('app.name')}</h1><div class="sub">{t('app.sub')}</div></div>
    <p class="lead" style="font-size:21px;color:var(--ink)">{t('app.tag')}</p>
    <p class="lead">{t('app.lead')}</p>
    <div class="row">
      <Btn big id="play-solo" sound="select" onClick={() => go('solo')}>{t('home.solo')}</Btn>
      <Btn big id="play-team" kind="ghost" sound="select" onClick={() => go('team')} title={t('home.teamsub')}>{t('home.team')}</Btn>
    </div>
    <div class="feats">{[1, 2, 3, 4].map(i => <div><b>{t(`home.f${i}`)}</b><span>{t(`home.f${i}d`)}</span></div>)}</div>
    <form class="row" onSubmit={e => { e.preventDefault(); if (decodeDesign(code)) go('solo', code); else setBad(true); }}>
      <label class="small mut" for="design-code">{t('home.code')}</label>
      <input id="design-code" type="text" value={code} placeholder={t('home.codeph')} onInput={e => { setCode((e.target as HTMLInputElement).value); setBad(false); }} style="width:210px" />
      <Btn kind="ghost" onClick={() => { if (decodeDesign(code)) go('solo', code); else setBad(true); }}>{t('home.load')}</Btn>
      {bad && <span class="small" style="color:var(--red)">{t('home.badcode')}</span>}
    </form>
    <p class="small dim">{t('home.event')}</p>
  </div></div>;
}

export function CrewDraft() {
  const [drawing, setDrawing] = useState(true);
  useEffect(() => { const id = setTimeout(() => { setDrawing(false); sfx.select(); }, 900); return () => clearTimeout(id); }, [app.crew]);
  const c = CREW_BY_ID[app.crew!], m = MENTOR[c.mentor], lang = getLang();
  const initials = c.name.split(' ').map(s => s[0]).join('');
  return <div class="wrap col enter crewwrap">
    <div><h1 class="h-l">{t('crew.title')}</h1><p class="lead">{t('crew.sub')}</p></div>
    {drawing ? <div class="panel crewcard drawing"><span class="h-m mut">{t('crew.draw')}</span></div> :
      <div class="panel crewcard" key={c.id}>
        <div class="who">
          <div class="row" style="gap:18px;flex-wrap:nowrap">
            <div class="avatar" style={`--h:${c.hue}`} aria-hidden="true">{initials}</div>
            <div style="min-width:0"><h2 class="h-l" id="crew-name" style="font-size:34px">{c.name}</h2>
              <p class="mut">{c.pronouns[lang]} · {c.age} · {c.from}</p></div>
          </div>
          <p class="spec">{t(`crew.${c.id}.spec`)}</p>
          <p class="small mut">{c.edu} · {t('crew.fict')}</p>
          <div class="stationbox">
            <p><span class="mut">{t('crew.station')}</span> <b>{t('role.' + c.role)}</b></p>
            <p class="small mut">{t(`role.${c.role}.d`)}</p>
            <p class="small"><span class="mut">{t('crew.perk')}</span> <b style="color:var(--cyan)">{t('perk.' + c.role)}</b></p>
          </div>
          {pendingMode === 'solo' && <p class="small dim">{t('crew.solo')}</p>}
        </div>
        <div class="insp">
          <div class="row" style="gap:14px;flex-wrap:nowrap">
            <img src={PORTRAIT[c.mentor]} alt={m.name} width="72" height="72" />
            <div style="min-width:0"><p>{t('crew.mentor')} <b id="crew-inspired">{m.name}</b></p><p class="small dim">{t('crew.mentorsub')} · {t('crew.photo')} {m.nasaId}</p></div>
          </div>
          <p class="link">{t(`crew.${c.id}.link`)}</p>
          <ul class="facts"><li>{t(`mentor.${c.mentor}.f1`)}</li><li>{t(`mentor.${c.mentor}.f2`)}</li></ul>
        </div>
      </div>}
    <div class="row">
      <Btn kind="ghost" onClick={() => goLocal('home')}>{t('nav.back')}</Btn>
      <Btn kind="ghost" id="reroll" disabled={app.rerolls < 1 || drawing} onClick={() => { app.rerolls--; setDrawing(true); drawCrew(); }}>{t('crew.reroll')}</Btn>
      {app.rerolls > 0 && <span class="small dim">{t('crew.rerollleft', { n: app.rerolls })}</span>}
      <span style="flex:1" />
      <Btn big id="crew-enter" disabled={drawing} sound="select" onClick={() => { if (pendingMode === 'solo') startSolo(pendingCode); else { app.mode = 'team'; app.net = 'off'; app.g.screen = 'lobby'; goLocal(null); } }}>{t('crew.enter')}</Btn>
    </div>
  </div>;
}

export function Chat() {
  const [tx, setTx] = useState('');
  return <div class="col" style="gap:8px">
    <div class="chatbox" aria-live="polite">{app.chat.map(m => <div><b style={m.mine ? 'color:var(--cyan)' : ''}>{m.mine ? t('lobby.you') : crewName(m.crew)}:</b> {m.text}</div>)}</div>
    <form class="row" style="flex-wrap:nowrap" onSubmit={e => { e.preventDefault(); sendChat(tx); setTx(''); }}>
      <input id="chat-input" type="text" value={tx} maxLength={200} placeholder={t('lobby.chat')} aria-label={t('lobby.chat')} onInput={e => setTx((e.target as HTMLInputElement).value)} style="flex:1" />
      <Btn kind="ghost" onClick={() => { sendChat(tx); setTx(''); }}>{t('lobby.send')}</Btn>
    </form>
  </div>;
}

export function Lobby() {
  const [avail, setAvail] = useState<boolean | null>(null); const [code, setCode] = useState('');
  useEffect(() => { roomAvailable().then(setAvail); }, []);
  const back = <Btn kind="ghost" onClick={quit}>{t('nav.back')}</Btn>;
  if (app.net === 'off' || app.net === 'unavailable') {
    const no = avail === false || app.net === 'unavailable';
    return <div class="wrap col enter" style="max-width:640px;padding-top:4vh">
      <h1 class="h-l">{t('lobby.title')}</h1>
      {no ? <div class="panel col"><h2 class="h-m">{t('lobby.unavail')}</h2><p class="mut">{t('lobby.unavaild')}</p><div class="row">{back}<Btn id="solo-instead" onClick={() => startSolo()}>{t('home.solo')}</Btn></div></div> :
        <div class="panel col">
          <Btn big id="room-create" disabled={avail === null} onClick={() => enterRoom(randomCode(), true)}>{t('lobby.create')}</Btn>
          <form class="row" onSubmit={e => { e.preventDefault(); if (code.trim().length >= 3) enterRoom(code.trim(), false); }}>
            <label for="room-code" class="mut">{t('lobby.join')}</label>
            <input id="room-code" type="text" value={code} maxLength={8} placeholder={t('lobby.joinph')} onInput={e => setCode((e.target as HTMLInputElement).value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase())} style="width:130px;font-family:var(--mono);letter-spacing:.1em" />
            <Btn kind="ghost" id="room-join" disabled={code.trim().length < 3 || avail === null} onClick={() => enterRoom(code.trim(), false)}>{t('lobby.joinbtn')}</Btn>
          </form>
          <div>{back}</div>
        </div>}
    </div>;
  }
  if (app.net === 'connecting') return <div class="wrap enter" style="padding-top:20vh;text-align:center"><p class="h-m mut">{t('lobby.connecting')}</p></div>;
  const mine = myRole(), sug = CREW_BY_ID[app.crew!].role;
  return <div class="wrap col enter" style="max-width:900px;padding-top:2vh">
    <div><p class="mut">{t('lobby.code')}</p><div class="code" id="room-code-show">{app.code}</div><p class="mut">{t('lobby.share')}</p></div>
    {app.net === 'lost' && <div class="panel"><p style="color:var(--orange)">{t('lobby.lost')}</p></div>}
    <div class="panel col">
      <div class="row"><h2 class="h-m">{t('lobby.seats')}</h2><Chip tone="info">{t('lobby.players', { n: app.peers.length })}</Chip></div>
      <div class="seats">{ROLES.map(r => { const s = app.g.seats[r], isMine = s?.peer === app.me;
        return <div class={cx('seat', isMine && 'mine')}>
          <b>{t('role.' + r)}</b><span class="small mut">{t(`role.${r}.d`)}</span>
          {s ? <Chip tone={isMine ? 'info' : 'mute'}>{isMine ? t('lobby.you') + ' · ' : ''}{crewName(s.crew)}</Chip> : <Chip>{t('lobby.bot')}</Chip>}
          {!s && <Btn kind={r === sug && !mine ? 'primary' : 'ghost'} id={'seat-' + r} onClick={() => act({ t: 'seat', role: r, crew: app.crew! })}>{t('lobby.take')}</Btn>}
        </div>; })}</div>
      <Chat />
    </div>
    <div class="row">
      <Btn kind="ghost" onClick={quit}>{t('lobby.leave')}</Btn><span style="flex:1" />
      {isHost() ? <Btn big id="lobby-start" sound="select" onClick={() => act({ t: 'nav', screen: 'missions' })}>{t('lobby.start')}</Btn> : <span class="mut">{t('lobby.wait')}</span>}
    </div>
  </div>;
}

export let browseMission: MissionId = 'leo';
export function Missions({ onBrowse }: { onBrowse: (m: MissionId) => void }) {
  const [sel, setSel] = useState<MissionId>(browseMission); const [diff, setDiff] = useState<Difficulty>(app.g.design.difficulty);
  useEffect(() => { browseMission = sel; onBrowse(sel); }, [sel]);
  const def = MISSION[sel], open = unlocked(sel), base = evaluate(defaultDesign(sel, diff), { crew: crewPerks() });
  const ev = eonetTargets(defaultDesign('leo', diff)).main, neo = neoTarget();
  const live = sel === 'leo' ? t('mis.leo.live', { event: ev.title, date: fmtDate(ev.date) }) : sel === 'moon' ? t('mis.moon.live')
    : sel === 'neo' ? t('mis.neo.live', { target: neo.des, min: neo.minSize, max: neo.maxSize, launch: fmtDate(neo.launch), dv: neo.dvArr * 1000 })
      : t('mis.mars.live', { flux: Math.round(solarFlux(def.sunAu)), au: def.earthAu, delay: lightTimeS(def.earthAu) / 60 });
  const host = app.mode === 'solo' || isHost();
  return <div class="wrap col enter">
    <div><h1 class="h-l">{t('mis.title')}</h1><p class="lead">{t('mis.sub')}</p></div>
    <div class="mgrid">
      <div class="mlist" role="tablist" aria-label={t('mis.title')}>{MISSIONS.map(m => { const best = app.progress.best[m];
        return <button type="button" role="tab" id={'mission-' + m} aria-selected={m === sel} class={cx('mitem', m === sel && 'on')} onClick={() => { sfx.whoosh(); setSel(m); }}>
          <span><b>{t(`mis.${m}.name`)}</b><span>{t(`mis.${m}.dest`, { target: neo.des })}</span></span>
          {!unlocked(m) ? <Icon n="lock" /> : best ? <Chip tone={best.verdict === 'full' ? 'ok' : best.verdict === 'min' ? 'warn' : 'fail'}>{t('rp.' + best.verdict)}</Chip> : null}
        </button>; })}</div>
      <div class="panel col" key={sel}>
        <div><h2 class="h-l" style="font-size:30px">{t(`mis.${sel}.name`)}</h2><p class="mut">{t(`mis.${sel}.dest`, { target: neo.des })}</p></div>
        <p class="mut">{t(`mis.${sel}.brief`)}</p>
        <ul class="clean">{[1, 2, 3].map(i => <li>{t(`mis.${sel}.c${i}`)}</li>)}</ul>
        <div class="live"><b style="color:var(--cyan)">{t('mis.live')}</b> · {live}</div>
        <NasaNow />
        <div class="stats">
          <div class="stat"><b>${fmt(base.budget, 0)}M</b><span>{t('mis.budget')}</span></div>
          <div class="stat"><b>{fmt(def.cruiseDays, 0)} {t('unit.days')}</b><span>{t('mis.cruise')}</span></div>
          <div class="stat"><b>{lightTimeS(def.earthAu) < 60 ? fmt(lightTimeS(def.earthAu)) + ' s' : fmt(lightTimeS(def.earthAu) / 60) + ' min'}</b><span>{t('mis.delay')}</span></div>
          <div class="stat"><b>{fmt(solarFlux(def.sunAu), 0)} W/m²</b><span>{t('mis.sun')}</span></div>
        </div>
        <div class="col" style="gap:8px"><h3 class="h-s">{t('mis.diff')}</h3>
          <Seg id="difficulty" label={t('mis.diff')} value={diff} onChange={setDiff} disabled={!host} options={(['cadet', 'engineer', 'director'] as Difficulty[]).map(v => ({ v, label: t('diff.' + v) }))} />
          <p class="small mut">{t(`diff.${diff}.d`)}</p></div>
        {open ? (host ? <Btn big id="mission-select" sound="select" onClick={() => act({ t: 'mission', mission: sel, difficulty: diff })}>{t('mis.select')}</Btn> : <p class="mut">{t('lobby.wait')}</p>)
          : <div class="col" style="gap:8px"><p class="mut row" style="flex-wrap:nowrap;align-items:flex-start"><Icon n="lock" /> {t('mis.locked')}</p><div><Btn kind="plain" id="unlock-all" onClick={unlockAll}>{t('mis.unlock')}</Btn></div></div>}
      </div>
    </div>
  </div>;
}

export type { Role };
