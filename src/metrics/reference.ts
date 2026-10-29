/**
 * Reference values from outside the recording, such as dash readings with the
 * session time they were read at. A recording cannot hold them (the carcass
 * channels stay frozen between pit stops), and recordings are never committed,
 * so these live in small JSON files kept by whoever made the recording.
 */
import type { Corner } from '../model/types.ts';

export const QUANTITIES = ['carcass', 'tread'] as const;
export type Quantity = (typeof QUANTITIES)[number];
export const KINDS = ['dash', 'pit-reading', 'other'] as const;
export type Kind = (typeof KINDS)[number];
const CORNERS: readonly Corner[] = ['lf', 'rf', 'lr', 'rr'];

export interface Reading {
  /** Session time, s: the same clock as the sample's `t` (SessionTime). */
  t: number;
  corner: Corner;
  quantity: Quantity;
  /** deg C */
  value: number;
  kind: Kind;
}

export interface Reference {
  /** Free text: where the values came from. Not interpreted. */
  source: string;
  /** The sim's car path, when it should override the recording's. */
  car?: string;
  readings: Reading[];
}

const fail = (where: string, why: string): never => {
  throw new Error(`reference file: ${where}: ${why}`);
};

export const parseReference = (text: string): Reference => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail('file', 'not valid JSON');
  }
  const obj = raw as Record<string, unknown>;
  if (typeof raw !== 'object' || raw === null || obj.schema !== 1)
    fail('file', 'expected an object with "schema": 1');
  if (typeof obj.source !== 'string' || obj.source === '')
    fail('source', 'say where the values came from');
  if (obj.car !== undefined && typeof obj.car !== 'string')
    fail('car', 'must be a string');
  if (!Array.isArray(obj.readings)) fail('readings', 'must be a list');
  const readings = (obj.readings as unknown[]).map((r, i): Reading => {
    const at = `readings[${i}]`;
    const x = r as Record<string, unknown>;
    if (typeof x !== 'object' || x === null) fail(at, 'must be an object');
    if (typeof x.t !== 'number' || !Number.isFinite(x.t) || x.t < 0)
      fail(at, '"t" must be a session time in seconds, 0 or more');
    if (!CORNERS.includes(x.corner as Corner))
      fail(at, `"corner" must be one of ${CORNERS.join(', ')}`);
    if (!QUANTITIES.includes(x.quantity as Quantity))
      fail(at, `"quantity" must be one of ${QUANTITIES.join(', ')}`);
    if (typeof x.value !== 'number' || !Number.isFinite(x.value))
      fail(at, '"value" must be a finite number (deg C)');
    if (x.kind !== undefined && !KINDS.includes(x.kind as Kind))
      fail(at, `"kind" must be one of ${KINDS.join(', ')}`);
    return {
      t: x.t as number,
      corner: x.corner as Corner,
      quantity: x.quantity as Quantity,
      value: x.value as number,
      kind: (x.kind as Kind | undefined) ?? 'other',
    };
  });
  return {
    source: obj.source as string,
    ...(obj.car !== undefined && { car: obj.car as string }),
    readings,
  };
};
