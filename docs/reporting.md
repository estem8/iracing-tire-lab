# Reporting a problem

Found a tire value that does not match the game, a channel with the wrong unit, laps that are wrong, or a failure? The app can build a report that someone else can replay.

## For the person with the problem

1. Open your recording in the app ([exe.md](exe.md)), then use **Report a problem** on the first page.
2. Say what is wrong, the **session time** of the moment (read it off a chart, or pick the start of a lap), and what the game showed then (for example the cockpit readout of the left front: 83 °C). Add a note if it helps. Do not put names or other personal details in the note.
3. **Show what will be saved.** You see every item of the report except the long series of numbers, which is described: the car and track, the channels listed one by one, your values and note, the workbench settings. The size is shown. **Save** writes exactly the bytes you previewed; if anything changed in between (the form, or a workbench run), it refuses and asks you to preview again.
4. **Save the report.** It is a `.json.gz` file written next to your recording. Nothing is sent anywhere.
5. Open the issue form (a button after saving) and attach the file. The form is pre-filled with the car, the track and your values.

If you have used the model workbench, its last settings can travel with the report (a tick box). A report to say "the model does not match the game" is most useful with a reading from the cockpit and the time you read it.

## What is in the report, and why

- **The run, from the start of the session to the moment (plus ten seconds), at 15 Hz, as numbers:** speed, the car's accelerations, pedals, steering, yaw, air and track temperature, flags, and per tire the three carcass readings, the three tread readings, pressures and shock travel. The temperature the model gives at a moment depends on the whole run before it (the tires warm up), so a short window would not reproduce it.
- The car, track and weather the recording names, the tool versions, and the list of the file's channels with their units (so a missing channel can be seen).
- What you typed: the moment, the game values, the note.
- What the unchanged model said at the moment, in your app.

**Not in it:** driver names, user and team ids, iRating, licence, other drivers, the rest of the session text, the file path, the recording itself, and any date inside the file (the file name carries the date and time you saved it). Only the fields listed above are taken from the session text, by name; a test puts names, ids and iRating into a recording's session text and checks none of them reaches the report.

**In it, and personal enough to think about:** the car, track, track length and temperatures as the recording names them, the list of the file's channels with the sim's descriptions, and the run itself. The run shows how you drove (speed, steering and pedals over time), so to someone who knows the track it can identify a session. Read the preview and decide. Check iRacing's terms before you publish anything derived from your telemetry; this project has not reviewed them.

A one-hour run is about one to four megabytes compressed (measured on synthetic data of that size; real noise may make it larger).

## For the person who gets a report

```
npm run tire-lab -- replay-report tire-lab-report-….json.gz
```

It rebuilds the model's inputs from the file, runs the same model again, and prints what the model says at the moment beside what the reporter saw, with and without their workbench settings. It also prints how far this run is from the one in the report; a few hundredths of a degree is the rounding of the inputs, and a large gap means the lab versions differ (the report carries `lab` and `modelVersion`).

The replay cannot say who is right. A cockpit value is a reading you trust or do not; a mismatch becomes a test by adding the report's numbers to the reference tests, once the sender has agreed to publish them.
