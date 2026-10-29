# Recording protocol

One stint is enough to be useful. The point is to capture what the game shows at the same moment as the telemetry.

1. Enable disk telemetry in iRacing (it writes an `.ibt` per session).
2. Drive one car on one track: out lap, three timed laps, one pit stop with a tire change, two more laps.
3. At the end of the first timed lap and again before the pit stop, take a screenshot of the cockpit tire readout with the current time visible. Note which car it is: some cars show the tread surface on the dash, others the carcass.
4. Write down: car, track, weather in the garage, tire compound, cold pressures.
5. Run `npm run tire-lab -- inspect your.ibt` and check the tire channels you expect are listed. If a channel is missing, say so in the submission: that is data too.
6. Export only what is needed:
   `npm run tire-lab -- export your.ibt --channels SessionTime,Speed,LFtempCL,... --stride 3 --out stint.csv`
   This also writes `stint.meta.json` with the car, track and weather, and no personal fields.

Do not share the raw `.ibt`. It holds your name, user id, iRating and the names of other drivers. If a maintainer asks for the raw file, `tire-lab anonymize in.ibt out.ibt` blanks the personal fields it knows about, but it is best effort and not yet verified on a real recording: read the whole result with `tire-lab inspect out.ibt --session` before sending it. It does not remove the session date, track, car or lap times.
