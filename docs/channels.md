<!-- Generated from channels/channels.yaml by `npm run docs`. Do not edit. -->

# Telemetry channels

What the lab knows about the iRacing telemetry channels relevant to tire state, and how well it knows it.

- **Verified**: the name, unit and description were seen in a real variable table. This does not mean the update behaviour is known; see that column.
- **Unverified**: the channel is used by other software, but the lab has not yet seen it in a real file. Do not rely on its name, unit or availability.

Carcass temperature and tread surface temperature are different quantities and are never interchangeable.

To add or promote a channel, see [CONTRIBUTING.md](../CONTRIBUTING.md): edit `channels/channels.yaml` with evidence from `inspect --json` of a real file, then run `npm run docs`.

## Verified (9)

| Channel | Meaning | Unit | Update behaviour | Evidence |
| --- | --- | --- | --- | --- |
| `{LF,RF,LR,RR}tempC{L,M,R}` | Carcass temperature, left / middle / right zone. Not the surface temperature. | C | unknown. irdashies' TireProcessor comment says the live value only refreshes when a pit stop begins; no recording in this repo shows it yet. | irdashies src/app/irsdk/node/utils/mock-data/telemetry.json (live SDK dump) |
| `{LF,RF,LR,RR}wear{L,M,R}` | Tread remaining per zone. | % (label only: the values are a 0..1 fraction) | unknown | same dump; e.g. LFwearL = 0.937 |
| `{LF,RF,LR,RR}coldPressure` | Cold pressure as set in the garage. Not a live pressure. | kPa | unknown | same dump |
| `dp{LF,RF,LR,RR}TireColdPress` | Pit-stop cold pressure adjustment. | Pa | unknown | same dump. Note Pa, while coldPressure is kPa. |
| `PitSvFlags` | Bitfield of pit service checkboxes (tire change bits 0x1 LF, 0x2 RF, 0x4 LR, 0x8 RR per irdashies). | irsdk_PitSvFlags | unknown | same dump for name and type; bit meaning from irdashies, not re-checked here |
| `SessionTime` | Seconds since session start. | s | 60 Hz in the dump's header (tickRate) | same dump |
| `Speed` | GPS vehicle speed. | m/s | unknown | same dump |
| `TrackTempCrew, AirTemp` | Track temperature measured by the crew; air temperature at start/finish. | C | unknown | same dump (TrackTemp is deprecated and mirrors TrackTempCrew) |
| `LatAccel, LongAccel, VertAccel, YawRate, SteeringWheelAngle` | Chassis dynamics. Accelerations include gravity. | m/s^2, rad/s, rad | Each also has a 360 Hz *_ST array form (count 6) | same dump |

## Unverified (2)

| Channel | Meaning | Unit | Update behaviour | Evidence |
| --- | --- | --- | --- | --- |
| `{LF,RF,LR,RR}temp{L,M,R}` | Tread surface temperature, per zone. | unknown | unknown | read from .ibt by irdashies tools/tire-viewer/replay.ts; absent from the live dump |
| `{LF,RF,LR,RR}pressure` | Hot pressure. | unknown | unknown | read by irdashies TireProcessor; absent from the live dump |
