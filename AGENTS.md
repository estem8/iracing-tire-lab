# Notes for coding agents

- Node >= 24 runs the TypeScript directly in development (no build step to run tests or the CLI), and there are no runtime dependencies. Imports use `.ts` extensions; no `enum`, no parameter properties (`erasableSyntaxOnly`).
- Package: `npm run build` emits `dist/` (JS + types; Node cannot strip types under `node_modules`). `npm run check:package` installs the tarball into an empty project; run it when you change `exports` or entry points. Consumers can only import `./ibt`, `./model`, `./replay`, `./chart`, `./testing`.
- The chart page's script (`src/chart/client.ts`) is one string embedded verbatim: no backticks, no dollar-brace, no closing script tag, no `innerHTML` (a test checks); channel names are untrusted, so use `textContent`. Its behaviour is exercised only in a simulated DOM, so say so if you change the layout and have not looked at it in a browser.
- Test: `npm test`. Types: `npm run typecheck`. Format: `npm run format:check`.
- Never add or commit `.ibt`, `.irdt` or any real recording. Fixtures are built with `src/ibt/testBuilder.ts`.
- `src/model/` must stay pure: relative imports only. `tests/boundary.test.ts` checks it.
- Do not invent channel names, units or semantics. If it is not in `channels/channels.yaml` as `verified`, say it is unverified and ask for a real file.
- Do not claim the model reproduces iRacing's tire physics. It is an empirical approximation, judged by error on recordings it was not fitted to.
- Parts of `src/ibt/` are adapted from irdashies (MIT); keep the provenance headers and `NOTICE`.
