#!/usr/bin/env python3
"""KitsuFlow Voice Companion GUI. Local speech recognition; dashboard clip requests."""
import json
import os
import queue
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
import tkinter as tk
from tkinter import ttk, messagebox, filedialog

ROOT = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent
ENV = ROOT / ".env"
DEFAULTS = {"KITSUFLOW_URL": "https://kitsuflowbot.nekosunevr.co.uk",
            "KITSUFLOW_DEVICE_KEY": "", "KITSUFLOW_VOSK_MODEL": "model",
            "KITSUFLOW_MIC_DEVICE": ""}

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
        self.device = tk.StringVar()
        self.devices = {"System default": None}
        self.inbox = queue.Queue()
        self.stop = threading.Event()
        self.thread = None
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
        ttk.Label(settings, text="Offline Vosk model folder").pack(anchor="w", pady=(8, 3))
        modelrow = ttk.Frame(settings)
        modelrow.pack(fill="x")
        ttk.Entry(modelrow, textvariable=self.model).pack(side="left", fill="x", expand=True)
        ttk.Button(modelrow, text="Browse", command=self.browse_model).pack(side="left", padx=(6, 0))
        ttk.Label(settings, text="Microphone").pack(anchor="w", pady=(8, 3))
        microw = ttk.Frame(settings)
        microw.pack(fill="x")
        self.micbox = ttk.Combobox(microw, textvariable=self.device, state="readonly")
        self.micbox.pack(side="left", fill="x", expand=True)
        ttk.Button(microw, text="Refresh", command=self.refresh_mics).pack(side="left", padx=(6, 0))
        controls = ttk.Frame(frame)
        controls.pack(fill="x", pady=(16, 10))
        self.start_button = ttk.Button(controls, text="Start listening", command=self.start)
        self.start_button.pack(side="left")
        self.stop_button = ttk.Button(controls, text="Stop", command=self.stop_listening, state="disabled")
        self.stop_button.pack(side="left", padx=8)
        ttk.Button(controls, text="Save .env", command=self.save).pack(side="right")
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
        self.push("Ready. Paste your device key, choose a microphone and start listening.")

    def push(self, message):
        self.log.configure(state="normal")
        self.log.insert("end", time.strftime("%H:%M:%S") + "  " + str(message) + "\n")
        self.log.see("end")
        self.log.configure(state="disabled")

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
                elif kind == "stopped":
                    self.start_button.config(state="normal")
                    self.stop_button.config(state="disabled")
        except queue.Empty:
            pass
        self.root.after(100, self.process_messages)

    def browse_model(self):
        directory = filedialog.askdirectory(title="Select extracted Vosk model folder")
        if directory: self.model.set(directory)

    def refresh_mics(self):
        try:
            import sounddevice as sd
            devices = {"System default": None}
            for i, d in enumerate(sd.query_devices()):
                if d["max_input_channels"] > 0:
                    devices[f"{i}: {d['name']}"] = i
            self.devices = devices
            self.micbox["values"] = list(devices)
            choice = self.settings.get("KITSUFLOW_MIC_DEVICE", "")
            selected = next((name for name, idx in devices.items() if str(idx) == choice and idx is not None), "System default")
            if self.device.get() not in devices: self.device.set(selected)
        except Exception as exc:
            self.push("Microphone listing failed: " + str(exc))

    def values(self):
        selected = self.devices.get(self.device.get())
        return {"KITSUFLOW_URL": self.server.get().strip(),
                "KITSUFLOW_DEVICE_KEY": self.key.get().strip(),
                "KITSUFLOW_VOSK_MODEL": self.model.get().strip(),
                "KITSUFLOW_MIC_DEVICE": "" if selected is None else str(selected)}

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
        if not model_path.is_dir():
            messagebox.showerror("Speech model missing", "Download a Vosk model and select the extracted folder.")
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
            from vosk import Model, KaldiRecognizer, SetLogLevel
            SetLogLevel(-1)
            config = request(values["KITSUFLOW_URL"], values["KITSUFLOW_DEVICE_KEY"],
                             "/api/voice-companion/device/config")
            send("config", config)
            send("status", "Loading offline speech model…")
            model = Model(str(model_path))
            recognizer = KaldiRecognizer(model, 16000)
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
                    if not recognizer.AcceptWaveform(data): continue
                    text = " ".join(json.loads(recognizer.Result()).get("text", "").lower().split())
                    phrase = config.get("phrase", "clip it")
                    if phrase not in text or now - last < config.get("cooldown", 45):
                        continue
                    last = now
                    send("log", "Voice trigger recognised: " + phrase)
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
