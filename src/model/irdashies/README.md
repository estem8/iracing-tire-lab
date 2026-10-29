# Vendored from irdashies

These five files are copies of the tire physics in irdashies (`feat/tire-widget`, MIT, see `NOTICE`), pinned in `PROVENANCE.json`. They are not part of the package's public API yet: nothing in `src/model/index.ts` exports them and they do not implement the `TireModel` contract.

**Do not edit them here.** `tests/vendor.test.ts` fails if a copy differs from what the last vendoring wrote. To change one, change it upstream, then:

```
node scripts/vendorIrdashies.ts --source <irdashies checkout> --commit <40-hex sha> --write
node scripts/vendorIrdashies.ts --source <irdashies checkout> --commit <40-hex sha> --check   # drift report
```

The only changes made to the upstream text are listed in `transform()` in `scripts/vendorIrdashies.ts`: the shared type comes from `../types.ts`, relative imports gain `.ts`, one constructor parameter property becomes a field, and a header names the source. Anything else that would not run here makes the script stop.

What is not here, on purpose: `TireProcessor` (the glue), the calibration store (`electron`, `fs`), the slip estimator, and the temporary diagnostics. See `docs/extraction-plan.md`.
