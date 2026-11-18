/*
 * Raw score (out of 40) -> band. Approximate tables based on the published IELTS conversions;
 * every band shown on the site is labelled "estimated band".
 * Each row is [minimum raw score, band]; the first row whose minimum is reached wins.
 */
export const BAND_TABLES = {
  listening: [
    [39, 9], [37, 8.5], [35, 8], [32, 7.5], [30, 7], [26, 6.5], [23, 6], [18, 5.5],
    [16, 5], [13, 4.5], [10, 4], [8, 3.5], [6, 3], [4, 2.5], [2, 2], [1, 1], [0, 0]
  ],
  academic_reading: [
    [39, 9], [37, 8.5], [35, 8], [33, 7.5], [30, 7], [27, 6.5], [23, 6], [19, 5.5],
    [15, 5], [13, 4.5], [10, 4], [8, 3.5], [6, 3], [4, 2.5], [2, 2], [1, 1], [0, 0]
  ],
  general_reading: [
    [40, 9], [39, 8.5], [37, 8], [36, 7.5], [34, 7], [32, 6.5], [30, 6], [27, 5.5],
    [23, 5], [19, 4.5], [15, 4], [12, 3.5], [9, 3], [6, 2.5], [3, 2], [1, 1], [0, 0]
  ]
} as const satisfies Record<string, ReadonlyArray<readonly [number, number]>>;

export type BandTable = keyof typeof BAND_TABLES;

export interface BandEstimate {
  band: number;
  table: BandTable;
  /** raw score scaled to 40 questions (equal to raw when the test has 40) */
  scaledRaw: number;
  /** how many marks the estimate is based on */
  basedOn: number;
  /** true when the test has fewer or more than 40 marks */
  scaled: boolean;
}

/** null when there is nothing to base an estimate on */
export function estimateBand(table: BandTable, raw: number, total: number): BandEstimate | null {
  if (total <= 0) return null;
  const scaledRaw = total === 40 ? raw : Math.round((raw / total) * 40);
  const row = BAND_TABLES[table].find(([min]) => scaledRaw >= min);
  return { band: row ? row[1] : 0, table, scaledRaw, basedOn: total, scaled: total !== 40 };
}
