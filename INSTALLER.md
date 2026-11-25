# Installer download

The Windows installer is hosted as a GitHub Release asset because it (124.8 MiB)
exceeds GitHub's 100 MiB limit for files stored directly in Git.

- **Download:** [Main_Exe_Dexerion.exe](https://github.com/DarrelX4739/Dexerion_Source/releases/download/v1.0.0/Main_Exe_Dexerion.exe)
- **Expected hashes:** [`installer/FINAL_HASHES.txt`](installer/FINAL_HASHES.txt)

The original installer file remains on the local machine; only this link and the
hash file are stored in the repository.

## Build and publish a new release (manual only)

The **Build installers and publish release** GitHub Actions workflow builds from
this repository's existing Electron application and Windows NSIS configuration.
It does not run on pushes, pull requests, or tag creation.

1. Merge `.github/workflows/release.yml` into the default branch so GitHub displays
   the **Run workflow** button.
2. Open **Actions → Build installers and publish release → Run workflow**.
3. Select the branch containing the code to release and enter a new version such
   as `1.2.3` (or `v1.2.3`). Test versions such as `v1.0.0_buildtest` and
   `1.2.3-beta.1` are also supported. Existing tags/releases are rejected.
4. Run the workflow. After both platform builds succeed, it creates and publishes
   a GitHub Release tagged `v1.2.3` at the selected run's source commit, containing:
   - `Main_Exe_Dexerion.exe` — Windows x64 NSIS installer, with the existing branding.
   - `Dexerion-1.2.3-x64.AppImage` — Linux x64 AppImage.
   - `Dexerion-1.2.3-x64.deb` — Linux x64 Debian package.
   - `SHA256SUMS.txt` — SHA-256 checksums for all three packages.

### Test versions and prereleases

An optional leading `v` is accepted; release tags always have one. A suffix can
start with `_` or `-`, followed by dot-separated identifiers containing letters,
numbers, or hyphens. Core version numbers and purely numeric suffix identifiers
must not have leading zeros. Spaces, additional underscores, and `+` build
metadata are not supported.

For example, entering `v1.0.0_buildtest` produces:

- Release tag/title: `v1.0.0_buildtest` / `Dexerion v1.0.0_buildtest`.
- Embedded application version: `1.0.0-buildtest` (valid SemVer for packaging).
- Linux packages: `Dexerion-1.0.0-buildtest-x64.AppImage` and
  `Dexerion-1.0.0-buildtest-x64.deb`; the Windows filename stays unchanged.
- A GitHub **prerelease**, explicitly not marked as the latest stable release.

Hyphenated suffixes such as `v1.0.0-beta.1` also produce prereleases. Unsuffixed
versions continue to produce normal releases. Tags retain the chosen suffix
separator, so `_buildtest` and `-buildtest` are distinct tags even though they map
to the same package version; use one spelling consistently to avoid duplicates.

The package version is embedded in the built application using a temporary CI
configuration; no source files, package manifests, lockfiles, or existing builder
settings are committed or modified by the workflow. Build artifacts are also kept
on the workflow run for seven days. Release assets remain on the GitHub Release.
The existing `v1.0.0` download and historical hash file above are not updated.

Publishing uses the automatic `GITHUB_TOKEN`; no personal access token or signing
secret is required. The release job requests `contents: write` (repository or
organization policies must allow it). Builds are **unsigned** and may trigger
Windows SmartScreen warnings. Linux packaging does not certify Linux runtime
compatibility; test the packages on your target distributions before distribution.
For an AppImage, make it executable with `chmod +x Dexerion-*.AppImage` before
launching; the host may also require FUSE support.

Assets are uploaded to a draft before the release is published. If publishing
fails after draft creation, check the draft and its assets before publishing it
manually, or delete the draft and any tag it created before retrying that version.
