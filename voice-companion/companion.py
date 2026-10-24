#!/usr/bin/env python3
"""KitsuFlow Voice Companion GUI. Local speech recognition; dashboard clip requests."""
import json
import math
import struct
import os
import re
import queue
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
import tkinter as tk
from tkinter import ttk, messagebox, filedialog
from model_downloader import install_model, valid_model
from whisper_models import MODELS, gpu_information, recommended_model, backend, ensure_whisper_model, model_complete

ROOT = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent
ENV = ROOT / ".env"
DEFAULTS = {"KITSUFLOW_URL": "https://kitsuflowbot.nekosunevr.co.uk",
            "KITSUFLOW_DEVICE_KEY": "", "KITSUFLOW_VOSK_MODEL": "model/vask",
            "KITSUFLOW_MIC_DEVICE": "", "KITSUFLOW_TRIGGER_SOUND": "true", "KITSUFLOW_STT_ENGINE": "whisper", "KITSUFLOW_WHISPER_MODEL": "auto"}

def read_env():
    values = DEFAULTS.copy()
    if ENV.exists():
        for line in ENV.read_text(encoding="utf-8-sig").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            if key.strip() in values:
                values[key.strip()] = value.strip().strip('"').strip("'")
    for key in values:
        if os.environ.get(key):
            values[key] = os.environ[key]
    return values

def save_env(values):
    def quote(v):
        return '"' + str(v).replace("\\", "\\\\").replace('"', '\\"').replace("\n", "") + '"'
    text = "# KitsuFlow Voice Companion - keep this file private\n" + "".join(
        key + "=" + quote(values.get(key, "")) + "\n" for key in DEFAULTS)
    ENV.write_text(text, encoding="utf-8")
    if os.name != "nt":
        ENV.chmod(0o600)

def request(server, token, endpoint, payload=None):
    if not server.startswith("https://") and not server.startswith("http://localhost:"):
        raise ValueError("Use an HTTPS dashboard URL.")
    data = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(server.rstrip("/") + endpoint, data=data,
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json",
                 "User-Agent": "KitsuFlowVoiceCompanion/GUI"},
        method="POST" if data is not None else "GET")
    with urllib.request.urlopen(req, timeout=18) as response:
        return json.load(response)

