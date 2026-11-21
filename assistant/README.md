# KitsuFlowBOT Assistant

A desktop app for Windows x64 and Linux AMD64 that runs the KitsuFlowBOT features that need your PC:

- **Voice Clips**: offline speech recognition (Whisper or Vosk) listens for your clip phrase and creates a clip. Audio never leaves your computer; only the trigger is sent.
- **Beat Saber song requests**: viewers' `!bsr <key>` requests are downloaded from BeatSaver straight into `CustomLevels` (PC: Steam or Oculus).
- **Minecraft Interactive**: chat commands and stream events (follows, subs, raids, tips) run commands on your Minecraft server over RCON.

The app pairs with your channel using a device key from Studio. It polls KitsuFlowBOT for jobs over HTTPS and reports each result back, so it needs no open ports. You configure requests and actions in Studio → **Assistant App**.

See [QUICKSTART.md](QUICKSTART.md) for setup.

## Safety

- Map downloads come only from `beatsaver.com` over HTTPS. Size is capped (100 MB download, 300 MB extracted), and archives with unsafe paths or no `Info.dat` are rejected.
- Server-admin RCON commands (`op`, `deop`, `stop`, `ban`, `whitelist`, …) are blocked in the app, whatever Studio sends.
- Jobs that are not picked up within 10 minutes expire, and their points are refunded.

## Development

Install Python 3.11+ with Tcl/Tk, then:

```bash
python -m pip install -r assistant/requirements.txt
python assistant/main.py
```

| File | Purpose |
| --- | --- |
| `main.py` | Entry point |
| `ui.py` | Tkinter window: Home, Voice Clips, Beat Saber, Minecraft, Settings |
| `api.py` | KitsuFlowBOT device API client |
| `jobs.py` | Background job worker (polls, runs, reports) |
| `voice.py` | Microphone listening and phrase matching |
| `beatsaber.py` | Game folder detection and safe map install |
| `minecraft.py` | RCON client and command checks |
| `settings.py` | `.env` read and save |
| `model_downloader.py`, `whisper_models.py` | Speech model download and hardware-based model choice |

Release builds are made by `.github/workflows/assistant-build.yml` with PyInstaller.
