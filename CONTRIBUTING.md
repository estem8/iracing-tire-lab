# Contributing

Four ways to help, from least to most work.

## 1. Report a mismatch

Open an issue with the "Does not match the game" form. Say which car and track, which number (cockpit readout, live channel or `.ibt`), and what you saw.

## 2. Share a recording

Follow [docs/recording-protocol.md](docs/recording-protocol.md). Never commit an `.ibt`: `.gitignore` blocks it, and CI will reject one. By submitting an export you agree it may be published under CC-BY 4.0. Check iRacing's terms for what you may share; the maintainers have not yet reviewed them, so this repository does not host recordings until that is settled.

## 3. Clarify a channel

Edit `channels/channels.yaml`. Evidence is the output of `inspect --json` for that channel from a real file, with the car and session type. Use what the file says; do not guess units. Mark anything you could not see as `unverified`. Then run `npm run docs` and commit the regenerated `docs/channels.md`; a test fails if it is out of date.

## 4. Change code

- `src/ibt/` reads files, `src/cli/` is the command line, `src/app/` is the local app and the Windows program, `src/chart/` draws, `src/metrics/` measures error, `src/model/` is the pure model.
- `src/model/` imports nothing outside itself: no `node:*`, no UI, no reader (a test enforces this).
- Run `npm test` and `npm run typecheck` before opening a PR. Tests use `node --test` and synthetic files built by `src/ibt/testBuilder.ts`.
- A model change comes with a before/after error table from `tire-lab score` on recordings the change was not fitted to; error on those must not get worse. Without real recordings, say so. A change to the model's default constants breaks `tests/overlay-equivalence.test.ts` on purpose: it pins the model to what the overlay does today, so a deliberate change goes with a new `MODEL_VERSION` in the overlay and a regenerated golden file, explained in the pull request.
- Keep measured and estimated values apart. Unknown is `null`, never `0`.

AI coding agents: read [AGENTS.md](AGENTS.md).
