import type { Role } from '../engine/catalog';
// Crew members are fictional characters whose paths are inspired by real NASA astronauts ("mentor" = inspiration). Only verifiable facts about the real astronauts are shown.
export interface Crew { id: string; name: string; pronouns: Record<'en' | 'pt' | 'es', string>; edu: string; role: Role; mentor: string; hue: number }
const P = { she: { en: 'she/her', pt: 'ela/dela', es: 'ella' }, he: { en: 'he/him', pt: 'ele/dele', es: 'él' }, they: { en: 'they/them', pt: 'elu/delu', es: 'elle' } };
// The four playable characters, one per station (pixel-art sprites in src/data/sprites.ts), in line-up order.
export const CREW: Crew[] = [
  { id: 'jeff', name: 'Jeff Almeida', pronouns: P.he, edu: 'ITA · Aerospace Engineering', role: 'sc', mentor: 'chang', hue: 140 },
  { id: 'sofie', name: 'Sofie Marín', pronouns: P.she, edu: 'UNAM · Physics; Stanford · Electrical Engineering', role: 'sys', mentor: 'ochoa', hue: 212 },
  { id: 'rin', name: 'Rin Takahashi', pronouns: P.they, edu: 'Caltech · Planetary Science', role: 'sci', mentor: 'watkins', hue: 28 },
  { id: 'mina', name: 'Mina Okafor', pronouns: P.she, edu: 'Georgia Tech · Electrical Engineering', role: 'ops', mentor: 'koch', hue: 268 },
];
export const CREW_BY_ID: Record<string, Crew> = Object.fromEntries(CREW.map(c => [c.id, c]));
export const MENTOR: Record<string, { name: string; nasaId: string }> = {
  ochoa: { name: 'Ellen Ochoa', nasaId: 'jsc2014e037863' }, chang: { name: 'Franklin Chang-Díaz', nasaId: 'S97-06573' }, watkins: { name: 'Jessica Watkins', nasaId: 'jsc2026e035015_alt' },
  koch: { name: 'Christina Koch', nasaId: 'jsc2018e095073_alt' },
};
