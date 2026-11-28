# Branded installer tooling

This branch holds the installer presentation and build helpers. The release
workflow pins a reviewed commit from this branch and packages the exact
application commit being built; it does not merge the app source on this
branch into `main`.

## Update the look

- Windows: edit `code/build/installer/branded/Setup.xaml` for the layout,
  theme, logo placement and controls, and `Setup.cs` only for wizard
  presentation. Keep `SetupEngine.cs` and the stock NSIS backend unchanged
  for visual-only work.
- Linux: edit `.github/packaging/linux-installer/style.css` and the
  adjoining HTML/renderer files. Keep the original logo, the common Setup
  steps and the matching layout and contrast across platforms. Neither
  installer should draw imitations of OS permission/security prompts.
- Keep Windows and Linux visual changes in the same reviewed tooling commit.
  Exercise keyboard focus, folder navigation, cancellation, the launch choice,
  and normal and scaled display geometries without installing into a real
  profile.

## Validate and roll forward

1. Run the Windows branded payload-free preview and the Linux installer checks.
2. Update `INSTALLER_TOOLING_SHA` in the validation workflow to the complete
   tooling commit SHA and run both hosted build jobs on the validation branch.
3. Check both artifact manifests and checksums, and test installation and
   upgrade/uninstall on disposable Windows and Linux systems before distributing.
4. On `main`, update only the workflow pin after the validation succeeds.
   An earlier reviewed SHA can be restored without touching app code.

GitHub Actions stores downloadable artifacts for 14 days. It does not create
tags, public releases, or install anything on a developer's computer. Download
the artifact appropriate for your OS from the relevant workflow run. Mark the
Linux `.run` artifact executable after downloading if extraction strips its mode.
