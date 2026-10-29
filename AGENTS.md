# Notes for coding agents

- Node >= 24 runs the TypeScript directly. No build step, no runtime dependencies. Imports use `.ts` extensions; no `enum`, no parameter properties (`erasableSyntaxOnly`).
- Test: `npm test`. Types: `npm run typecheck`. Format: `npm run format:check`.
- Never add or commit `.ibt`, `.irdt` or any real recording. Fixtures are built with `src/ibt/testBuilder.ts`.
- `src/model/` must stay pure: relative imports only. `tests/boundary.test.ts` checks it.
- Do not invent channel names, units or semantics. If it is not in `channels/channels.yaml` as `verified`, say it is unverified and ask for a real file.
- Do not claim the model reproduces iRacing's tire physics. It is an empirical approximation, judged by error on recordings it was not fitted to.
- Parts of `src/ibt/` are adapted from irdashies (MIT); keep the provenance headers and `NOTICE`.
