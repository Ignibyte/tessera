# Releasing Tessera

A release is a tag `v<version>` on `main` and a GitHub release on this repo with the
twelve files of `README.md`'s "Using a release" and `SHA256SUMS`. Nothing is published to npm.

## On a branch

1. Set the version: `npm version <version> --no-git-tag-version` (updates `package.json` and
   `package-lock.json`), and the same string in `src/version.ts`. The unit tests check that the
   two agree.
2. In `CHANGELOG.md`, rename `## Unreleased` to `## <version> (<date>)` and start a new, empty
   `## Unreleased` above it. Name the known issues the release ships with.
3. Run the gates one at a time and judge each by its exit code, never by piped output:
   `npm run check`, then `npm run build` and `npm run test:browser`, then
   `npm run test:browser:webkit`. Each exits 0, or there is no release.
4. Commit, open the PR, and merge it as `CLAUDE.md` says.

## On main

```bash
git switch main && git pull --ff-only
npm ci
npm run build && npm run sums
(cd dist && sha256sum -c SHA256SUMS)
git tag -a v<version> -m "Tessera <version>"
git push origin v<version>
gh release create v<version> --title "Tessera <version>" --notes-file <notes> \
  dist/tessera.js dist/tessera.js.map dist/tessera.min.js dist/tessera.min.js.map \
  dist/tessera.iife.js dist/tessera.iife.js.map dist/tessera.csp.js dist/tessera.csp.js.map \
  dist/tessera.csp.min.js dist/tessera.csp.min.js.map dist/tessera.csp.iife.js \
  dist/tessera.csp.iife.js.map dist/SHA256SUMS
```

The notes are the version's section of `CHANGELOG.md`, plus the `SHA256SUMS` lines.

## Check what was published

Download the release into an empty directory and check every file against its sum:

```bash
gh release download v<version> --dir <empty directory>
cd <empty directory> && sha256sum -c SHA256SUMS
```

All twelve must say `OK`. A mismatch means the release is wrong: delete it and the tag, find out
why, and cut it again.
