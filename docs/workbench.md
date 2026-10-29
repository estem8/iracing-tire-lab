# The model workbench

Open a recording in the app, then **Open the workbench**. It answers: what is the overlay's tire estimate made of, and what happens to it if a part is removed or a number changed?

## What you see

- **Left:** the channels of the recording (tick the ones to chart; the defaults are the tire temperatures and the signals that drive the heat), then the **components** of the model. Each one says
  - _what_ it is,
  - _how_ it is computed (the formula in words),
  - _which channels it reads_, with a tick if the file has the channel and a cross if it does not,
  - its **numbers**, each with a description and the overlay's default.
- **A switch** on a component turns it off by setting its heat coefficients to zero. **A number** can be typed over; a changed number is marked. **Reset everything** goes back to the overlay's own.
- **Right:** the chart. Solid lines are the recording, **dotted lines the unchanged model**, **dashed lines the model as changed**. Above the chart a table gives, per tire, how far the changed model is from the unchanged one (mean, largest and last difference in degrees C). The tires panel shows the changed model.

## Which model is the number

The overlay has two models. A default GT3 shows the **surface model's bulk node**: its load, cornering, braking, traction, sliding, bulk-heat and cooling components decide the number. The Cadillac and cars with their own entry show the **slow thermal model**: use the components named _Slow model_. The page says which applies to the open car. The other model still runs; it matters for calibration at pit stops, not for what is shown.

## Limits, said plainly

- It shows how the **overlay's estimate** responds. It does not say what iRacing's tires do. The constants are the overlay's fit to a few cars and tracks.
- A component reads channels. If the file lacks them (a cross in the list) the component has nothing to work with and switching it off changes nothing. The `.ibt` of a car may not record every channel the model uses.
- **Wheelspin heat does nothing on a recording**: it needs the overlay's slip estimator (engine speed and gear against road speed), which is not in the lab.
- The model is run again on the whole recording at the overlay's rate (20 Hz arrival, 15 Hz tick) every time you change something; a long recording takes a moment.
- Changing a number is an experiment, not a fit. Nothing is saved, and nothing is sent to the overlay.
