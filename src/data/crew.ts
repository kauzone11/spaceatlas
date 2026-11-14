import type { Role } from '../engine/catalog';
// Crew members are fictional characters whose paths are inspired by real NASA astronauts ("mentor" = inspiration). Only verifiable facts about the real astronauts are shown.
export interface Crew { id: string; name: string; pronouns: Record<'en' | 'pt' | 'es', string>; age: number; from: string; edu: string; role: Role; mentor: string; hue: number }
const P = { she: { en: 'she/her', pt: 'ela/dela', es: 'ella' }, he: { en: 'he/him', pt: 'ele/dele', es: 'él' }, they: { en: 'they/them', pt: 'elu/delu', es: 'elle' } };
// The three playable characters (pixel-art sprites in src/data/sprites.ts), in line-up order.
export const CREW: Crew[] = [
  { id: 'lucas', name: 'Lucas Almeida', pronouns: P.he, age: 29, from: 'São José dos Campos, Brasil', edu: 'ITA · Aerospace Engineering', role: 'sc', mentor: 'chang', hue: 140 },
  { id: 'sofia', name: 'Sofía Marín', pronouns: P.she, age: 33, from: 'Ciudad de México, México', edu: 'UNAM · Physics; Stanford · Electrical Engineering', role: 'sys', mentor: 'ochoa', hue: 212 },
  { id: 'rin', name: 'Rin Takahashi', pronouns: P.they, age: 31, from: 'Sapporo, Japan', edu: 'Caltech · Planetary Science', role: 'sci', mentor: 'watkins', hue: 28 },
];
export const CREW_BY_ID: Record<string, Crew> = Object.fromEntries(CREW.map(c => [c.id, c]));
export const MENTOR: Record<string, { name: string; nasaId: string }> = {
  ochoa: { name: 'Ellen Ochoa', nasaId: 'jsc2014e037863' }, chang: { name: 'Franklin Chang-Díaz', nasaId: 'S97-06573' }, watkins: { name: 'Jessica Watkins', nasaId: 'jsc2026e035015_alt' },
};
