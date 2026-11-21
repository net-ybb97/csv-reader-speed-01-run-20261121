[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/net-ybb97/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/net-ybb97/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

# Read broken CSV files faster — a fast csv-reader 1.0.0 drop-in

Entry for the make.fun competition **csv-reader-speed-01-run-20261121**
("Read broken CSV files faster, 21 November 2026").

`main.ts` is the house driver: it reads every case from
`/input/cases.json`, answers each with `run` from `solve.js`, and
writes `/output/answers.json`. `solve.js` is the entry's own work: a
dependency-free ES module whose `run(input)` returns, for every
input, exactly the answer csv-reader 1.0.0 returns — `{columns, rows,
errors}` under csv-reader's broken-row policy (BOM dropped, stray CRs
dropped and reported, junk after a closing quote appended and
reported, a quote that never closes read again as unquoted text,
ragged rows padded or cut to the first record's width, every breakage
reported as `{code, line, row}` in the order met).

## How it is faster

csv-reader reads one character at a time and builds every field one
character at a time. This reader never builds a field character by
character:

- an unquoted field is found by one scan for the next comma or line
  break and taken with a single `slice`;
- a quoted field is found by jumping between the few characters that
  matter inside quotes — the next quote, the next CR — with
  `indexOf`, and is likewise sliced whole;
- only a field that actually holds a dropped stray CR or an escaped
  quote pays for joining segments;
- the field readers report through registers instead of allocating a
  result object per field.

No dependencies, no WASM, no native code: plain JavaScript, written
to behave byte for byte as csv-reader 1.0.0 does while spending its
time on far fewer, larger operations.
