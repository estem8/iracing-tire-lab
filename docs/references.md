# Reference values and the error table

A recording cannot say how hot a tire really was: the carcass channels (`*tempC*`) stay frozen between pit stops, and the tread channels are unverified. The numbers worth comparing a model to are mostly read from outside the file: the cockpit dash, or the sim's reading at a pit stop. They go in a small JSON **reference file** that stays with whoever made the recording. Recordings are never committed; a reference file is a few hundred bytes and may be, if its owner agrees.

## The file

```json
{
  "schema": 1,
  "source": "Ferrari 296 GT3, Nordschleife, dash read from a screen recording",
  "car": "ferrari296gt3",
  "readings": [
    {
      "t": 612.4,
      "corner": "lf",
      "quantity": "carcass",
      "value": 81,
      "kind": "dash"
    },
    {
      "t": 612.4,
      "corner": "rr",
      "quantity": "carcass",
      "value": 77,
      "kind": "dash"
    },
    {
      "t": 1480.0,
      "corner": "lf",
      "quantity": "carcass",
      "value": 74,
      "kind": "pit-reading"
    }
  ]
}
```

- `t` is session time in seconds, the same clock as the recording's `SessionTime`. A reading taken from video needs the session time of that moment; read it off a `tire-lab chart` of the same file.
- `corner`: `lf`, `rf`, `lr`, `rr`. `quantity`: `carcass` (what a dash or a pit reading shows) or `tread`. `value` is in degrees Celsius.
- `kind`: `dash`, `pit-reading` or `other` (the default). It only groups the table; say honestly what each value is.
- `source` is required: where the numbers came from. `car` is optional and overrides the car path found in the recording.
- A bad file is rejected with the index of the reading and the reason.

## The command

```
npm run tire-lab -- score recording.ibt --reference reference.json
```

It runs the overlay's tire estimate (`OverlayModel`, physics plus its pit-stop state machine, without wear, load and the slip estimator) over the recording the way the overlay does (20 Hz arrival, 15 Hz tick, the `live` mask) and prints, for all readings and grouped by corner, quantity, phase (`track`, `pit`, `garage`) and kind: the count, mean absolute error, RMS error, largest absolute error and bias. Errors are **model minus reference**, so a positive bias means the model reads high. `--json` also lists every pair. A reading is matched to the latest model step at or before it, if that step is within `--max-gap` seconds (default 1); readings with nothing to compare to are counted, not hidden.

## What the table does and does not say

- The model resets tires at a pit stop the way the overlay does (checked against the real processor on synthetic drives, `docs/extraction-plan.md` 4g). It does not have the slip estimator, so wheel-spin heat is missing, and it needs the `*wear` channels in the recording as well as the carcass ones.
- The model's carcass value is the one the overlay builds its shown number on, before the per-zone spread; compare it with a dash value, not with a single zone of a pit reading, unless the spread is the question.
- A few readings say little. The count is printed so it can be judged; there is no confidence interval.
- The table measures distance to the reference values you supply, not to the sim's internal state.
