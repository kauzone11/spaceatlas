// Parts, missions and constants. Pure data: no DOM, no randomness.
// Every number is an order-of-magnitude engineering value; sources are listed in SOURCES and shown in the "Why?" panels.

export type MissionId = 'leo' | 'moon' | 'neo' | 'mars';
export type Difficulty = 'cadet' | 'engineer' | 'director';
export type Role = 'sys' | 'sc' | 'sci' | 'ops';
export const ROLES: Role[] = ['sys', 'sc', 'sci', 'ops'];
export const MISSIONS: MissionId[] = ['leo', 'moon', 'neo', 'mars'];

export interface Design {
  mission: MissionId; difficulty: Difficulty;
  objective: string; ambition: number; // contract
  bus: string; redund: string; shield: string; // systems
  power: string; battery: string; thermal: string; prop: string; propKg: number; avionics: string; // spacecraft
  instruments: string[]; // science
  launcher: string; orbit: string; antenna: string; band: string; ground: string; // comms & ops
}
export type Field = Exclude<keyof Design, 'mission' | 'difficulty'>;

export const FIELD_ROLE: Record<Field, Role> = {
  objective: 'sys', ambition: 'sys', bus: 'sys', redund: 'sys', shield: 'sys',
  power: 'sc', battery: 'sc', thermal: 'sc', prop: 'sc', propKg: 'sc', avionics: 'sc',
  instruments: 'sci',
  launcher: 'ops', orbit: 'ops', antenna: 'ops', band: 'ops', ground: 'ops',
};

export const G0 = 9.80665; // m/s²
export const MU_EARTH = 398600.4418; // km³/s²
export const R_EARTH = 6371; // km
export const SOLAR_CONST = 1361; // W/m² at 1 AU
export const AU_KM = 149597870.7;
export const C_KMS = 299792.458;
export const CELL_EFF = 0.29; // triple-junction GaAs
export const ARRAY_LOSS = 0.85; // pointing, packing, wiring

export const DIFF = {
  cadet: { budgetK: 1.12, margin: 0.10, degr: 0.01, lifeK: 1.3 },
  engineer: { budgetK: 1.0, margin: 0.15, degr: 0.025, lifeK: 1.0 },
  director: { budgetK: 0.92, margin: 0.20, degr: 0.035, lifeK: 0.9 },
} as const;

