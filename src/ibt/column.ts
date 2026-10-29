/** A column spec: `Name` for a scalar channel, `Name[i]` for one element of an array channel. */
export const parseColumn = (spec: string): { name: string; index: number } => {
  const m = /^(.+)\[(\d+)\]$/.exec(spec);
  return m ? { name: m[1], index: Number(m[2]) } : { name: spec, index: 0 };
};
