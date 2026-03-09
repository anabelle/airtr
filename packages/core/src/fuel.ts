import { fp, fpAdd, fpScale, fpSub } from "./fixed-point.js";
import { createTickPRNG } from "./prng.js";
import type { FixedPoint } from "./types.js";
import { TICKS_PER_DAY } from "./types.js";

export const FUEL_PRICE_MEAN_PER_KG = fp(1.2);
export const FUEL_PRICE_MIN_PER_KG = fp(0.8);
export const FUEL_PRICE_MAX_PER_KG = fp(1.6);
export const FUEL_PRICE_EPOCH_TICKS = TICKS_PER_DAY;

const FUEL_THETA = 0.00018;
const FUEL_SIGMA = 0.0035;

const epochCache = new Map<number, FixedPoint>([[0, FUEL_PRICE_MEAN_PER_KG]]);

function clampFuelPrice(price: FixedPoint): FixedPoint {
  if (price < FUEL_PRICE_MIN_PER_KG) return FUEL_PRICE_MIN_PER_KG;
  if (price > FUEL_PRICE_MAX_PER_KG) return FUEL_PRICE_MAX_PER_KG;
  return price;
}

function randomStandardNormal(tick: number): number {
  const prng = createTickPRNG(tick);
  const u1 = Math.max(prng(), Number.EPSILON);
  const u2 = prng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export function stepFuelPrice(currentPrice: FixedPoint, tick: number): FixedPoint {
  const drift = fpScale(fpSub(FUEL_PRICE_MEAN_PER_KG, currentPrice), FUEL_THETA);
  const shock = fp(FUEL_SIGMA * randomStandardNormal(tick));
  return clampFuelPrice(fpAdd(currentPrice, fpAdd(drift, shock)));
}

function getEpochFuelPrice(epoch: number): FixedPoint {
  const cached = epochCache.get(epoch);
  if (cached !== undefined) return cached;

  const previous = getEpochFuelPrice(epoch - 1);
  let price = previous;
  const startTick = (epoch - 1) * FUEL_PRICE_EPOCH_TICKS;
  const endTick = epoch * FUEL_PRICE_EPOCH_TICKS;

  for (let tick = startTick; tick < endTick; tick += 1) {
    price = stepFuelPrice(price, tick);
  }

  epochCache.set(epoch, price);
  return price;
}

export function getFuelPriceAtTick(tick: number): FixedPoint {
  const safeTick = Math.max(0, Math.floor(tick));
  const epoch = Math.floor(safeTick / FUEL_PRICE_EPOCH_TICKS);
  let price = getEpochFuelPrice(epoch);
  const epochStartTick = epoch * FUEL_PRICE_EPOCH_TICKS;

  for (let currentTick = epochStartTick; currentTick < safeTick; currentTick += 1) {
    price = stepFuelPrice(price, currentTick);
  }

  return price;
}

export interface FuelPriceSample {
  tick: number;
  price: FixedPoint;
}

export function getFuelPriceHistory(
  currentTick: number,
  sampleCount = 48,
  sampleSpacingTicks = 120,
): FuelPriceSample[] {
  const safeCurrentTick = Math.max(0, Math.floor(currentTick));
  const safeSampleCount = Math.max(2, Math.floor(sampleCount));
  const spacing = Math.max(1, Math.floor(sampleSpacingTicks));
  const startTick = Math.max(0, safeCurrentTick - (safeSampleCount - 1) * spacing);
  const samples: FuelPriceSample[] = [];

  for (let tick = startTick; tick <= safeCurrentTick; tick += spacing) {
    samples.push({ tick, price: getFuelPriceAtTick(tick) });
  }

  if (samples[samples.length - 1]?.tick !== safeCurrentTick) {
    samples.push({
      tick: safeCurrentTick,
      price: getFuelPriceAtTick(safeCurrentTick),
    });
  }

  return samples;
}