// mass kg, cost $M
export const BUS: Record<string, { mass: number; payload: number; power: number; cost: number; maxProp: number }> = {
  S: { mass: 70, payload: 60, power: 30, cost: 6, maxProp: 120 },
  M: { mass: 320, payload: 300, power: 70, cost: 45, maxProp: 2000 },
  L: { mass: 900, payload: 900, power: 150, cost: 140, maxProp: 7000 },
};
export const REDUND: Record<string, { massK: number; costK: number; life: number }> = {
  single: { massK: 1, costK: 1, life: 1.5 },
  selective: { massK: 1.1, costK: 1.2, life: 4 },
  full: { massK: 1.25, costK: 1.5, life: 10 },
};
export const SHIELD: Record<string, { massK: number; cost: number; level: number }> = {
  light: { massK: 0, cost: 0, level: 0 },
  std: { massK: 0.04, cost: 1, level: 1 },
  heavy: { massK: 0.1, cost: 3.5, level: 2 },
};
export const POWER: Record<string, { area: number; rtgW: number; mass: number; cost: number }> = {
  solarS: { area: 0.6, rtgW: 0, mass: 4, cost: 0.5 },
  solarM: { area: 2, rtgW: 0, mass: 11, cost: 1.5 },
  solarL: { area: 6, rtgW: 0, mass: 30, cost: 4 },
  solarXL: { area: 18, rtgW: 0, mass: 85, cost: 11 },
  rtg: { area: 0, rtgW: 110, mass: 45, cost: 80 },
};
export const RTG_DECAY = 0.016; // fraction per year (fuel decay + thermocouple ageing)
export const BATTERY: Record<string, { wh: number; mass: number; cost: number }> = {
  S: { wh: 100, mass: 1, cost: 0.1 },
  M: { wh: 500, mass: 4, cost: 0.4 },
  L: { wh: 2500, mass: 18, cost: 1.5 },
  XL: { wh: 12000, mass: 80, cost: 6 },
};
export const THERMAL: Record<string, { mass: number; cost: number }> = {
  passive: { mass: 1, cost: 0.3 },
  heaters: { mass: 3, cost: 0.8 },
  rhu: { mass: 4, cost: 9 },
};
export const PROP: Record<string, { dry: number; isp: number; cost: number; tank: number; lowThrust: boolean }> = {
  none: { dry: 0, isp: 0, cost: 0, tank: 0, lowThrust: false },
  mono: { dry: 6, isp: 220, cost: 1.2, tank: 0.08, lowThrust: false },
  biprop: { dry: 40, isp: 320, cost: 9, tank: 0.08, lowThrust: false },
  ion: { dry: 55, isp: 2800, cost: 28, tank: 0.1, lowThrust: true },
};
export const ION_POWER = 1000; // W needed by the thruster while thrusting
export const ION_DV_K = 1.5; // low-thrust gravity losses
export const AVIONICS: Record<string, { mass: number; power: number; cost: number; storage: number }> = {
  basic: { mass: 4, power: 15, cost: 1.5, storage: 64 },
  auto: { mass: 9, power: 35, cost: 8, storage: 512 },
};
// gainDeep: relative to a ~3 m high-gain dish. gainLeo: relative data-rate factor on a short LEO link.
export const ANTENNA: Record<string, { mass: number; cost: number; gainDeep: number; gainLeo: number }> = {
  lga: { mass: 0.5, cost: 0.2, gainDeep: 1e-4, gainLeo: 1 },
  mga: { mass: 4, cost: 1.2, gainDeep: 1e-2, gainLeo: 4 },
  hga: { mass: 18, cost: 5, gainDeep: 1, gainLeo: 20 },
};
export const BAND: Record<string, { k: number; power: number; cost: number; cap: number }> = {
  s: { k: 0.125, power: 8, cost: 0.3, cap: 4 },
  x: { k: 1, power: 30, cost: 1.5, cap: 150 },
  ka: { k: 4, power: 45, cost: 4, cap: 600 },
};
export const GROUND: Record<string, { leoPasses: number; leoCost: number; deepHours: number; deepK: number; deepCost: number }> = {
  single: { leoPasses: 4, leoCost: 0.6, deepHours: 4, deepK: 1, deepCost: 4 },
  network: { leoPasses: 14, leoCost: 2.5, deepHours: 8, deepK: 4, deepCost: 12 },
};
export const DEEP_REF_MBPS = 2; // X-band, 3 m HGA, 34 m ground dish, at 1 AU
export const LEO_REF_MBPS = 4; // X-band with a low-gain antenna
// capacity kg by destination; cost $M by destination
export const LAUNCHER: Record<string, { cap: Record<string, number>; cost: Record<string, number> }> = {
  ride: { cap: { leo: 220, tli: 220, esc: 0 }, cost: { leo: 1.5, tli: 9, esc: 0 } },
  small: { cap: { leo: 300, tli: 60, esc: 30 }, cost: { leo: 8, tli: 10, esc: 10 } },
  medium: { cap: { leo: 15000, tli: 4200, esc: 3200 }, cost: { leo: 68, tli: 68, esc: 68 } },
  heavy: { cap: { leo: 50000, tli: 15000, esc: 12500 }, cost: { leo: 125, tli: 125, esc: 125 } },
};

