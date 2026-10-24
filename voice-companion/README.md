# KitsuFlow Voice Companion

Graphical Windows x64 / Linux AMD64 application for KitsuFlowBOT. The microphone is captured locally, voice commands are recognised offline using Vosk, and clip requests go directly to the secured dashboard API. No OBS, Python console, or browser microphone required for packaged releases.

## Features

- Desktop GUI with dashboard URL, masked pairing key and selectable offline speech model folder
- Microphone device selection, Refresh, Start listening, Stop and in-app event history
- `.env` configuration stored beside the executable; `.env.example` included with builds
- Fetches your clip phrase, routing mode and platform choices from your creator profile
- Twitch native clips when live; Kick/VPZone explicitly unsupported
- Windows and Linux artifacts built automatically in the `desktopapp` branch

Read [QUICKSTART.md](QUICKSTART.md) for a GUI-first setup guide.

### Development

Install Python 3.11+, Tcl/Tk, and `python -m pip install -r voice-companion/requirements.txt`, then run `python voice-companion/companion.py`. For distribution, use the GitHub Actions workflow.

The GUI can automatically download the official full-size `vosk-model-en-us-0.22` English model on first Start, with a visible progress bar and resumable partial download support. The model is approximately 1.8 GB compressed and may need up to 16 GB RAM; it is not bundled in GitHub Release ZIPs. No small speech model is silently substituted.

## Whisper (optional)

Choose **whisper** in the Speech recognition engine dropdown. Select **tiny.en**, **base.en**, **small.en**, or **medium.en**. Models are downloaded by faster-whisper on first use and cached locally; subsequent recognition runs offline on CPU using int8 quantisation. Larger models increase accuracy and CPU/RAM use, and four-second audio chunks add recognition delay. Vosk remains available for older configurations. Audio never gets uploaded to the KitsuFlowBOT service; only the recognised configured trigger is sent.

### Auto-download, model cache and GPU selection

Whisper models download to `model/whisper/<selected-model>` relative to the application directory. The original Vosk model installs at `model/vask`. The GUI includes `auto` plus manual Whisper sizes `tiny.en`, `base.en`, `small.en`, `medium.en`, and `large-v3`. Automatic selection considers GPU memory and compute capability. A GTX 980 Ti (Maxwell 5.2) defaults to `base.en` running CPU/int8 because newer CTranslate2 CUDA wheels are not reliably compatible; it is not guaranteed GPU-accelerated. CUDA is attempted on supported newer hardware with runtime checks and an initialization fallback to CPU. First download requires internet and disk space; already downloaded models are reused. Large models can substantially increase latency; recognition uses 4-second chunks.
