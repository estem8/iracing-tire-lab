# Release checklist

Two separate steps, each with its own checks: **opening the repository** (making it public) and **publishing to npm**. The first does not require the second.

Checked boxes were verified on 2026-10-29; the rest are open. Re-check a checked item if the repository changed since, especially the personal-data scan.

## Decisions for the maintainer

- [ ] **iRacing's terms.** May telemetry and exports be published? Not read yet. Until this is settled the repository takes no recordings (see CONTRIBUTING.md). The reader code can be opened before any data is.
- [ ] **Licence of contributed data.** CONTRIBUTING.md proposes CC-BY 4.0. Confirm or replace.
- [ ] **Copyright holder.** `LICENSE` names "iracing-tire-lab contributors". Use a person's name instead?
- [ ] **npm package name.** Is `iracing-tire-lab` free? Not checked. If not, use a scope (for example `@owner/iracing-tire-lab`) and update every import in the docs and in `scripts/checkPackage.ts`.
- [ ] **irdashies maintainer.** The reader is adapted from irdashies (MIT, credited in `NOTICE`), which is legally enough. Since the model is meant to return to that project, tell its maintainer about the separate repository first.

## Before the repository is opened

- [x] **CI is on `main` and green** (run on commit `ea1505c`, Ubuntu, Node 24). It runs format check, typecheck, tests, `check:package` and the no-recordings check; every step passed.
- [ ] **Run on a real recording.** `inspect`, `export`, `sample` and `anonymize` have only been run on synthetic files. Compare the channel list and units with `channels/channels.yaml`, promote what is seen to `verified`, and run `npm run docs`.
- [ ] **Check `anonymize` on a real file.** Open the result and confirm no names or ids remain, including other drivers in the session. The redaction list comes from irdashies' code, not from the full YAML a real file contains.
- [ ] **Run on Windows.** The CLI and file reading have only been run on Linux.
- [x] `SECURITY.md` added. It points to GitHub's private report and, if that is missing, to a contentless issue asking for a private channel.
- [ ] **Enable private vulnerability reporting** (Settings, Code security) once the repository is public. It is not available while the repository is private (the API answers 404), so the first route in `SECURITY.md` does not work until then.
- [ ] Optionally add `CODE_OF_CONDUCT.md`.
- [x] Repository topics set: `iracing`, `telemetry`, `ibt`, `overlay`, `sim-racing`, `tires`, `typescript`.
- [ ] **README status is still honest.** "Scaffold, no model yet" stays until a model exists.
- [ ] **Protect `main`**: require CI, decide who reviews pull requests.
- [x] Git history has a single author, a GitHub no-reply address.
- [x] No personal strings (name, email) in tracked files.
- [x] No `.ibt` or `.irdt` files and nothing over 100 KB is tracked; `.gitignore` blocks recordings.
- [x] `LICENSE` is MIT and recognised by GitHub; `NOTICE` carries the irdashies licence.
- [x] Issues are on, the wiki is off, issue and pull request templates exist.

## Before publishing to npm

- [ ] **Remove `"private": true`** and raise the version from `0.0.0`. While it is set, `npm publish` is refused, which is the intended safeguard.
- [ ] **Install from a git tag** works. The `prepare` script builds on such an install but it has not been tried; either test it or document only the tarball.
- [ ] **Choose `engines`.** It says `node >=24`. Whether the compiled output runs on older versions is untested; find the Node version of irdashies' Electron.
- [ ] **Add `CHANGELOG.md`** and state the rule while the version is `0.x` (the API may change).
- [ ] **Decide what is stable.** `/ibt` and `/testing` are fairly settled. `/model` is marked PROVISIONAL; either publish only `/ibt` and `/replay`, or say plainly that `/model` will change.
- [x] `npm run check:package` passes in CI (same run as above).
- [ ] **`npm publish --dry-run`** shows only `dist/`, `LICENSE`, `NOTICE`, `README.md` and `package.json`. Not run: it needs `"private"` removed first. (`check:package` already verifies the same file list through `npm pack`.)
- [ ] **Two-factor authentication** on the npm account, and a token that can only publish.
- [x] `npm run check:package` passes locally: tarball contents, `dist/model` imports only relative paths, a consumer typechecks and runs, deep imports are blocked, the `tire-lab` command works.

## Do not do before publishing

- Do not add recordings or exports to the repository until the first decision above is settled.
- Do not publish a model before it has been run against real recordings. There is none yet, and the contract may change.