export interface Instrument {
  id: string; mission: MissionId; mass: number; power: number; data: number; cost: number;
  rel: Record<string, number>; // relevance per objective
  req?: 'orbiter' | 'lander' | 'stay' | 'touch' | 'xband';
  optical?: boolean; allWeather?: boolean;
}
export const INSTRUMENTS: Instrument[] = [
  { id: 'cam', mission: 'leo', mass: 22, power: 55, data: 40, cost: 8, rel: { hot: 0.3, air: 0.3, land: 1 }, optical: true },
  { id: 'tir', mission: 'leo', mass: 16, power: 40, data: 10, cost: 6.5, rel: { hot: 1, air: 0.4, land: 0.5 }, allWeather: true },
  { id: 'spec', mission: 'leo', mass: 12, power: 30, data: 6, cost: 5.5, rel: { hot: 0.4, air: 1, land: 0.3 }, optical: true },
  { id: 'sar', mission: 'leo', mass: 55, power: 220, data: 90, cost: 16, rel: { hot: 0.2, air: 0.1, land: 1.3 }, allWeather: true },
  { id: 'mw', mission: 'leo', mass: 10, power: 25, data: 1, cost: 4, rel: { hot: 0, air: 0.8, land: 0.2 }, allWeather: true },
  { id: 'lcam', mission: 'moon', mass: 8, power: 20, data: 15, cost: 5, rel: { ice: 0.2, geo: 1, env: 0.2 } },
  { id: 'neut', mission: 'moon', mass: 6, power: 8, data: 0.05, cost: 6, rel: { ice: 1, geo: 0.2, env: 0.4 } },
  { id: 'irs', mission: 'moon', mass: 10, power: 18, data: 4, cost: 7, rel: { ice: 0.8, geo: 0.7, env: 0.1 } },
  { id: 'rad', mission: 'moon', mass: 3, power: 5, data: 0.02, cost: 2, rel: { ice: 0, geo: 0, env: 1 } },
  { id: 'drill', mission: 'moon', mass: 32, power: 80, data: 0.5, cost: 38, rel: { ice: 2.2, geo: 1, env: 0.2 }, req: 'lander' },
  { id: 'seis', mission: 'moon', mass: 9, power: 6, data: 0.3, cost: 9, rel: { ice: 0, geo: 1.2, env: 0.3 }, req: 'lander' },
  { id: 'ncam', mission: 'neo', mass: 9, power: 20, data: 12, cost: 6, rel: { shape: 1, comp: 0.3, surf: 0.6 } },
  { id: 'lidar', mission: 'neo', mass: 12, power: 45, data: 2, cost: 10, rel: { shape: 1.1, comp: 0, surf: 0.5 }, req: 'stay' },
  { id: 'tes', mission: 'neo', mass: 8, power: 15, data: 1.5, cost: 8, rel: { shape: 0.1, comp: 1, surf: 0.6 } },
  { id: 'xrs', mission: 'neo', mass: 7, power: 12, data: 0.2, cost: 7, rel: { shape: 0, comp: 1.1, surf: 0.2 }, req: 'stay' },
  { id: 'radio', mission: 'neo', mass: 1, power: 5, data: 0.05, cost: 1, rel: { shape: 0.6, comp: 0.2, surf: 0 }, req: 'xband' },
  { id: 'probe', mission: 'neo', mass: 25, power: 30, data: 0.5, cost: 30, rel: { shape: 0.1, comp: 0.8, surf: 2.2 }, req: 'touch' },
  { id: 'mcam', mission: 'mars', mass: 60, power: 60, data: 60, cost: 40, rel: { water: 0.6, clim: 0.2, geo: 1 }, req: 'orbiter', optical: true },
  { id: 'sounder', mission: 'mars', mass: 9, power: 18, data: 1, cost: 9, rel: { water: 0.2, clim: 1, geo: 0 }, req: 'orbiter' },
  { id: 'sharad', mission: 'mars', mass: 15, power: 60, data: 12, cost: 18, rel: { water: 1.2, clim: 0, geo: 0.5 }, req: 'orbiter' },
  { id: 'met', mission: 'mars', mass: 6, power: 10, data: 0.05, cost: 5, rel: { water: 0.1, clim: 1, geo: 0 }, req: 'lander' },
  { id: 'mseis', mission: 'mars', mass: 25, power: 8, data: 0.4, cost: 25, rel: { water: 0, clim: 0.1, geo: 1.3 }, req: 'lander' },
  { id: 'mdrill', mission: 'mars', mass: 40, power: 90, data: 0.6, cost: 60, rel: { water: 1.6, clim: 0, geo: 0.7 }, req: 'lander' },
  { id: 'mast', mission: 'mars', mass: 5, power: 12, data: 3, cost: 7, rel: { water: 0.2, clim: 0.3, geo: 0.6 }, req: 'lander', optical: true },
];
export const INST: Record<string, Instrument> = Object.fromEntries(INSTRUMENTS.map(i => [i.id, i]));

