/**
 * Binary layout of an iRacing .ibt telemetry file.
 *
 * Adapted from irdashies (MIT, https://github.com/tariknz/irdashies,
 * src/app/ibt/ibtTypes.ts at d421f67). See NOTICE.
 *
 * An .ibt mirrors the live shared-memory format: an irsdk_header, an
 * irsdk_diskSubHeader, then (at the offsets named in the header) the YAML
 * session info, the varHeader array and the sample records. All numbers are
 * little-endian.
 */

/** irsdk_header, bytes. */
export const IBT_HEADER_SIZE = 112;
/** irsdk_diskSubHeader, bytes; immediately after the header. */
export const IBT_DISK_SUBHEADER_SIZE = 32;
/** irsdk_varHeader, bytes per entry. */
export const IBT_VAR_HEADER_SIZE = 144;

/** Field offsets inside one irsdk_varHeader. */
export const VAR_HEADER_FIELDS = {
  type: 0,
  offset: 4,
  count: 8,
  countAsTime: 12,
  name: 16,
  nameLen: 32,
  desc: 48,
  descLen: 64,
  unit: 112,
  unitLen: 32,
} as const;

/** The only header version this reader understands (IRSDK_VER). */
export const IBT_SUPPORTED_VERSION = 2;

/** irsdk_VarType. A const object, not an enum, so the file runs unbuilt. */
export const IbtVarType = {
  Char: 0,
  Bool: 1,
  Int: 2,
  BitField: 3,
  Float: 4,
  Double: 5,
} as const;
export type IbtVarType = (typeof IbtVarType)[keyof typeof IbtVarType];

export const IBT_VAR_TYPE_BYTES: Readonly<Record<number, number>> = {
  [IbtVarType.Char]: 1,
  [IbtVarType.Bool]: 1,
  [IbtVarType.Int]: 4,
  [IbtVarType.BitField]: 4,
  [IbtVarType.Float]: 4,
  [IbtVarType.Double]: 8,
};

export interface IbtHeader {
  ver: number;
  status: number;
  /** Samples per second the sim wrote, e.g. 60. */
  tickRate: number;
  sessionInfoUpdate: number;
  sessionInfoLen: number;
  sessionInfoOffset: number;
  numVars: number;
  varHeaderOffset: number;
  numBuf: number;
  /** Length in bytes of one sample record. */
  bufLen: number;
  /** Byte offset of the first sample record (varBuf[0].bufOffset). */
  bufOffset: number;
}

export interface IbtDiskSubHeader {
  sessionStartDate: number;
  sessionStartTime: number;
  sessionEndTime: number;
  sessionLapCount: number;
  /** Number of records the sim says it wrote; 0 while still recording. */
  sessionRecordCount: number;
}

export interface IbtVarHeader {
  type: IbtVarType;
  /** Byte offset of the first element inside a sample record. */
  offset: number;
  /** Array length; 1 for a scalar. */
  count: number;
  /** Whether the array holds samples of one tick spread over time. */
  countAsTime: boolean;
  name: string;
  /** Description, as the sim wrote it. */
  desc: string;
  /** Unit, as the sim wrote it ('' when it has none). */
  unit: string;
}
