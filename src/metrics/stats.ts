/** Error statistics of a list of signed errors (model minus reference). */
export interface ErrorStats {
  n: number;
  /** Mean absolute error; null when there is nothing to measure. */
  mae: number | null;
  rmse: number | null;
  /** Largest absolute error. */
  max: number | null;
  /** Mean signed error: positive means the model reads high. */
  bias: number | null;
}

export const errorStats = (errors: readonly number[]): ErrorStats => {
  const n = errors.length;
  if (n === 0) return { n, mae: null, rmse: null, max: null, bias: null };
  let abs = 0;
  let sq = 0;
  let sum = 0;
  let max = 0;
  for (const e of errors) {
    abs += Math.abs(e);
    sq += e * e;
    sum += e;
    max = Math.max(max, Math.abs(e));
  }
  return { n, mae: abs / n, rmse: Math.sqrt(sq / n), max, bias: sum / n };
};
