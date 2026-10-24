# KitsuFlow Voice Companion — desktopapp branch

This branch contains only the desktop GUI companion and its Windows x64 / Linux AMD64 packaging. The KitsuFlowBOT dashboard/server, linked streaming platforms and device-pairing API remain on `main`.

Download compiled GUI executables from [GitHub Actions](https://github.com/NekoSuneProjects/KitsuFlowBOT/actions/workflows/voice-companion-build.yml?query=branch%3Adesktopapp). No Python installation or console use is needed for downloaded builds. The application reads and writes a local `.env` file and provides a graphical microphone picker, start/stop controls, connectivity information and clip history.

See [Desktop quick start](voice-companion/QUICKSTART.md) and [app source](voice-companion/companion.py). Install an offline Vosk language model separately; it is not bundled.

Twitch uses the dashboard's official native clipping API. Kick and VPZone currently report unsupported until a verified native clip API becomes available.
