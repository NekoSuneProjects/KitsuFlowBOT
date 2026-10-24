# KitsuFlow Voice Companion GUI

Windows x64 and Linux AMD64 builds now launch a desktop window without requiring command-line use or a Python installation.

## First-time setup

1. Download the newest Windows or Linux artifact from the [desktopapp build workflow](https://github.com/NekoSuneProjects/KitsuFlowBOT/actions/workflows/voice-companion-build.yml?query=branch%3Adesktopapp) and extract it.
2. Download an English Vosk offline speech model from https://alphacephei.com/vosk/models and extract it to a folder called `model` next to the executable, or select a model folder in the GUI.
3. Open **KitsuFlowVoiceCompanion.exe** (Windows) or **KitsuFlowVoiceCompanion** (Linux). On Linux you may need to mark it executable through file properties.
4. In your KitsuFlowBOT dashboard, open **Voice & Clips → Desktop Voice Companion → Pair a PC**. Paste the one-time device key into the desktop window.
5. Choose your microphone. Click **Save .env** to store settings beside the executable, then **Start listening**.

The GUI displays its live connection status, phrase, selected platforms, and recent clip results. You can stop or restart listening without closing the window. Voice audio stays locally on your computer.

## .env configuration

The packaged download includes `.env.example`. You can copy it to `.env` beside the executable and edit it, or let the GUI create/update `.env` using **Save .env**.

```dotenv
KITSUFLOW_URL=https://kitsuflowbot.nekosunevr.co.uk
KITSUFLOW_DEVICE_KEY=
KITSUFLOW_VOSK_MODEL=model
KITSUFLOW_MIC_DEVICE=
```

Do not share `.env`, as it contains a device credential. The GUI masks the pairing key, and on Linux attempts to restrict saved file permissions to the current user. The configured key can be revoked in the dashboard.

Linux may require runtime PortAudio (`libportaudio2` on Debian/Ubuntu) and working microphone permissions. The native GUI build uses Tkinter; older Linux distributions with incompatible glibc may require a source install instead.

Twitch native clip creation works when a linked broadcaster is live and authorised. Kick and VPZone report **unsupported** until their native clip creation APIs can be verified.
