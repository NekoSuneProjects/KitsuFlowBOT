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
