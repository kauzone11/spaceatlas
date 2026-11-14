import { useRef } from 'preact/hooks';
import { t, getLang } from '../i18n';
import { CREW, CREW_BY_ID, MENTOR } from '../data/crew';
import { SPRITE } from '../data/sprites';
import { PORTRAIT } from '../data/assets';
import { app, chooseCrew, teammateCrew } from './store';
import { Btn, Chip, cx } from './common';
import { sfx } from './audio';

/** Animated pixel-art character: a 4-frame sheet (rest, breath, blink, breath+blink) played by CSS, drawn at a whole-number pixel size. */
export function CrewSprite({ id, class: cls }: { id: string; class?: string }) {
  const s = SPRITE[id];
  return <span class={cx('spr', cls)} aria-hidden="true" style={`--w:${s.w};--hgt:${s.h};background-image:url(${s.sheet})`} />;
}

/** Crew selection: three characters on a line-up; the one you pick steps forward and its profile slides in beside it. */
export function CrewPicker(p: { solo: boolean; onBack: () => void; onEnter: () => void }) {
  const sel = app.crew, lang = getLang(), mates = app.mode === 'team' ? teammateCrew() : new Set<string>();
  const group = useRef<HTMLDivElement>(null);
  const pick = (id: string, focus = false) => {
    if (id !== app.crew) sfx.select();
    chooseCrew(id);
    if (focus) (group.current?.querySelector(`#crew-${id}`) as HTMLElement | null)?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const i = Math.max(0, CREW.findIndex(c => c.id === sel));
    pick(CREW[(i + (sel ? step : 0) + CREW.length) % CREW.length].id, true);
  };
  const c = sel ? CREW_BY_ID[sel] : null, m = c ? MENTOR[c.mentor] : null;
  return <div class="wrap col enter crewwrap">
    <div><h1 class="h-l">{t('crew.title')}</h1><p class="lead">{t('crew.sub')}</p></div>
    <div class={cx('crewstage', sel && 'picked')}>
      <div class="lineup" role="radiogroup" aria-label={t('crew.title')} ref={group} onKeyDown={onKey}>
        {CREW.map((k, i) => <button type="button" role="radio" id={'crew-' + k.id} aria-checked={sel === k.id}
          tabIndex={(sel ? sel === k.id : i === 0) ? 0 : -1} style={`--h:${k.hue};--d:${-i * 1.37}s`}
          class={cx('hero', sel === k.id && 'on', sel && sel !== k.id && 'off')} onClick={() => pick(k.id)}>
          <span class="body"><CrewSprite id={k.id} /></span>
          <span class="pad" aria-hidden="true" />
          <span class="tag"><b>{k.name.split(' ')[0]}</b><small>{t('role.' + k.role)}</small></span>
        </button>)}
      </div>
      {c && m ? <div class="panel profile" key={c.id} style={`--h:${c.hue}`} aria-live="polite">
        <p class="eyebrow">{t('role.' + c.role)}</p>
        <h2 class="h-l" id="crew-name">{c.name}</h2>
        <p class="mut">{c.pronouns[lang]} · {c.age} · {c.from}</p>
        <p class="spec">{t(`crew.${c.id}.spec`)}</p>
        <p class="small dim">{c.edu} · {t('crew.fict')}</p>
        <div class="stationbox">
          <p class="small mut">{t(`role.${c.role}.d`)}</p>
          <p class="small"><span class="mut">{t('crew.perk')}</span> <b style="color:var(--cyan)">{t('perk.' + c.role)}</b></p>
        </div>
        <div class="insp">
          <img src={PORTRAIT[c.mentor]} alt={m.name} width="56" height="56" />
          <div style="min-width:0">
            <p class="small">{t('crew.mentor')} <b id="crew-inspired">{m.name}</b></p>
            <p class="small mut">{t(`crew.${c.id}.link`)}</p>
            <p class="small dim">{t('crew.mentorsub')} · {t('crew.photo')} {m.nasaId}</p>
          </div>
        </div>
        {mates.has(c.id) && <Chip tone="info">{t('crew.teammate')}</Chip>}
        {p.solo && <p class="small dim">{t('crew.solo')}</p>}
      </div>
        : <div class="panel profile empty"><p class="h-m">{t('crew.pick')}</p><p class="small dim crewkeys">{t('crew.keys')}</p></div>}
    </div>
    <div class="row">
      <Btn kind="ghost" onClick={p.onBack}>{t('nav.back')}</Btn>
      <span style="flex:1" />
      <Btn big id="crew-enter" disabled={!sel} sound="select" onClick={p.onEnter}>{t('crew.enter')}</Btn>
    </div>
  </div>;
}
