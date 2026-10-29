# Getting started

Five minutes from an `.ibt` file to a chart, the model and a CSV. You need Node 24 or later, or on Windows just the program (below).

## The quick way on Windows

Take `tire-lab.exe` from the artifacts of the _Windows executable_ workflow, double-click it and open a file; or drop an `.ibt` on it. You get the chart with the overlay's model, the tires drawn as the widget draws them, the laps, and the model workbench. See [exe.md](exe.md) and [workbench.md](workbench.md). Everything below does the same from a command line.

```
git clone https://github.com/estem8/iracing-tire-lab
cd iracing-tire-lab
npm install
```

The tools run TypeScript directly; there is no build step.

## 1. See what a file contains

```
npm run tire-lab -- inspect session.ibt
```

You get the tick rate, the number of records, a session summary without personal fields, and every channel with its unit, array length and the description the sim wrote. Add `--json` for the same as data.

Check here before you rely on a channel: **not every car records every channel**. A channel that is absent from the list is absent from the file, and the lab treats it as unknown, never as zero. What is known about the tire channels is in [channels.md](channels.md).

## 2. Export the channels you want

```
npm run tire-lab -- export session.ibt \
  --channels SessionTime,Speed,LFtempCL,LFtempCM,LFtempCR \
  --stride 3 --out stint.csv
```

`--stride 3` keeps every third record (60 Hz becomes 20 Hz). Name one element of an array channel as `Name[index]`, for example `LatAccel_ST[2]`. Alongside `stint.csv` you get `stint.meta.json` with the units and a session summary, so the CSV is never separated from what its columns mean.

Floats are written as the shortest text that reads back to the exact same value, so exporting does not change a number.

## 3. Look at the channels in a browser

```
npm run tire-lab -- chart session.ibt --out chart.html
```

Open `chart.html` in any browser. It is one file with no outside requests. There is one chart per unit (so temperatures, speeds and percentages never share an axis), and every series has a tick box: untick it to hide it, `None` and `All` do it for a whole chart. Drag on a chart to zoom, double-click to reset, hover to read every visible series at that time, or focus a chart and use the arrow keys. `Table view` lists each series with its point count, missing values, min, mean and max.

Without `--channels` it plots the tire channels the file has: the middle carcass and middle surface temperature of each tire, speed, throttle and brake. Name your own with `--channels LFtempCL,LFtempCM,Speed,Shock[2]`. Files are thinned to 5000 points per series (`--max-points`, or `--stride N`; `--stride 1` plots every record), so a spike narrower than the step can fall between points. A value the file cannot give is a gap in the line, never a zero. Series in the same chart past the eighth share one grey, and the tooltip names them.

Add `--model` to draw the overlay's physics beside the recording: per tire a dashed `model … carcass` line in the colour of that tire's carcass channel and a dashed `model … tread` line in the colour of its surface channel, each with its own switch (`--car`, `--hz`, `--arrival-hz` and `--mask` work as in `sample`). The model is the overlay's estimate including its pit-stop handling (checked against the real processor on synthetic drives); it needs the `*tempC` and `*wear` channels in the file, and has no slip estimator. See `docs/extraction-plan.md`.

### Laps and the tires

```
npm run tire-lab -- laps session.ibt                          # the laps and their times
npm run tire-lab -- lapchart session.ibt --lap 5              # one lap by distance, with the model
npm run tire-lab -- lapchart session.ibt --lap 5 --compare 7  # lap 7 dashed over lap 5, and the time difference
```

With `--model` (and in lap charts) a panel above the charts draws the four tires as the overlay does, at the moment under the cursor: temperature in three zones, pressure, brake disc and tread left. Laps need the `Lap` and `LapDistPct` channels; metres are used when the file has `LapDist`. None of these channels has been seen in a real recording by this project yet.

The page has been driven in a simulated browser (toggles, hover, zoom, keyboard, table view) but not yet looked at in a real one; if the layout looks wrong in yours, please open an issue.

## 4. See what a model would be given

```
npm run tire-lab -- sample session.ibt --out input.csv
```

This writes the input stream of a model run the way the overlay runs its tire processor: frames at 20 Hz (`--arrival-hz`), ticks at 15 Hz (`--hz`), and only the channels the live SDK is known to send (`--mask live`, the default). Use `--mask all` to keep everything in the file. An empty cell means unknown. The `dt` column alternates 50 and 100 ms, as in the app.

Why both settings exist, and what is still unverified about the live set, is in the README section "Judging a model the way the overlay would run it".

## 5. Use it from your own code

The package is not on npm. Install it from a git tag, which builds the compiled JavaScript and type declarations on install (Node cannot run TypeScript from inside `node_modules`, so the sources are not importable):

```
npm install "git+https://github.com/estem8/iracing-tire-lab.git#v0.2.1"
```

That install works (it is what the irdashies experiment branch uses, and CI there runs it on Ubuntu and Windows). npm may warn that the `prepare` script is not covered by `allowScripts`; with a stricter setting the install gets no `dist`, in which case build a tarball instead: `npm run build && npm pack`.

Entry points (anything else is blocked by the package `exports`):

| Import                     | What                                                                                                           | Needs                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `iracing-tire-lab/ibt`     | read `.ibt` files, anonymize, session summary                                                                  | Node (`node:fs`)                            |
| `iracing-tire-lab/model`   | the overlay's model (`OverlayModel`), its components (`describeTuning`), the contract types and the input mask | nothing: pure, safe in a browser or overlay |
| `iracing-tire-lab/metrics` | error statistics, reference files, `score`                                                                     | nothing: pure                               |
| `iracing-tire-lab/replay`  | IBT to model input, overlay schedule, `replayModel`                                                            | Node                                        |
| `iracing-tire-lab/chart`   | build the chart page: `buildChartData`, `addModelSeries`, `renderChartHtml`                                    | Node                                        |
| `iracing-tire-lab/testing` | `buildIbt`, to make synthetic files in your tests                                                              | Node                                        |

The `tire-lab` command is installed too (`npx tire-lab inspect file.ibt`). `npm run check:package` installs the tarball into an empty project and verifies all of this.

Two runnable examples, which import from the source files because they live in this repository:

- [`examples/read-channels.ts`](../examples/read-channels.ts): open a file, list channels with units, read a scalar and an array element.
- [`examples/replay-a-model.ts`](../examples/replay-a-model.ts): replay a model on the overlay's frame schedule with the live mask. The model in it is a smoothing filter that only shows the API.

Run either with `node examples/<name>.ts`. They build a small synthetic file, so they need no recording. To try your own file, replace the file path they create.

## 6. Share a file safely

An `.ibt` contains your name, user id, iRating and the names of the other drivers in the session. Do not post it. Share the CSV and its `.meta.json` instead.

If you must share the raw file, `tire-lab anonymize in.ibt out.ibt` blanks the fields it knows about, but it is best effort and has not been checked on a real recording, so do not rely on it. It does not touch the session date, track, car or lap times, which can identify a session. Read the result before sharing it with `tire-lab inspect out.ibt --session`, which prints the full session text (plain `inspect` shows only a summary without personal fields, so it cannot tell you what is left). See [recording-protocol.md](recording-protocol.md).
