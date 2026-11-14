import { en } from './en';
import { pt } from './pt';
import { es } from './es';
export type Lang = 'en' | 'pt' | 'es';
export const LANGS: Lang[] = ['en', 'pt', 'es'];
export const DICT: Record<Lang, Record<string, string>> = { en, pt, es };
const LOCALE: Record<Lang, string> = { en: 'en-US', pt: 'pt-BR', es: 'es-ES' };
let lang: Lang = 'en';
export const setLang = (l: Lang) => { lang = l; };
export const getLang = () => lang;
/** Format a number for the current language: integers above 100, one decimal above 10, two below. */
export function fmt(n: number, digits?: number) {
  if (!isFinite(n)) return '∞';
  const a = Math.abs(n), d = digits ?? (a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 1 : 2);
  return new Intl.NumberFormat(LOCALE[lang], { maximumFractionDigits: d, minimumFractionDigits: 0 }).format(n);
}
export function t(key: string, vars?: Record<string, string | number | undefined>): string {
  let s = DICT[lang][key] ?? en[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => { const v = vars[k]; return v === undefined ? m : typeof v === 'number' ? fmt(v) : v; });
  return s;
}
export const has = (key: string) => key in en;
export function fmtDate(iso: string) {
  const d = new Date(iso + (iso.length <= 10 ? 'T12:00:00Z' : ''));
  return isNaN(+d) ? iso : new Intl.DateTimeFormat(LOCALE[lang], { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(d);
}
