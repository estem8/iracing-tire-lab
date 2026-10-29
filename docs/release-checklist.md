# Release checklist

Two separate steps, each with its own checks: **opening the repository** (making it public) and **publishing to npm**. The first does not require the second.

The repository was made public on 2026-10-29 with the items below still open: they now apply to a public repository. Checked boxes were verified on 2026-10-29; the rest are open. Re-check a checked item if the repository changed since, especially the personal-data scan.

## Decisions for the maintainer

- [ ] **iRacing's terms.** May telemetry and exports be published? Not read yet. Until this is settled the repository takes no recordings (see CONTRIBUTING.md). The reader code can be opened before any data is.
- [ ] **Licence of contributed data.** CONTRIBUTING.md proposes CC-BY 4.0. Confirm or replace.
- [ ] **Copyright holder.** `LICENSE` names "iracing-tire-lab contributors". Use a person's name instead?
- [ ] **npm package name.** Is `iracing-tire-lab` free? Not checked. If not, use a scope (for example `@owner/iracing-tire-lab`) and update every import in the docs and in `scripts/checkPackage.ts`.
- [ ] **irdashies maintainer.** The reader is adapted from irdashies (MIT, credited in `NOTICE`), which is legally enough. Since the model is meant to return to that project, tell its maintainer about the separate repository first.

## Before the repository is opened

- [x] **CI is on `main` and green** (run on commit `ea1505c`, Ubuntu, Node 24). It runs format check, typecheck, tests, `check:package` and the no-recordings check; every step passed.
- [ ] **Run on a real recording.** `inspect`, `export`, `sample` and `anonymize` have only been run on synthetic files. Compare the channel list and units with `channels/channels.yaml`, promote what is seen to `verified`, and run `npm run docs`.
- [ ] **Check `anonymize` on a real file.** Read the whole result with `inspect <file> --session` (plain `inspect` shows only a summary, so it cannot show what is left) and confirm no names or ids remain, including other drivers in the session. The redaction list comes from irdashies' code, not from the full YAML a real file contains.
- [ ] **Run on a real Windows desktop.** CI runs the built program on a Windows runner (inspect, a dropped file, the app's self-test, the telemetry command with no sim running). Not tried: the file dialog on a desktop, the browser opening, and the telemetry switch against a running iRacing.
- [x] `SECURITY.md` added. It points to GitHub's private report and, if that is missing, to a contentless issue asking for a private channel.
- [x] Private vulnerability reporting enabled when the repository was made public on 2026-10-29 (it is not available while private).
- [ ] Optionally add `CODE_OF_CONDUCT.md`.
- [x] Repository topics set: `iracing`, `telemetry`, `ibt`, `overlay`, `sim-racing`, `tires`, `typescript`.
- [x] **README status is honest** (rewritten 2026-10-30): it says the model exists and the code is checked against the overlay's processor on synthetic drives, and that no real recording has been read. Re-check it whenever either changes.
- [ ] **Protect `main`**: require CI, decide who reviews pull requests.
- [x] Git history has a single author, a GitHub no-reply address.
- [x] No personal strings (name, email) in tracked files.
- [x] No `.ibt` or `.irdt` files and nothing over 100 KB is tracked; `.gitignore` blocks recordings.
- [x] `LICENSE` is MIT and recognised by GitHub; `NOTICE` carries the irdashies licence.
- [x] Issues are on, the wiki is off, issue and pull request templates exist.

## Before publishing to npm

- [ ] **Remove `"private": true`** and decide the version (it is `0.2.1` and tagged; the tags exist whether or not it is published). While it is set, `npm publish` is refused, which is the intended safeguard.
- [x] **Install from a git tag** works (`git+https://github.com/estem8/iracing-tire-lab.git#v0.2.1`; run in an empty project, and by `npm ci` in irdashies' CI on Ubuntu and Windows). npm warns that `prepare` is not covered by `allowScripts`; a stricter setting may block it, so the tarball stays the fallback.
- [ ] **Choose `engines`.** It says `node >=24`. Whether the compiled output runs on older versions is untested; find the Node version of irdashies' Electron.
- [ ] **Add `CHANGELOG.md`** and state the rule while the version is `0.x` (the API may change).
- [ ] **Decide what is stable.** `/ibt` and `/testing` are fairly settled. `/model` (the overlay's model, its component registry and the contract types) and `/metrics` are new and will change; either publish only `/ibt` and `/replay`, or say plainly that `/model` and `/metrics` will change.
- [x] `npm run check:package` passes in CI (same run as above).
- [ ] **`npm publish --dry-run`** shows only `dist/`, `LICENSE`, `NOTICE`, `README.md` and `package.json`. Not run: it needs `"private"` removed first. (`check:package` already verifies the same file list through `npm pack`.)
- [ ] **Two-factor authentication** on the npm account, and a token that can only publish.
- [x] `npm run check:package` passes locally: tarball contents, `dist/model` imports only relative paths, a consumer typechecks and runs, deep imports are blocked, the `tire-lab` command works.

## Do not do before publishing

- Do not add recordings or exports to the repository until the first decision above is settled.
- Do not publish a model before it has been run against real recordings. It has not, and the contract may change.
- Do not attach `tire-lab.exe` to a public release before someone has tried the file dialog and the recording switch on a real PC with iRacing, and the unsigned-program warning is explained in the release notes.