class App:
    def __init__(self):
        self.root = tk.Tk()
        self.root.title("KitsuFlow Voice Companion")
        self.root.geometry("690x570")
        self.root.minsize(580, 480)
        self.settings = read_env()
        self.server = tk.StringVar(value=self.settings["KITSUFLOW_URL"])
        self.key = tk.StringVar(value=self.settings["KITSUFLOW_DEVICE_KEY"])
        self.model = tk.StringVar(value=self.settings["KITSUFLOW_VOSK_MODEL"])
        self.engine = tk.StringVar(value=self.settings.get("KITSUFLOW_STT_ENGINE", "whisper"))
        self.whisper_model = tk.StringVar(value=self.settings.get("KITSUFLOW_WHISPER_MODEL", "auto"))
        self.gpu = gpu_information()
        self.trigger_sound = tk.BooleanVar(value=self.settings.get('KITSUFLOW_TRIGGER_SOUND','true').lower() in ('true','1','yes'))
        self.device = tk.StringVar()
        self.devices = {"System default": None}
        self.show_all_mics = tk.BooleanVar(value=False)
        self.inbox = queue.Queue()
        self.stop = threading.Event()
        self.thread = None
        self.downloading = False
        self.status = tk.StringVar(value="Disconnected")
        self.phrase = tk.StringVar(value="clip it")
        self.routing = tk.StringVar(value="Not connected")
        self.configure_ui()
        self.refresh_mics()
        self.root.after(100, self.process_messages)
        self.root.protocol("WM_DELETE_WINDOW", self.close)

    def configure_ui(self):
        self.root.configure(bg="#121822")
        style = ttk.Style(self.root)
        if "clam" in style.theme_names(): style.theme_use("clam")
        style.configure("TFrame", background="#121822")
        style.configure("TLabel", background="#121822", foreground="#e6eefa", font=("Segoe UI", 10))
        style.configure("TButton", padding=(12, 7))
        style.configure("TEntry", padding=5)
        style.configure("TCombobox", padding=5)
        style.configure("Title.TLabel", font=("Segoe UI", 19, "bold"), foreground="#ffffff")
        style.configure("Muted.TLabel", foreground="#a7b3c7")
        frame = ttk.Frame(self.root, padding=20)
        frame.pack(fill="both", expand=True)
        ttk.Label(frame, text="KitsuFlow Voice Companion", style="Title.TLabel").pack(anchor="w")
        ttk.Label(frame, text="Microphone detection stays on your PC. Clips are requested through the dashboard.",
                  style="Muted.TLabel", wraplength=610).pack(anchor="w", pady=(2, 15))
        settings = ttk.Frame(frame)
        settings.pack(fill="x")
        def row(label, variable, secret=False):
            ttk.Label(settings, text=label).pack(anchor="w", pady=(8, 3))
            ttk.Entry(settings, textvariable=variable, show="*" if secret else "").pack(fill="x")
        row("Dashboard URL", self.server)
        row("Device pairing key (from Voice & Clips)", self.key, True)
        ttk.Label(settings, text="Speech recognition engine").pack(anchor="w", pady=(8, 3))
        ttk.Combobox(settings, textvariable=self.engine, values=["vosk", "whisper"], state="readonly").pack(fill="x")
        ttk.Label(settings, text="Whisper model (auto detects hardware)").pack(anchor="w", pady=(8, 3))
        ttk.Combobox(settings, textvariable=self.whisper_model, values=["auto", *MODELS], state="readonly").pack(fill="x")
        ttk.Label(settings, text="Offline Vosk model folder (model/vask)").pack(anchor="w", pady=(8, 3))
        modelrow = ttk.Frame(settings)
        modelrow.pack(fill="x")
        ttk.Entry(modelrow, textvariable=self.model).pack(side="left", fill="x", expand=True)
        ttk.Button(modelrow, text="Browse", command=self.browse_model).pack(side="left", padx=(6, 0))
        self.download_button = ttk.Button(modelrow, text="Download selected model", command=self.download_model)
        self.download_button.pack(side="left", padx=(6, 0))
        self.model_progress = ttk.Progressbar(settings, maximum=100, mode="determinate")
        self.model_progress.pack(fill="x", pady=(5, 0))
        ttk.Label(settings, text="Microphone").pack(anchor="w", pady=(8, 3))
        microw = ttk.Frame(settings)
        microw.pack(fill="x")
        self.micbox = ttk.Combobox(microw, textvariable=self.device, state="readonly")
        self.micbox.pack(side="left", fill="x", expand=True)
        ttk.Button(microw, text="Refresh", command=self.refresh_mics).pack(side="left", padx=(6, 0))
        ttk.Checkbutton(settings, text="Show all audio devices (including duplicates / virtual inputs)",
                        variable=self.show_all_mics, command=self.refresh_mics).pack(anchor="w", pady=(4, 0))
        controls = ttk.Frame(frame)
        controls.pack(fill="x", pady=(16, 10))
        self.start_button = ttk.Button(controls, text="Start listening", command=self.start)
        self.start_button.pack(side="left")
        self.stop_button = ttk.Button(controls, text="Stop", command=self.stop_listening, state="disabled")
        self.stop_button.pack(side="left", padx=8)
        ttk.Button(controls, text="Save .env", command=self.save).pack(side="right")
        ttk.Checkbutton(frame, text="Play confirmation sound when clip phrase is detected", variable=self.trigger_sound).pack(anchor="w", pady=(0, 6))
        ttk.Button(controls, text="Test sound", command=self.play_trigger_sound).pack(side="left", padx=6)
        ttk.Label(frame, textvariable=self.status).pack(anchor="w")
        ttk.Label(frame, textvariable=self.phrase, style="Muted.TLabel").pack(anchor="w")
        ttk.Label(frame, textvariable=self.routing, style="Muted.TLabel").pack(anchor="w")
        ttk.Label(frame, text="Activity", style="Title.TLabel").pack(anchor="w", pady=(12, 4))
        logframe = ttk.Frame(frame)
        logframe.pack(fill="both", expand=True)
        self.log = tk.Text(logframe, height=9, wrap="word", state="disabled",
                           bg="#202a39", fg="#e6eefa", insertbackground="#ffffff",
                           relief="flat", padx=10, pady=8)
        self.log.pack(fill="both", expand=True)
        self.push("GPU: " + (self.gpu["name"] if self.gpu else "No NVIDIA GPU detected") + " • Auto Whisper model: " + recommended_model(self.gpu))
        self.push("Ready. Paste your device key, choose a microphone and start listening.")

    def push(self, message):
        self.log.configure(state="normal")
        self.log.insert("end", time.strftime("%H:%M:%S") + "  " + str(message) + "\n")
        self.log.see("end")
        self.log.configure(state="disabled")

    def play_trigger_sound(self):
        if not self.trigger_sound.get():
            self.push("Enable confirmation sound to hear the test.")
            return
        def play():
            try:
                import sounddevice as sd
                import numpy as np
                rate = 24000
                # Two gentle notes on the output device, not the microphone.
                def note(hz, duration):
                    count = int(rate * duration)
                    sample = np.arange(count, dtype=np.float32) / rate
                    envelope = np.minimum(1.0, sample / 0.015) * np.minimum(1.0, (duration - sample) / 0.045)
                    return (0.14 * np.sin(2 * np.pi * hz * sample) * envelope).astype(np.float32)
                sound = np.concatenate((note(660, 0.10), np.zeros(int(rate*0.04),dtype=np.float32), note(880,0.14)))
                sd.play(sound, samplerate=rate, blocking=True)
            except Exception as exc:
                self.inbox.put(("log", "Confirmation sound unavailable: " + str(exc)))
        threading.Thread(target=play, daemon=True).start()

    def process_messages(self):
        try:
            while True:
                kind, value = self.inbox.get_nowait()
                if kind == "log": self.push(value)
                elif kind == "status": self.status.set(value)
                elif kind == "config":
                    self.phrase.set("Trigger: " + value.get("phrase", "clip it"))
                    self.routing.set("Routing: " + value.get("routing", "all") +
                        " · Platforms: " + ", ".join(value.get("platforms", [])))
                elif kind == "model_progress":
                    self.model_progress["value"] = value[0]
                    self.status.set(value[1])
                elif kind == "start_after_download":
                    self.start()
                elif kind == "trigger_sound":
                    self.play_trigger_sound()
                elif kind == "model_done":
                    self.downloading = False
                    self.download_button.config(state="normal")
                    if value:
                        self.push("Full-quality speech model installed.")
                        self.status.set("Model ready")
                    else:
                        self.status.set("Model download failed")
                elif kind == "stopped":
                    self.start_button.config(state="normal")
                    self.stop_button.config(state="disabled")
        except queue.Empty:
            pass
        self.root.after(100, self.process_messages)

    def browse_model(self):
        directory = filedialog.askdirectory(title="Select extracted Vosk model folder")
        if directory: self.model.set(directory)

    def download_model(self, then_listen=None):
        if self.downloading:
            return
        self.downloading = True
        self.download_button.config(state="disabled")
        values = self.values()
        model_path = Path(values["KITSUFLOW_VOSK_MODEL"]).expanduser()
        if not model_path.is_absolute(): model_path = ROOT / model_path
        def worker():
            try:
                if values["KITSUFLOW_STT_ENGINE"] == "whisper":
                    selected = values["KITSUFLOW_WHISPER_MODEL"]
                    if selected == "auto": selected = recommended_model(self.gpu)
                    ensure_whisper_model(ROOT, selected, lambda p, msg: self.inbox.put(("model_progress", (p, msg))))
                else:
                    install_model(model_path, lambda p, msg: self.inbox.put(("model_progress", (p, msg))))
                self.inbox.put(("model_done", True))
                if then_listen is not None:
                    self.inbox.put(("start_after_download", values))
            except Exception as exc:
                self.inbox.put(("log", "Model download error: " + str(exc)))
                self.inbox.put(("model_done", False))
        threading.Thread(target=worker, daemon=True).start()

    def refresh_mics(self):
        try:
            import sounddevice as sd
            raw = sd.query_devices()
            apis = sd.query_hostapis()
            saved = self.devices.get(self.device.get())
            persisted = self.settings.get("KITSUFLOW_MIC_DEVICE", "")
            devices = {"System default": None}
            candidates = []
            for index, item in enumerate(raw):
                if item["max_input_channels"] <= 0:
                    continue
                name = str(item["name"]).strip()
                api = str(apis[item["hostapi"]]["name"])
                if not name:
                    continue
                # Windows lists each input through MME, DirectSound, WASAPI and WDM-KS.
                # Only one copy per microphone is needed in the normal view.
                name_clean = re.sub(r"\s*\((?:[0-9]+-\s*)?\w*(?:input|output)\w*\)\s*$", "", name, flags=re.I).strip()
                key = re.sub(r"[^a-z0-9]+", "", name_clean.lower())
                duplicate = any(x in name.lower() for x in (
                    "microsoft sound mapper", "primary sound capture driver", "stereo mix",
                    "what u hear", "wave out mix", "loopback", "monitor of "))
                # MME often handles 16 kHz conversion on older Windows sound drivers.
                priority = (0 if "MME" in api else 1 if "WASAPI" in api else
                            2 if "DirectSound" in api else 3)
                candidates.append((priority, duplicate, index, name, api, key))
            candidates.sort(key=lambda x: (x[1], x[0], x[2]))
            seen = set()
            for _, hidden, index, name, api, key in candidates:
                if not self.show_all_mics.get():
                    if hidden or key in seen:
                        continue
                seen.add(key)
                label = f"{name} ({api})" if self.show_all_mics.get() else name
                if label in devices:
                    label = f"{label} [{index}]"
                devices[label] = index
            self.devices = devices
            self.micbox["values"] = list(devices)
            target = saved if saved is not None else (
                int(persisted) if persisted.isdigit() else None)
            chosen = next((label for label, index in devices.items()
                           if index is not None and index == target), None)
            if chosen is None and target is not None:
                self.push("Previously selected microphone is hidden/unavailable; choose a visible device.")
            self.device.set(chosen or "System default")
            self.push(f"Microphones: {len(devices)-1} shown" +
                      (" (all recording inputs)" if self.show_all_mics.get() else " (duplicates hidden)"))
        except Exception as exc:
            self.push("Microphone listing failed: " + str(exc))

    def values(self):
        selected = self.devices.get(self.device.get())
        return {"KITSUFLOW_URL": self.server.get().strip(),
                "KITSUFLOW_DEVICE_KEY": self.key.get().strip(),
                "KITSUFLOW_VOSK_MODEL": self.model.get().strip(),
                "KITSUFLOW_MIC_DEVICE": "" if selected is None else str(selected),
                "KITSUFLOW_TRIGGER_SOUND": "true" if self.trigger_sound.get() else "false",
                "KITSUFLOW_STT_ENGINE": self.engine.get(), "KITSUFLOW_WHISPER_MODEL": self.whisper_model.get()}

    def save(self):
        try:
            save_env(self.values())
            self.push("Settings saved to " + str(ENV))
        except Exception as exc:
            messagebox.showerror("Cannot save settings", str(exc))

    def start(self):
        values = self.values()
        if not values["KITSUFLOW_DEVICE_KEY"]:
            messagebox.showwarning("Pairing required", "Enter the device key from your dashboard.")
            return
        if not values["KITSUFLOW_URL"].startswith("https://") and not values["KITSUFLOW_URL"].startswith("http://localhost:"):
            messagebox.showerror("Invalid URL", "Use an HTTPS dashboard URL.")
            return
        model_path = Path(values["KITSUFLOW_VOSK_MODEL"]).expanduser()
        if not model_path.is_absolute(): model_path = ROOT / model_path
        if values["KITSUFLOW_STT_ENGINE"] == "vosk" and not valid_model(model_path):
            if self.downloading:
                self.push("Model download is already running.")
                return
            if model_path.exists():
                messagebox.showerror("Invalid model folder", "Choose an empty folder or a valid existing Vosk model.")
                return
            self.push("Full-quality model missing. Downloading it automatically before listening.")
            self.download_model(then_listen=True)
            return
        if values["KITSUFLOW_STT_ENGINE"] == "whisper":
            selected = values["KITSUFLOW_WHISPER_MODEL"]
            if selected == "auto": selected = recommended_model(self.gpu)
            from whisper_models import cache_dir
            folder = cache_dir(ROOT, selected)
            if not model_complete(folder):
                if self.downloading: return
                self.push("Checking/repairing Whisper " + selected + " in model/whisper/...")
                self.download_model(then_listen=True)
                return
        self.stop.clear()
        self.start_button.config(state="disabled")
        self.stop_button.config(state="normal")
        self.thread = threading.Thread(target=self.listen, args=(values, model_path), daemon=True)
        self.thread.start()

    def stop_listening(self):
        self.stop.set()
        self.status.set("Stopping…")

    def listen(self, values, model_path):
        def send(kind, value): self.inbox.put((kind, value))
        try:
            import sounddevice as sd
            engine = values["KITSUFLOW_STT_ENGINE"]
            if engine == "vosk":
                from vosk import Model, KaldiRecognizer, SetLogLevel
                SetLogLevel(-1)
            else:
                from faster_whisper import WhisperModel
                import numpy as np
            config = request(values["KITSUFLOW_URL"], values["KITSUFLOW_DEVICE_KEY"],
                             "/api/voice-companion/device/config")
            send("config", config)
            send("status", "Loading offline speech model…")
            if engine == "vosk":
                model = Model(str(model_path))
                recognizer = KaldiRecognizer(model, 16000)
            else:
                selected_model = values["KITSUFLOW_WHISPER_MODEL"]
                if selected_model == "auto": selected_model = recommended_model(self.gpu)
                from whisper_models import cache_dir
                model_folder = cache_dir(ROOT, selected_model)
                if not model_complete(model_folder):
                    raise RuntimeError("Whisper model is incomplete. Press Download selected model to repair it.")
                device, precision = backend(self.gpu)
                try:
                    model = WhisperModel(str(model_folder), device=device, compute_type=precision)
                except (RuntimeError, ValueError, OSError) as gpu_error:
                    if device != "cuda": raise
                    send("log", "GPU backend unavailable: " + str(gpu_error)[:160] + ". Falling back to CPU.")
                    device, precision = "cpu", "int8"
                    model = WhisperModel(str(model_folder), device=device, compute_type=precision)
                send("log", "Whisper " + selected_model + " loaded on " + device + " (" + precision + ")")
                segment_buffer = bytearray()
                last_transcribe = time.monotonic()
            audio = queue.Queue(maxsize=64)
            def capture(indata, frames, timing, status):
                if status: send("log", "Mic status: " + str(status))
                try: audio.put_nowait(bytes(indata))
                except queue.Full: pass
            selected = values["KITSUFLOW_MIC_DEVICE"]
            with sd.RawInputStream(samplerate=16000, blocksize=4000, dtype="int16", channels=1,
                                   device=int(selected) if selected else None, callback=capture):
                send("status", "Listening • Connected to KitsuFlowBOT")
                send("log", "Listening for: " + config.get("phrase", "clip it"))
                last, last_refresh = 0.0, time.monotonic()
                while not self.stop.is_set():
                    now = time.monotonic()
                    if now - last_refresh > 60:
                        try:
                            config = request(values["KITSUFLOW_URL"], values["KITSUFLOW_DEVICE_KEY"],
                                             "/api/voice-companion/device/config")
                            send("config", config)
                            last_refresh = now
                        except Exception as exc:
                            send("log", "Settings refresh failed: " + str(exc))
                    try: data = audio.get(timeout=0.4)
                    except queue.Empty: continue
                    if engine == "vosk":
                        if not recognizer.AcceptWaveform(data): continue
                        text = " ".join(json.loads(recognizer.Result()).get("text", "").lower().split())
                    else:
                        segment_buffer.extend(data)
                        # Transcribe short chunks to keep memory bounded and allow a spoken trigger to be recognised.
                        if len(segment_buffer) < 16000 * 2 * 4: continue
                        samples = np.frombuffer(bytes(segment_buffer), dtype=np.int16).astype(np.float32) / 32768.0
                        segment_buffer.clear()
                        chunks, info = model.transcribe(samples, language="en", beam_size=1,
                            vad_filter=True, condition_on_previous_text=False)
                        text = " ".join(" ".join(piece.text.lower().split()) for piece in chunks).strip()
                        if text: send("log", "Whisper heard: " + text[:120])
                    phrase = config.get("phrase", "clip it")
                    if phrase not in text or now - last < config.get("cooldown", 45):
                        continue
                    last = now
                    send("log", "Voice trigger recognised: " + phrase)
                    if values.get("KITSUFLOW_TRIGGER_SOUND","true").lower() in ("true","1","yes"):
                        send("trigger_sound", None)
                    try:
                        output = request(values["KITSUFLOW_URL"], values["KITSUFLOW_DEVICE_KEY"],
                                         "/api/voice-companion/device/trigger", {"phrase": phrase})
                        for item in output.get("results", []):
                            send("log", item["platform"] + ": " + item["status"] + " — " +
                                 str(item.get("clip_id") or item.get("detail", "")))
                    except urllib.error.HTTPError as exc:
                        send("log", "Dashboard rejected request (HTTP " + str(exc.code) + ")")
                    except Exception as exc:
                        send("log", "Clip request failed: " + str(exc))
        except Exception as exc:
            send("status", "Disconnected")
            send("log", "Listening stopped: " + str(exc))
        finally:
            send("status", "Stopped")
            send("stopped", None)

    def close(self):
        self.stop.set()
        self.root.destroy()

def main():
    App().root.mainloop()

if __name__ == "__main__":
    main()
