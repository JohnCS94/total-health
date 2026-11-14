export type Units = 'imperial' | 'metric';

const LB_PER_KG = 2.20462;
const OZ_PER_ML = 0.033814;
const MI_PER_KM = 0.621371;

export const weightLabel = (u: Units) => (u === 'imperial' ? 'lb' : 'kg');
export const waterLabel = (u: Units) => (u === 'imperial' ? 'oz' : 'ml');
export const distanceLabel = (u: Units) => (u === 'imperial' ? 'mi' : 'km');

export const kgTo = (kg: number, u: Units) => (u === 'imperial' ? kg * LB_PER_KG : kg);
export const toKg = (v: number, u: Units) => (u === 'imperial' ? v / LB_PER_KG : v);

export const mlTo = (ml: number, u: Units) => (u === 'imperial' ? ml * OZ_PER_ML : ml);
export const toMl = (v: number, u: Units) => (u === 'imperial' ? v / OZ_PER_ML : v);

export const kmTo = (km: number, u: Units) => (u === 'imperial' ? km * MI_PER_KM : km);
export const toKm = (v: number, u: Units) => (u === 'imperial' ? v / MI_PER_KM : v);

/** Quick-add water buttons in the user's unit. */
export const waterPresets = (u: Units) => (u === 'imperial' ? [8, 12, 16, 24] : [250, 350, 500, 750]);

export const round = (n: number, dp = 1) => Math.round(n * 10 ** dp) / 10 ** dp;