export interface OrbitDef {
  id: string; kind: 'orbiter' | 'lander' | 'flyby';
  dv: number; // km/s the spacecraft must provide after launch
  dvPerYear?: number; // station keeping
  alt?: number; // km
  sun: number; // average fraction of array output available (eclipse, sun angle, dust)
  nightH: number; // longest dark period, hours
  heat: number; // heater power needed in the cold case, W
  dod: number; // allowed battery depth of discharge
  sciK?: Record<string, number>; // science multiplier per objective
  maxDays?: number; // environment limit on operations when solar powered
  touch?: boolean; // surface contact allowed
  fixedByRide?: boolean;
}
export interface MissionDef {
  id: MissionId; sunAu: number; earthAu: number; dest: 'leo' | 'tli' | 'esc'; c3: number;
  cruiseDays: number; budget: number; teamCost: number; // $M per year of operations
  objectives: string[]; days: number[]; orbits: OrbitDef[]; refRate: number; flareSev: number;
}
export const MISSION: Record<MissionId, MissionDef> = {
  leo: {
    id: 'leo', sunAu: 1, earthAu: 0, dest: 'leo', c3: 0, cruiseDays: 14, budget: 50, teamCost: 1.5,
    objectives: ['hot', 'air', 'land'], days: [180, 365, 730], refRate: 18, flareSev: 1,
    orbits: [
      { id: 'sso400', kind: 'orbiter', alt: 400, dv: 0, dvPerYear: 0.03, sun: 0.61, nightH: 0.6, heat: 0, dod: 0.3, sciK: { hot: 0.85, air: 1, land: 1.25 } },
      { id: 'sso525', kind: 'orbiter', alt: 525, dv: 0, sun: 0.63, nightH: 0.59, heat: 0, dod: 0.3, sciK: { hot: 1, air: 1, land: 1 }, fixedByRide: true },
      { id: 'sso700', kind: 'orbiter', alt: 700, dv: 0.16, sun: 0.65, nightH: 0.58, heat: 0, dod: 0.3, sciK: { hot: 1.2, air: 1.05, land: 0.8 } },
    ],
  },
  moon: {
    id: 'moon', sunAu: 1, earthAu: 384400 / AU_KM, dest: 'tli', c3: -2, cruiseDays: 5, budget: 260, teamCost: 5,
    objectives: ['ice', 'geo', 'env'], days: [60, 180, 365], refRate: 22, flareSev: 2,
    orbits: [
      { id: 'lpo', kind: 'orbiter', alt: 100, dv: 0.95, sun: 0.6, nightH: 0.8, heat: 10, dod: 0.3, sciK: { ice: 1, geo: 1, env: 1 } },
      { id: 'ridge', kind: 'lander', dv: 2.85, sun: 0.75, nightH: 72, heat: 25, dod: 0.7, sciK: { ice: 1.1, geo: 1.2, env: 1.2 } },
      { id: 'psr', kind: 'lander', dv: 2.9, sun: 0, nightH: 0, heat: 60, dod: 0.7, sciK: { ice: 1.8, geo: 1, env: 1.3 } },
    ],
  },
  neo: {
    id: 'neo', sunAu: 1.0, earthAu: 0.15, dest: 'esc', c3: 1.84, cruiseDays: 153, budget: 150, teamCost: 7,
    objectives: ['shape', 'comp', 'surf'], days: [30, 90, 180], refRate: 22, flareSev: 2.5,
    orbits: [
      { id: 'flyby', kind: 'flyby', dv: 0.03, sun: 1, nightH: 0, heat: 8, dod: 0.5, sciK: { shape: 1, comp: 0.7, surf: 0.5 } },
      { id: 'rdv', kind: 'orbiter', dv: 0.16, sun: 1, nightH: 0, heat: 8, dod: 0.5, sciK: { shape: 1, comp: 1, surf: 1 } },
      { id: 'tag', kind: 'orbiter', dv: 0.22, sun: 1, nightH: 0, heat: 8, dod: 0.5, sciK: { shape: 1, comp: 1.1, surf: 1.2 }, touch: true },
    ],
  },
  mars: {
    id: 'mars', sunAu: 1.52, earthAu: 1.8, dest: 'esc', c3: 12, cruiseDays: 210, budget: 320, teamCost: 11,
    objectives: ['water', 'clim', 'geo'], days: [180, 687, 1374], refRate: 20, flareSev: 2,
    orbits: [
      { id: 'mro', kind: 'orbiter', alt: 300, dv: 1.05, sun: 0.65, nightH: 0.7, heat: 15, dod: 0.3, sciK: { water: 1, clim: 1, geo: 1 } },
      { id: 'eq', kind: 'lander', dv: 0.05, sun: 0.26, nightH: 12.5, heat: 30, dod: 0.6, sciK: { water: 0.8, clim: 1, geo: 1.2 } },
      { id: 'polar', kind: 'lander', dv: 0.05, sun: 0.2, nightH: 6, heat: 45, dod: 0.6, sciK: { water: 1.7, clim: 1.1, geo: 0.8 }, maxDays: 150 },
    ],
  },
};
export const AEROBRAKE_DV = 1.2; // km/s saved by aerobraking at Mars
export const LANDER_BUS_K = 1.25; // legs, descent structure
export const EDL_K = 0.6; // Mars aeroshell + parachute + cruise stage, fraction of landed mass
export const EDL_COST = 60;
export const FLYBY_DAYS = 10; // equivalent science days of an asteroid flyby

