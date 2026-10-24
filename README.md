# KitsuFlow Voice Companion — desktopapp branch

This branch contains only the desktop GUI companion and its Windows x64 / Linux AMD64 packaging. The KitsuFlowBOT dashboard/server, linked streaming platforms and device-pairing API remain on `main`.

Download compiled GUI executables from [GitHub Actions](https://github.com/NekoSuneProjects/KitsuFlowBOT/actions/workflows/voice-companion-build.yml?query=branch%3Adesktopapp). No Python installation or console use is needed for downloaded builds. The application reads and writes a local `.env` file and provides a graphical microphone picker, start/stop controls, connectivity information and clip history.

See [Desktop quick start](voice-companion/QUICKSTART.md) and [app source](voice-companion/companion.py). Install an offline Vosk language model separately; it is not bundled.

Twitch uses the dashboard's official native clipping API. Kick and VPZone currently report unsupported until a verified native clip API becomes available.

## Versioned GitHub Releases

Each new `desktopapp-vMAJOR.MINOR.PATCH` Git tag triggers the desktop build workflow for both platforms and publishes a GitHub Release with:

- `KitsuFlowVoiceCompanion-desktopapp-v1.0.0-windows-x64.zip` (Windows GUI executable and .env template)
- `KitsuFlowVoiceCompanion-desktopapp-v1.0.0-linux-amd64.zip` (Linux GUI executable and .env template)
- `SHA256SUMS.txt` for ZIP checksums

Replace `1.0.0` with the chosen release version. Example, after updating `desktopapp`:

```bash
git checkout desktopapp
git pull origin desktopapp
git tag desktopapp-v1.0.0
git push origin desktopapp-v1.0.0
```

The workflow only publishes a release after **both** platform builds succeed and verifies that the tag targets a commit on `desktopapp`. Normal commits continue to build Actions artifacts without flooding the Releases page. Versioned assets appear at [GitHub Releases](https://github.com/NekoSuneProjects/KitsuFlowBOT/releases). Pre-release suffixes such as `desktopapp-v1.1.0-beta.1` are supported.

Release publishing requires Actions to have permission to create releases with `GITHUB_TOKEN`. The workflow requests `contents: write` specifically for the publishing job. If repository policy blocks tag-triggered workflows or release writes, update repository Actions permissions.
