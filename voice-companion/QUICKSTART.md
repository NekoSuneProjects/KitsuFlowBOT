# KitsuFlow Voice Companion GUI

Windows x64 and Linux AMD64 builds now launch a desktop window without requiring command-line use or a Python installation.

## First-time setup

1. Download the newest Windows or Linux artifact from the [desktopapp build workflow](https://github.com/NekoSuneProjects/KitsuFlowBOT/actions/workflows/voice-companion-build.yml?query=branch%3Adesktopapp) and extract it.
2. The app will automatically download a full-quality English Vosk model on the first Start listening, or you can click Download quality model. You may also select an existing model in the GUI.
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

## Automatic high-accuracy speech model

On first **Start listening**, the companion downloads the official full-size English Vosk `vosk-model-en-us-0.22` (~1.8 GB compressed) automatically if a valid model is not installed. You can also click **Download quality model** in the GUI. Download progress is shown in the window; interrupted downloads leave a `.zip.part` file and resume where the server supports HTTP range requests. Download and extraction need multiple gigabytes of free disk space.

The high-accuracy model is significantly larger than the mobile/small model and can require substantial RAM (Vosk says large models may use up to 16 GB). Make sure your PC has adequate memory. The model downloads once, then remains cached under the chosen `KITSUFLOW_VOSK_MODEL` directory. If you want a custom model, choose an already-installed valid Vosk model folder.

## Alternative: Whisper speech recognition

In the app, choose **whisper** under Speech recognition engine, then choose a model (start with **base.en** for CPU machines). The first Start downloads the chosen model from Hugging Face; it then runs locally on your CPU. A working internet connection is required for the initial model download. Choose **vosk** to keep the original Vosk flow. Both engines use the same desktop pairing key and clip trigger endpoint.

### Persistent model folders and automatic recommendations

Set the recognition engine to **Whisper** and the model to **auto** to select a suitable model for the detected hardware. Press **Download selected model** or **Start listening** to download the model into `model/whisper/<model-name>`. Vosk uses `model/vask`. On the GTX 980 Ti, automatic selection favours `base.en` with CPU inference for compatibility. The model chooser also permits manual `medium.en` and `large-v3`, but larger models can cause significant delays on older CPUs.
