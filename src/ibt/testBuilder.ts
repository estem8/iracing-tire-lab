/**
 * Test helper: builds a valid .ibt from a session YAML, a channel list and
 * rows, so tests never need a real (personal) recording.
 *
 * Adapted from irdashies (MIT, src/app/ibt/ibtTestBuilder.ts at d421f67).
 * Channels may carry a unit, a description and an array length.
 */
import {
  IBT_DISK_SUBHEADER_SIZE,
  IBT_HEADER_SIZE,
  IBT_VAR_HEADER_SIZE,
  IBT_VAR_TYPE_BYTES,
  IbtVarType,
  VAR_HEADER_FIELDS as F,
} from './types.ts';

export interface BuildIbtVar {
  name: string;
  type: IbtVarType;
  unit?: string;
  desc?: string;
  /** Array length; default 1. */
  count?: number;
}

export interface BuildIbtOptions {
  yaml: string;
  vars: BuildIbtVar[];
  /** One record per row. A scalar takes a number, an array a list of numbers. */
  rows: Record<string, number | number[]>[];
  version?: number;
  tickRate?: number;
  /** Overrides the record count the header declares (default rows.length). */
  recordCount?: number;
}

const writeValue = (
  buf: Buffer,
  pos: number,
  type: IbtVarType,
  value: number,
): void => {
  switch (type) {
    case IbtVarType.Char:
      buf.writeUInt8(value & 0xff, pos);
      break;
    case IbtVarType.Bool:
      buf.writeUInt8(value ? 1 : 0, pos);
      break;
    case IbtVarType.Int:
    case IbtVarType.BitField:
      buf.writeInt32LE(value | 0, pos);
      break;
    case IbtVarType.Float:
      buf.writeFloatLE(value, pos);
      break;
    default:
      buf.writeDoubleLE(value, pos);
  }
};

export const buildIbt = (opts: BuildIbtOptions): Buffer => {
  const yamlBuf = Buffer.from(opts.yaml, 'latin1');
  const offsets: number[] = [];
  let recordLen = 0;
  for (const v of opts.vars) {
    offsets.push(recordLen);
    recordLen += IBT_VAR_TYPE_BYTES[v.type] * (v.count ?? 1);
  }

  const sessionInfoOffset = IBT_HEADER_SIZE + IBT_DISK_SUBHEADER_SIZE;
  const varHeaderOffset = sessionInfoOffset + yamlBuf.length;
  const bufOffset = varHeaderOffset + opts.vars.length * IBT_VAR_HEADER_SIZE;
  const recordCount = opts.recordCount ?? opts.rows.length;
  const buf = Buffer.alloc(bufOffset + opts.rows.length * recordLen);

  buf.writeInt32LE(opts.version ?? 2, 0);
  buf.writeInt32LE(1, 4);
  buf.writeInt32LE(opts.tickRate ?? 60, 8);
  buf.writeInt32LE(1, 12);
  buf.writeInt32LE(yamlBuf.length, 16);
  buf.writeInt32LE(sessionInfoOffset, 20);
  buf.writeInt32LE(opts.vars.length, 24);
  buf.writeInt32LE(varHeaderOffset, 28);
  buf.writeInt32LE(1, 32);
  buf.writeInt32LE(recordLen, 36);
  buf.writeInt32LE(recordCount, 48);
  buf.writeInt32LE(bufOffset, 52);
  buf.writeInt32LE(recordCount, IBT_HEADER_SIZE + 28);

  yamlBuf.copy(buf, sessionInfoOffset);

  opts.vars.forEach((v, i) => {
    const base = varHeaderOffset + i * IBT_VAR_HEADER_SIZE;
    buf.writeInt32LE(v.type, base + F.type);
    buf.writeInt32LE(offsets[i], base + F.offset);
    buf.writeInt32LE(v.count ?? 1, base + F.count);
    buf.write(v.name, base + F.name, F.nameLen - 1, 'latin1');
    buf.write(v.desc ?? '', base + F.desc, F.descLen - 1, 'latin1');
    buf.write(v.unit ?? '', base + F.unit, F.unitLen - 1, 'latin1');
  });

  opts.rows.forEach((row, r) => {
    const start = bufOffset + r * recordLen;
    opts.vars.forEach((v, i) => {
      const raw = row[v.name] ?? 0;
      const width = IBT_VAR_TYPE_BYTES[v.type];
      const list = Array.isArray(raw) ? raw : [raw];
      for (let k = 0; k < (v.count ?? 1); k++) {
        writeValue(buf, start + offsets[i] + k * width, v.type, list[k] ?? 0);
      }
    });
  });

  return buf;
};
