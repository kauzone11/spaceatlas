import type { Role } from '../engine/catalog';
// Crew members are fictional characters whose paths are inspired by real NASA astronauts ("mentor" = inspiration). Only verifiable facts about the real astronauts are shown.
export interface Crew { id: string; name: string; pronouns: Record<'en' | 'pt' | 'es', string>; age: number; from: string; edu: string; role: Role; mentor: string; hue: number }
const P = { she: { en: 'she/her', pt: 'ela/dela', es: 'ella' }, he: { en: 'he/him', pt: 'ele/dele', es: 'él' }, they: { en: 'they/them', pt: 'elu/delu', es: 'elle' } };
export const CREW: Crew[] = [
  { id: 'maya', name: 'Maya Okafor', pronouns: P.she, age: 34, from: 'Houston, USA', edu: 'Stanford · Chemical Engineering', role: 'sys', mentor: 'jemison', hue: 212 },
  { id: 'dani', name: 'Daniel Reyes', pronouns: P.he, age: 38, from: 'San José, Costa Rica', edu: 'Georgia Tech · Aerospace Engineering', role: 'sc', mentor: 'chang', hue: 24 },
  { id: 'rin', name: 'Rin Takahashi', pronouns: P.they, age: 31, from: 'Sapporo, Japan', edu: 'Caltech · Planetary Science', role: 'sci', mentor: 'watkins', hue: 158 },
  { id: 'noor', name: 'Noor Haddad', pronouns: P.they, age: 35, from: 'Amman, Jordan', edu: 'Purdue · Electrical Engineering', role: 'ops', mentor: 'koch', hue: 268 },
  { id: 'sofia', name: 'Sofía Marín', pronouns: P.she, age: 33, from: 'Ciudad de México, México', edu: 'UNAM · Physics; Stanford · Applied Physics', role: 'sci', mentor: 'ochoa', hue: 338 },
  { id: 'lucas', name: 'Lucas Almeida', pronouns: P.he, age: 36, from: 'São José dos Campos, Brasil', edu: 'ITA · Engenharia Aeroespacial', role: 'ops', mentor: 'ride', hue: 190 },
];
export const CREW_BY_ID: Record<string, Crew> = Object.fromEntries(CREW.map(c => [c.id, c]));
export const MENTOR: Record<string, { name: string; nasaId: string }> = {
  ochoa: { name: 'Ellen Ochoa', nasaId: 'jsc2014e037863' }, chang: { name: 'Franklin Chang-Díaz', nasaId: 'S97-06573' }, watkins: { name: 'Jessica Watkins', nasaId: 'jsc2026e035015_alt' },
  koch: { name: 'Christina Koch', nasaId: 'jsc2018e095073_alt' }, jemison: { name: 'Mae Jemison', nasaId: 'S92-40463' }, ride: { name: 'Sally Ride', nasaId: 'S84-37256' },
};
