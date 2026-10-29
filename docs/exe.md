# The Windows program (`tire-lab.exe`)

One file, no Node and no install. It is built by the **Windows executable** workflow (`.github/workflows/exe.yml`) and kept as a build artifact; nothing is published from it.

## Use

- **Double-click it.** A console window opens and so does a page in your browser with three things:
  - **Open .ibt file…** — a file dialog (it starts in `Documents\iRacing\telemetry`), or paste a path. The chart opens in a new tab: the recorded channels and, as dashed lines, the overlay's tire model. If the file lacks the `*tempC` and `*wear` channels of a tire, the chart has no model lines and says why.
  - **iRacing** — whether the simulator is running, and a switch **Record telemetry in iRacing**. It sends iRacing the same command as its own recording key. iRacing records only while you are in the car, and the page cannot read back whether it is recording: it shows the last command it sent. Start the switch before you drive, stop it after.
  - **Quit**.
- **Drop an `.ibt` file on the program** (or on its icon). It writes `<file>.tire-lab.html` next to the recording and opens it. No page, no server.
- **From a console** every command of the CLI works: `tire-lab.exe inspect file.ibt`, `chart`, `score`, `sample`, `anonymize`, plus `view`, `app` and `telemetry on|off`.

## What it is and is not

- The page runs on your computer only: the server listens on 127.0.0.1, every request needs a random token that is in the address the program opened, other sites cannot reach it, and nothing is sent anywhere.
- The program is **not signed**. Windows SmartScreen will say "unknown publisher" the first time; antivirus programs sometimes dislike self-extracting programs like this one. The checksum of each build is next to it (`tire-lab.exe.sha256`). If you do not trust a build, run the CLI from source (see getting-started) instead.
- The telemetry switch uses the iRacing SDK's own broadcast message (message 10, start 1 / stop 0, from `irsdk_defines.h`). The build checks that the command is sent without error on a machine with no simulator. **It has not been tried against a running iRacing**; if the switch does nothing, tell us what iRacing showed.
- The file dialog needs a desktop and is tested only for the script's syntax. A path pasted into the page works the same.

## Build it yourself

```
npm ci
npm run build:exe        # dist-exe/tire-lab(.exe), a copy of Node with the program inside (about 120 MB)
```

It makes a program for the system it runs on.
