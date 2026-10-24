# KitsuFlow Voice Companion

Standalone desktop companion for Windows x64 and Linux AMD64. Recognises `clip it` offline through the local microphone, then securely requests platform-native clipping from your KitsuFlowBOT server. It does not use OBS.

This `desktopapp` branch deliberately contains only the desktop client and its build automation. The KitsuFlowBOT dashboard, device pairing, clip orchestration and provider OAuth integrations live on the `main` branch.

## Download builds

Open [Desktop Voice Companion Actions](https://github.com/NekoSuneProjects/KitsuFlowBOT/actions/workflows/voice-companion-build.yml?query=branch%3Adesktopapp) and download `KitsuFlowVoiceCompanion-windows-x64` or `KitsuFlowVoiceCompanion-linux-amd64` from the latest successful run.

Run the packaged binary following [QUICKSTART](voice-companion/QUICKSTART.md). You need a local Vosk language model and a device key created from the web dashboard.

## Development

`python -m pip install -r voice-companion/requirements.txt`

`python voice-companion/companion.py --list-mics`

## Supported native clips

Twitch: when live and authorised on your server. Kick and VPZone: explicit unsupported status until a verified official create-clip API exists.
