/**
 * Read an .ibt: list its channels with units and read values, including one
 * element of an array channel. Runs as is on a synthetic file:
 *   node examples/read-channels.ts
 * For your own file, replace `makeSyntheticFile()` with its path.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { formatValue, readVarValue } from '../src/ibt/binary.ts';
import { IbtFile } from '../src/ibt/reader.ts';
import { buildIbt } from '../src/ibt/testBuilder.ts';
import { IbtVarType } from '../src/ibt/types.ts';

const makeSyntheticFile = (): string => {
  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'tire-lab-')),
    'example.ibt',
  );
  fs.writeFileSync(
    file,
    buildIbt({
      yaml: 'WeekendInfo:\n TrackName: example\n',
      vars: [
        { name: 'SessionTime', type: IbtVarType.Double, unit: 's' },
        { name: 'LFtempCL', type: IbtVarType.Float, unit: 'C' },
        {
          name: 'LatAccel_ST',
          type: IbtVarType.Float,
          unit: 'm/s^2',
          count: 6,
        },
      ],
      rows: [
        { SessionTime: 0, LFtempCL: 70.3, LatAccel_ST: [0, 1, 2, 3, 4, 5] },
        {
          SessionTime: 1 / 60,
          LFtempCL: 70.4,
          LatAccel_ST: [6, 7, 8, 9, 10, 11],
        },
      ],
    }),
  );
  return file;
};

const file = IbtFile.open(makeSyntheticFile());
try {
  console.log(`${file.recordCount} records at ${file.header.tickRate} Hz`);
  for (const v of file.vars) {
    console.log(`${v.name}: unit '${v.unit}', ${v.count} value(s) per record`);
  }

  // A channel the file does not record is undefined, not 0.
  const carcass = file.channel('LFtempCL');
  const surface = file.channel('LFtempL');
  console.log(`surface channel recorded: ${surface !== undefined}`);

  if (carcass) {
    const record = file.readRecord(1);
    console.log(
      `LFtempCL = ${formatValue(readVarValue(record, carcass), carcass.type)} ${carcass.unit}`,
    );
  }

  // One element of an array channel: the third of six 360 Hz samples.
  const lat = file.require(['LatAccel_ST'])[0];
  console.log(`LatAccel_ST[2] = ${readVarValue(file.readRecord(0), lat, 2)}`);
} finally {
  file.close();
}
