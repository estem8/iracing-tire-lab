/**
 * Renders docs/channels.md from channels/channels.yaml, so the reference page
 * and the registry cannot drift (tests/docs.test.ts compares them).
 *   npm run docs
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

interface Channel {
  name: string;
  meaning: string;
  unit: string;
  status: 'verified' | 'unverified';
  evidence: string;
  update_behaviour: string;
}

const cell = (text: unknown): string =>
  String(text ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\s*\n\s*/g, ' ')
    .trim();

const table = (channels: Channel[]): string =>
  [
    '| Channel | Meaning | Unit | Update behaviour | Evidence |',
    '| --- | --- | --- | --- | --- |',
    ...channels.map(
      (c) =>
        `| \`${cell(c.name)}\` | ${cell(c.meaning)} | ${cell(c.unit)} | ` +
        `${cell(c.update_behaviour)} | ${cell(c.evidence)} |`,
    ),
  ].join('\n');

export const renderChannelsDoc = (yamlText: string): string => {
  const { channels } = parse(yamlText) as { channels: Channel[] };
  const bad = channels.filter(
    (c) => c.status !== 'verified' && c.status !== 'unverified',
  );
  if (bad.length > 0) {
    throw new Error(
      `status must be verified or unverified: ${bad.map((c) => c.name).join(', ')}`,
    );
  }
  const verified = channels.filter((c) => c.status === 'verified');
  const unverified = channels.filter((c) => c.status === 'unverified');
  return `<!-- Generated from channels/channels.yaml by \`npm run docs\`. Do not edit. -->

# Telemetry channels

What the lab knows about the iRacing telemetry channels relevant to tire state, and how well it knows it.

- **Verified**: the name, unit and description were seen in a real variable table. This does not mean the update behaviour is known; see that column.
- **Unverified**: the channel is used by other software, but the lab has not yet seen it in a real file. Do not rely on its name, unit or availability.

Carcass temperature and tread surface temperature are different quantities and are never interchangeable.

To add or promote a channel, see [CONTRIBUTING.md](../CONTRIBUTING.md): edit \`channels/channels.yaml\` with evidence from \`inspect --json\` of a real file, then run \`npm run docs\`.

## Verified (${verified.length})

${table(verified)}

## Unverified (${unverified.length})

${table(unverified)}
`;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(
    'docs/channels.md',
    renderChannelsDoc(fs.readFileSync('channels/channels.yaml', 'utf8')),
  );
  console.log('wrote docs/channels.md');
}
