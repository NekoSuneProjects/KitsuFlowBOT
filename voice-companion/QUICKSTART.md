# KitsuFlow Voice Companion — Desktop build

These are precompiled native executables for Windows x64 and Linux AMD64. You do **not** need Python installed.

## First launch
1. Open KitsuFlowBOT Dashboard → Voice & Clips → Desktop Voice Companion, pair a PC, and copy the **one-time** device key.
2. Download the small English Vosk speech model from https://alphacephei.com/vosk/models , unzip it, and name the extracted directory `model`.
3. Put `model` next to the executable (or pass `--model /path/to/model`).
4. Set `KITSUFLOW_DEVICE_KEY` in your terminal session, then launch the app.

**Windows PowerShell**
```powershell
$env:KITSUFLOW_DEVICE_KEY="paste-your-device-key"
.\KitsuFlowVoiceCompanion.exe
```
**Linux**
```bash
export KITSUFLOW_DEVICE_KEY='paste-your-device-key'
chmod +x ./KitsuFlowVoiceCompanion
./KitsuFlowVoiceCompanion
```

Run with `--list-mics` to show device IDs, or `--device N` to choose another microphone. You can point it at another HTTPS dashboard with `--server https://your-dashboard.example`.

Linux computers may need PortAudio runtime libraries (`sudo apt install libportaudio2` on Debian/Ubuntu) and access to the recording device. Distributions with older glibc than Ubuntu 22.04 may not run this binary; use a Python installation instead.

The speech model is intentionally **not bundled** because downloads are large and users may select different languages. Your PC performs recognition offline; only the matching phrase goes over HTTPS. Do not share the pairing key or include it in error reports.

Native stream clips are supported through Twitch when live. Kick and VPZone report an explicit unsupported status until verified public create-clip APIs are available.
