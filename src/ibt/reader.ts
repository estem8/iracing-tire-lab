/**
 * Reads an .ibt without loading it whole: the small regions up front, sample
 * records on demand. Validation follows irdashies' importer (MIT,
 * src/app/ibt/ibtImport.ts at d421f67): every size taken from the header is
 * bounded and checked against the file before it is used.
 */
import fs from 'node:fs';
import {
  parseDiskSubHeader,
  parseHeader,
  parseVarHeaders,
  varTypeBytes,
} from './binary.ts';
import { IbtError } from './errors.ts';
import {
  IBT_DISK_SUBHEADER_SIZE,
  IBT_HEADER_SIZE,
  IBT_SUPPORTED_VERSION,
  IBT_VAR_HEADER_SIZE,
  type IbtDiskSubHeader,
  type IbtHeader,
  type IbtVarHeader,
} from './types.ts';

const MAX_NUM_VARS = 8192;
const MAX_BUF_LEN = 1024 * 1024;
const MAX_SESSION_INFO_LEN = 32 * 1024 * 1024;

const readExactly = (fd: number, position: number, length: number): Buffer => {
  const buf = Buffer.alloc(length);
  const bytes = fs.readSync(fd, buf, 0, length, position);
  if (bytes < length) {
    throw new IbtError('truncated', 'The file ended before an expected region');
  }
  return buf;
};

const inside = (value: number, size: number) =>
  Number.isSafeInteger(value) && value > 0 && value <= size;

export class IbtFile {
  readonly header: IbtHeader;
  readonly disk: IbtDiskSubHeader;
  readonly vars: readonly IbtVarHeader[];
  /** The session-info YAML exactly as stored, without trailing NULs. */
  readonly sessionYaml: string;
  /** Records actually present: what the sim declared, clamped to the file's size. */
  readonly recordCount: number;
  private readonly byName: Map<string, IbtVarHeader>;
  private fd: number | undefined;

  private constructor(fd: number, size: number) {
    this.fd = fd;
    const prefix = readExactly(
      fd,
      0,
      IBT_HEADER_SIZE + IBT_DISK_SUBHEADER_SIZE,
    );
    this.header = parseHeader(prefix);
    const h = this.header;
    if (h.ver !== IBT_SUPPORTED_VERSION) {
      throw new IbtError(
        h.ver > 0 && h.ver < 100 ? 'unsupported-version' : 'bad-signature',
        `Unsupported .ibt version (${h.ver})`,
      );
    }
    if (
      !(h.numVars > 0 && h.numVars <= MAX_NUM_VARS) ||
      !(h.bufLen > 0 && h.bufLen <= MAX_BUF_LEN) ||
      !(h.sessionInfoLen >= 0 && h.sessionInfoLen <= MAX_SESSION_INFO_LEN) ||
      !inside(h.varHeaderOffset, size) ||
      !inside(h.sessionInfoOffset, size) ||
      !inside(h.bufOffset, size)
    ) {
      throw new IbtError('bad-signature', 'Not a valid .ibt file');
    }
    if (
      h.varHeaderOffset + h.numVars * IBT_VAR_HEADER_SIZE > size ||
      h.sessionInfoOffset + h.sessionInfoLen > size
    ) {
      throw new IbtError(
        'truncated',
        'The file ended before an expected region',
      );
    }
    this.disk = parseDiskSubHeader(prefix);
    this.vars = parseVarHeaders(
      readExactly(fd, h.varHeaderOffset, h.numVars * IBT_VAR_HEADER_SIZE),
      h.numVars,
    );
    for (const v of this.vars) {
      const width = varTypeBytes(v.type);
      if (
        width <= 0 ||
        v.count < 1 ||
        v.offset < 0 ||
        v.offset + v.count * width > h.bufLen
      ) {
        throw new IbtError(
          'bad-signature',
          `Channel ${v.name} does not fit inside a sample record`,
        );
      }
    }
    this.byName = new Map(this.vars.map((v) => [v.name, v]));
    this.sessionYaml = readExactly(fd, h.sessionInfoOffset, h.sessionInfoLen)
      .toString('latin1')
      .replace(/\0+$/, '');
    const available = Math.floor((size - h.bufOffset) / h.bufLen);
    this.recordCount =
      this.disk.sessionRecordCount > 0
        ? Math.min(this.disk.sessionRecordCount, available)
        : available;
  }

  static open(path: string): IbtFile {
    let fd: number;
    try {
      fd = fs.openSync(path, 'r');
    } catch {
      throw new IbtError('unreadable', 'Could not open the file');
    }
    try {
      return new IbtFile(fd, fs.fstatSync(fd).size);
    } catch (e) {
      fs.closeSync(fd);
      throw e;
    }
  }

  /** The channel's header, or undefined when the file does not record it. */
  channel(name: string): IbtVarHeader | undefined {
    return this.byName.get(name);
  }

  /** Several channels at once; throws one error naming every missing one. */
  require(names: readonly string[]): IbtVarHeader[] {
    const missing = names.filter((n) => !this.byName.has(n));
    if (missing.length > 0) {
      throw new IbtError(
        'missing-channels',
        `The file does not record: ${missing.join(', ')}`,
      );
    }
    return names.map((n) => this.byName.get(n) as IbtVarHeader);
  }

  /** One sample record, as raw bytes. */
  readRecord(index: number): Buffer {
    if (this.fd === undefined) throw new Error('The file is closed');
    if (!Number.isInteger(index) || index < 0 || index >= this.recordCount) {
      throw new RangeError(
        `Record ${index} is outside 0..${this.recordCount - 1}`,
      );
    }
    return readExactly(
      this.fd,
      this.header.bufOffset + index * this.header.bufLen,
      this.header.bufLen,
    );
  }

  close(): void {
    if (this.fd !== undefined) fs.closeSync(this.fd);
    this.fd = undefined;
  }
}
