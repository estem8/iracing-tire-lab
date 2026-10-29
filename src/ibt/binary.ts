/**
 * Pure decoders for the .ibt structs: a Buffer in, a value out, no I/O.
 *
 * Adapted from irdashies (MIT, src/app/ibt/ibtBinary.ts at d421f67). Changes:
 * the var table keeps `desc`, `unit` and `countAsTime`, and a value can be
 * read at any index of an array channel.
 */
import {
  IBT_DISK_SUBHEADER_SIZE,
  IBT_HEADER_SIZE,
  IBT_VAR_HEADER_SIZE,
  IBT_VAR_TYPE_BYTES,
  IbtVarType,
  VAR_HEADER_FIELDS as F,
  type IbtDiskSubHeader,
  type IbtHeader,
  type IbtVarHeader,
} from './types.ts';
import { IbtError } from './errors.ts';

const readCString = (buf: Buffer, start: number, maxLen: number): string => {
  let end = start;
  const limit = Math.min(start + maxLen, buf.length);
  while (end < limit && buf[end] !== 0) end++;
  return buf.toString('latin1', start, end);
};

export const parseHeader = (buf: Buffer): IbtHeader => {
  if (buf.length < IBT_HEADER_SIZE) {
    throw new IbtError('truncated', 'File is smaller than the header');
  }
  return {
    ver: buf.readInt32LE(0),
    status: buf.readInt32LE(4),
    tickRate: buf.readInt32LE(8),
    sessionInfoUpdate: buf.readInt32LE(12),
    sessionInfoLen: buf.readInt32LE(16),
    sessionInfoOffset: buf.readInt32LE(20),
    numVars: buf.readInt32LE(24),
    varHeaderOffset: buf.readInt32LE(28),
    numBuf: buf.readInt32LE(32),
    bufLen: buf.readInt32LE(36),
    // varBuf[0] starts at offset 48: { int tickCount; int bufOffset; ... }
    bufOffset: buf.readInt32LE(52),
  };
};

export const parseDiskSubHeader = (buf: Buffer): IbtDiskSubHeader => {
  const base = IBT_HEADER_SIZE;
  if (buf.length < base + IBT_DISK_SUBHEADER_SIZE) {
    throw new IbtError('truncated', 'File is missing the disk sub-header');
  }
  return {
    sessionStartDate: Number(buf.readBigInt64LE(base)),
    sessionStartTime: buf.readDoubleLE(base + 8),
    sessionEndTime: buf.readDoubleLE(base + 16),
    sessionLapCount: buf.readInt32LE(base + 24),
    sessionRecordCount: buf.readInt32LE(base + 28),
  };
};

/** `buf` holds the region starting at header.varHeaderOffset, numVars * 144 bytes. */
export const parseVarHeaders = (
  buf: Buffer,
  numVars: number,
): IbtVarHeader[] => {
  const headers: IbtVarHeader[] = [];
  for (let i = 0; i < numVars; i++) {
    const base = i * IBT_VAR_HEADER_SIZE;
    if (base + IBT_VAR_HEADER_SIZE > buf.length) {
      throw new IbtError('truncated', 'Variable header array is truncated');
    }
    headers.push({
      type: buf.readInt32LE(base + F.type) as IbtVarType,
      offset: buf.readInt32LE(base + F.offset),
      count: buf.readInt32LE(base + F.count),
      countAsTime: buf.readUInt8(base + F.countAsTime) !== 0,
      name: readCString(buf, base + F.name, F.nameLen),
      desc: readCString(buf, base + F.desc, F.descLen),
      unit: readCString(buf, base + F.unit, F.unitLen),
    });
  }
  return headers;
};

/** Byte width of one element of the given type; 0 for an unknown type. */
export const varTypeBytes = (type: number): number =>
  IBT_VAR_TYPE_BYTES[type] ?? 0;

/**
 * One element of a channel in a record. Booleans and chars come back as
 * numbers. Floats are widened to double without rounding; format them with
 * `formatValue` to get their shortest exact text.
 */
export const readVarValue = (
  record: Buffer,
  header: IbtVarHeader,
  index = 0,
): number => {
  const width = varTypeBytes(header.type);
  if (index < 0 || index >= header.count) {
    throw new RangeError(
      `${header.name}[${index}] is outside 0..${header.count - 1}`,
    );
  }
  const at = header.offset + index * width;
  if (width === 0 || at + width > record.length) {
    throw new RangeError(`${header.name}[${index}] does not fit in the record`);
  }
  switch (header.type) {
    case IbtVarType.Char:
      return record.readUInt8(at);
    case IbtVarType.Bool:
      return record.readUInt8(at) !== 0 ? 1 : 0;
    case IbtVarType.Int:
    case IbtVarType.BitField:
      return record.readInt32LE(at);
    case IbtVarType.Float:
      return record.readFloatLE(at);
    default:
      return record.readDoubleLE(at);
  }
};

/**
 * Shortest text that reads back to the same number. A float32 needs at most
 * nine significant digits, so the first precision that survives
 * Math.fround is exact; doubles use JavaScript's own shortest form.
 * Non-finite values give '' (an empty CSV cell), never 0.
 */
export const formatValue = (value: number, type: number): string => {
  if (!Number.isFinite(value)) return '';
  if (type !== IbtVarType.Float) return String(value);
  for (let digits = 1; digits <= 9; digits++) {
    const text = String(Number(value.toPrecision(digits)));
    if (Math.fround(Number(text)) === value) return text;
  }
  return String(value);
};