export const OPTIONS: Record<Exclude<Field, 'instruments' | 'propKg' | 'objective' | 'ambition' | 'orbit'>, string[]> = {
  bus: Object.keys(BUS), redund: Object.keys(REDUND), shield: Object.keys(SHIELD),
  power: Object.keys(POWER), battery: Object.keys(BATTERY), thermal: Object.keys(THERMAL), prop: Object.keys(PROP), avionics: Object.keys(AVIONICS),
  launcher: Object.keys(LAUNCHER), antenna: Object.keys(ANTENNA), band: Object.keys(BAND), ground: Object.keys(GROUND),
};

// Real, documented space-weather events used by the solar-storm situations.
export const WEATHER: Record<MissionId, { date: string; key: string }> = {
  leo: { date: '2024-05-10', key: 'gannon' },
  moon: { date: '1972-08-04', key: 'aug72' },
  neo: { date: '2012-07-23', key: 'stereo' },
  mars: { date: '2017-09-10', key: 'sep17' },
};

export const SOURCES: { id: string; label: string; url: string }[] = [
  { id: 'smad', label: 'Wertz, Everett & Puschell, Space Mission Engineering: The New SMAD (2011)', url: 'https://www.sme-smad.com/' },
  { id: 'esa', label: 'ESA Margin Philosophy for Science Assessment Studies (SRE-PA/2011.097)', url: 'https://sci.esa.int/documents/34375/36249/1567260131067-Margin_philosophy_for_science_assessment_studies_1.3.pdf' },
  { id: 'soa', label: 'NASA State-of-the-Art of Small Spacecraft Technology', url: 'https://www.nasa.gov/smallsat-institute/sst-soa/' },
  { id: 'eonet', label: 'NASA EONET v3: Earth Observatory Natural Event Tracker', url: 'https://eonet.gsfc.nasa.gov/' },
  { id: 'cad', label: 'NASA/JPL SBDB Close-Approach Data API', url: 'https://ssd-api.jpl.nasa.gov/doc/cad.html' },
  { id: 'nhats', label: 'NASA/JPL NHATS: Near-Earth Object Human Space Flight Accessible Targets Study', url: 'https://cneos.jpl.nasa.gov/nhats/' },
  { id: 'donki', label: 'NASA CCMC DONKI and NOAA SWPC space-weather records', url: 'https://ccmc.gsfc.nasa.gov/tools/DONKI/' },
  { id: 'odmsp', label: 'U.S. Orbital Debris Mitigation Standard Practices / FCC 5-year deorbit rule', url: 'https://orbitaldebris.jsc.nasa.gov/mitigation/' },
  { id: 'dsn', label: 'NASA Deep Space Network', url: 'https://www.nasa.gov/communicating-with-missions/dsn/' },
  { id: 'rps', label: 'NASA Radioisotope Power Systems (MMRTG)', url: 'https://science.nasa.gov/planetary-science/programs/radioisotope-power-systems/' },
  { id: 'n3d', label: 'NASA 3D Resources (textures and Bennu shape model)', url: 'https://github.com/nasa/NASA-3D-Resources' },
  { id: 'svs', label: "NASA's Scientific Visualization Studio: Blue Marble, CGI Moon Kit", url: 'https://svs.gsfc.nasa.gov/4720' },
  { id: 'img', label: 'NASA Image and Video Library (astronaut portraits)', url: 'https://images.nasa.gov/' },
];
