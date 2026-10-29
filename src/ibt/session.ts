/**
 * Session-info YAML handling without a YAML dependency: the few fields the lab
 * needs are read line by line, and personal fields are overwritten in place
 * with text of the same length, so every offset in the file stays valid.
 */

/** Keys whose values identify a person or a specific event. Exact key names only. */
const PERSONAL_TEXT = [
  'UserName',
  'TeamName',
  'Initials',
  'AbbrevName',
  'ClubName',
  'LicString',
  'DriverSetupName',
] as const;
const PERSONAL_NUMBER = [
  'UserID',
  'TeamID',
  'DriverUserID',
  'IRating',
  'ClubID',
  'LicLevel',
  'LicSubLevel',
  'SessionID',
  'SubSessionID',
] as const;

const lineOf = (key: string) =>
  new RegExp(`^(\\s*(?:- )?${key}:[ \\t]*)(.*)$`, 'gm');

/** Same-length redaction: letters and digits of a name become X, a number becomes 0s. */
export const anonymizeSessionYaml = (yaml: string): string => {
  let out = yaml;
  for (const key of PERSONAL_TEXT) {
    out = out.replace(
      lineOf(key),
      (_m, head: string, value: string) => head + value.replace(/[^\s]/g, 'X'),
    );
  }
  for (const key of PERSONAL_NUMBER) {
    out = out.replace(
      lineOf(key),
      (_m, head: string, value: string) => head + value.replace(/[^\s]/g, '0'),
    );
  }
  return out;
};

const scalar = (yaml: string, key: string): string | undefined =>
  new RegExp(`^\\s*${key}:[ \\t]*(.*?)[ \\t]*$`, 'm').exec(yaml)?.[1];

/** The Drivers entry of the player's car, as raw text. */
const playerBlock = (yaml: string): string => {
  const idx = Number(scalar(yaml, 'DriverCarIdx'));
  const starts = [...yaml.matchAll(/^\s*- CarIdx:[ \t]*(\d+)/gm)];
  for (let i = 0; i < starts.length; i++) {
    if (Number(starts[i][1]) !== idx) continue;
    const from = starts[i].index ?? 0;
    return yaml.slice(from, starts[i + 1]?.index ?? yaml.length);
  }
  return '';
};

export interface SessionSummary {
  carPath?: string;
  carScreenName?: string;
  trackName?: string;
  trackConfigName?: string;
  trackLength?: string;
  /** As the sim writes it, with its unit, e.g. "24.00 C". */
  trackAirTemp?: string;
  trackSurfaceTemp?: string;
}

/** Only fields without personal data: safe to publish next to an export. */
export const summarizeSession = (yaml: string): SessionSummary => {
  const car = playerBlock(yaml);
  return {
    carPath: scalar(car, 'CarPath'),
    carScreenName: scalar(car, 'CarScreenName'),
    trackName: scalar(yaml, 'TrackName'),
    trackConfigName: scalar(yaml, 'TrackConfigName'),
    trackLength: scalar(yaml, 'TrackLength'),
    trackAirTemp: scalar(yaml, 'TrackAirTemp'),
    trackSurfaceTemp: scalar(yaml, 'TrackSurfaceTemp'),
  };
};
