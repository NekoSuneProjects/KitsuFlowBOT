#!/usr/bin/env python3
"""KitsuFlow Voice Companion: offline microphone detection, direct dashboard API."""
import argparse
import json
import os
import queue
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

def request(server, token, endpoint, payload=None):
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        server.rstrip("/") + endpoint,
        data=data,
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json",
                 "User-Agent": "KitsuFlowVoiceCompanion/1.0"},
        method="POST" if data is not None else "GET",
    )
    with urllib.request.urlopen(req, timeout=18) as response:
        return json.load(response)

def main():
    p = argparse.ArgumentParser(description="KitsuFlow Voice Companion — no OBS required")
    p.add_argument("--server", default=os.getenv("KITSUFLOW_URL", "https://kitsuflowbot.nekosunevr.co.uk"))
    p.add_argument("--key", default=os.getenv("KITSUFLOW_DEVICE_KEY"))
    p.add_argument("--model", default=os.getenv("KITSUFLOW_VOSK_MODEL", "./model"))
    p.add_argument("--device", type=int, default=None, help="sounddevice input device index")
    p.add_argument("--list-mics", action="store_true")
    args = p.parse_args()
    try:
        import sounddevice as sd
    except ImportError:
        sys.exit("Install dependencies: python -m pip install -r requirements.txt")
    if args.list_mics:
        print(sd.query_devices())
        return
    if not args.key:
        sys.exit("Pair the device in Dashboard > Voice & Clips; set KITSUFLOW_DEVICE_KEY.")
    if not args.server.startswith("https://") and not args.server.startswith("http://localhost:"):
        sys.exit("Refusing an insecure server URL; use HTTPS.")
    try:
        from vosk import Model, KaldiRecognizer, SetLogLevel
    except ImportError:
        sys.exit("Install dependencies: python -m pip install -r requirements.txt")
    if not Path(args.model).is_dir():
        sys.exit("Offline Vosk model not found: " + args.model + " (see README.md)")
    SetLogLevel(-1)
    config = request(args.server, args.key, "/api/voice-companion/device/config")
    model = Model(args.model)
    rate = 16000
    recognizer = KaldiRecognizer(model, rate)
    q = queue.Queue(maxsize=100)
    last = 0
    last_config = time.monotonic()
    def callback(indata, frames, timing, status):
        if status:
            print("Microphone:", status, file=sys.stderr)
        try:
            q.put_nowait(bytes(indata))
        except queue.Full:
            pass
    print("KitsuFlow Voice Companion connected. Say:", config["phrase"])
    print("Mic audio stays on this computer. Press Ctrl+C to stop.")
    try:
        with sd.RawInputStream(samplerate=rate, blocksize=4000, dtype="int16", channels=1,
                               device=args.device, callback=callback):
            while True:
                if time.monotonic() - last_config >= 60:
                    try:
                        config = request(args.server, args.key, "/api/voice-companion/device/config")
                        last_config = time.monotonic()
                    except Exception as exc:
                        print("Configuration refresh failed:", exc, file=sys.stderr)
                audio = q.get()
                if not recognizer.AcceptWaveform(audio):
                    continue
                result = json.loads(recognizer.Result())
                words = " ".join(str(result.get("text", "")).lower().split())
                phrase = config.get("phrase", "clip it")
                if phrase not in words:
                    continue
                if time.monotonic() - last < config.get("cooldown", 45):
                    continue
                last = time.monotonic()
                print("Detected:", phrase)
                try:
                    outcome = request(args.server, args.key, "/api/voice-companion/device/trigger",
                                      {"phrase": phrase})
                    for item in outcome.get("results", []):
                        print(item["platform"], item["status"], item.get("clip_id") or item["detail"])
                except urllib.error.HTTPError as exc:
                    print("Trigger rejected:", exc.code, exc.read(400).decode("utf-8", "replace"))
                except Exception as exc:
                    print("Clip request error:", exc, file=sys.stderr)
    except KeyboardInterrupt:
        print("Stopped.")
if __name__ == "__main__":
    main()
