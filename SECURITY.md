# Security policy

## Reporting a vulnerability

Please do not open a public issue with the details.

1. Use GitHub's private report: on the repository's **Security** tab choose **Report a vulnerability** (or go to `https://github.com/estem8/iracing-tire-lab/security/advisories/new`).
2. If that button is not there, open an ordinary issue titled "Security contact request" with **no details**, and a maintainer will arrange a private channel.

This is a small project maintained on a best-effort basis. There is no guaranteed response time.

## What counts

This tool reads files you may have received from other people, and it is meant to remove personal data from them, so these matter:

- A crafted `.ibt` that makes the reader crash, hang, read outside its buffers or use unbounded memory. The reader bounds every size taken from the header and checks it against the file, but it has not been fuzzed.
- `tire-lab anonymize` leaving a name, user id, iRating or similar in a file it says it redacted. Treat this as a privacy vulnerability.
- A flaw in the build, package or CI setup that could let someone ship altered code.

Not in scope: how accurate the tire model is, and anything in iRacing itself.

## Supported versions

Only the latest commit on `main` and, once there is one, the latest release. The package is at `0.x` and is not yet published.
