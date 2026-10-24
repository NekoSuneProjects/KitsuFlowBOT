#!/usr/bin/env python3
"""KitsuFlow Voice Companion GUI. Local speech recognition; dashboard clip requests."""
import json
import math
import struct
import os
import tempfile
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
            "KITSUFLOW_MIC_DEVICE": "", "KITSUFLOW_MIC_NAME": "", "KITSUFLOW_SHOW_ALL_MICS": "false", "KITSUFLOW_WHISPER_BACKEND": "auto", "KITSUFLOW_TRIGGER_SOUND": "true", "KITSUFLOW_STT_ENGINE": "whisper", "KITSUFLOW_WHISPER_MODEL": "auto"}

def read_env():
    values = DEFAULTS.copy()
    saved_keys = set()
    if ENV.exists():
        for line in ENV.read_text(encoding="utf-8-sig").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            if key.strip() in values:
                saved_keys.add(key.strip())
                raw = value.strip()
                if raw.startswith('"'):
                    try:
                        values[key.strip()] = json.loads(raw)
                    except (ValueError, TypeError):
                        values[key.strip()] = raw.strip('"')
                else:
                    values[key.strip()] = raw.strip("'")
    for key in values:
        if key not in saved_keys and os.environ.get(key):
            values[key] = os.environ[key]
    return values

def save_env(values):
    def quote(v):
        return '"' + str(v).replace("\\", "\\\\").replace('"', '\\"').replace("\n", "") + '"'
    text = "# KitsuFlow Voice Companion - keep this file private\n" + "".join(
        key + "=" + quote(values.get(key, "")) + "\n" for key in DEFAULTS)
    ENV.parent.mkdir(parents=True, exist_ok=True)
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=ENV.parent,
                                         prefix=".kitsuflow-", suffix=".tmp", delete=False) as stream:
            temp_path = Path(stream.name)
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
        if os.name != "nt":
            temp_path.chmod(0o600)
        os.replace(temp_path, ENV)
    finally:
        if temp_path is not None and temp_path.exists():
            temp_path.unlink()

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
        self.show_all_mics = tk.BooleanVar(value=self.settings.get("KITSUFLOW_SHOW_ALL_MICS", "false").lower() in ("true","1","yes"))
        self.whisper_backend = tk.StringVar(value=self.settings.get("KITSUFLOW_WHISPER_BACKEND", "auto"))
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
        """Teal Broadcast layout: focused home page and scrollable settings page."""
        bg, panel, raised, border = "#0b111b", "#151f2d", "#1c2b3c", "#304354"
        text, muted, teal = "#f2f7fd", "#9eafc2", "#48e4c2"
        self.root.configure(bg=bg)
        self.root.title("KitsuFlow • Voice Companion")
        self.root.geometry("910x660")
        self.root.minsize(680, 520)
        style = ttk.Style(self.root)
        if "clam" in style.theme_names():
            style.theme_use("clam")
        style.configure("App.TFrame", background=bg)
        style.configure("Card.TFrame", background=panel)
        style.configure("TFrame", background=panel)
        style.configure("TLabel", background=panel, foreground=text, font=("Segoe UI", 10))
        style.configure("Muted.TLabel", foreground=muted)
        style.configure("Heading.TLabel", foreground=text, font=("Segoe UI Semibold", 16))
        style.configure("Brand.TLabel", background=bg, foreground=teal, font=("Segoe UI Semibold", 17))
        style.configure("TButton", background="#1b3147", foreground=text,
                        bordercolor=border, lightcolor="#1b3147", darkcolor="#1b3147",
                        padding=(14, 9), font=("Segoe UI Semibold", 10), relief="flat")
        style.map("TButton", background=[("active", "#294860"), ("pressed", "#173047"), ("disabled", "#192837")],
                  foreground=[("disabled", "#738b9f")])
        style.configure("Primary.TButton", background="#159f8a", foreground="#061b1a",
                        bordercolor="#159f8a", lightcolor="#159f8a", darkcolor="#159f8a",
                        padding=(22, 14), font=("Segoe UI Semibold", 12), relief="flat")
        style.map("Primary.TButton", background=[("active", "#31d2b6"), ("disabled", "#355657")],
                  foreground=[("disabled", "#8bb7ae")])
        style.configure("Danger.TButton", background="#57323f", foreground="#ffe8ee",
                        bordercolor="#57323f", lightcolor="#57323f", darkcolor="#57323f",
                        padding=(20, 14), font=("Segoe UI Semibold", 11), relief="flat")
        style.map("Danger.TButton", background=[("active", "#784356"), ("disabled", "#392b34")],
                  foreground=[("disabled", "#a38c97")])
        for name, color, foreground in (("Nav.TButton", "#1b3147", text),
                                         ("NavActive.TButton", "#159f8a", "#061b1a")):
            style.configure(name, background=color, foreground=foreground,
                            bordercolor=color, lightcolor=color, darkcolor=color,
                            padding=(19, 10), font=("Segoe UI Semibold", 10), relief="flat")
        style.map("Nav.TButton", background=[("active", "#294860")])
        style.configure("TEntry", fieldbackground=raised, foreground=text, bordercolor=border,
                        lightcolor=border, darkcolor=border, insertcolor=text, padding=8)
        style.map("TEntry", fieldbackground=[("disabled", "#13202d")], foreground=[("disabled", muted)])
        style.configure("TCombobox", fieldbackground=raised, background=raised, foreground=text,
                        bordercolor=border, lightcolor=border, darkcolor=border,
                        arrowcolor=text, padding=8)
        style.map("TCombobox",
                  fieldbackground=[("readonly", raised), ("disabled", "#13202d")],
                  background=[("readonly", raised), ("disabled", "#13202d")],
                  foreground=[("readonly", text), ("disabled", muted)],
                  selectbackground=[("readonly", raised)],
                  selectforeground=[("readonly", text)],
                  arrowcolor=[("readonly", text), ("disabled", muted)])
        style.configure("TCheckbutton", background=panel, foreground=text)
        style.map("TCheckbutton", background=[("active", panel)], foreground=[("disabled", muted)])
        style.configure("TProgressbar", troughcolor=raised, background=teal, borderwidth=0)
        self.root.option_add("*TCombobox*Listbox.background", raised)
        self.root.option_add("*TCombobox*Listbox.foreground", text)
        self.root.option_add("*TCombobox*Listbox.selectBackground", "#159f8a")
        self.root.option_add("*TCombobox*Listbox.selectForeground", "#061b1a")
        shell = ttk.Frame(self.root, style="App.TFrame", padding=18)
        shell.pack(fill="both", expand=True)
        header = ttk.Frame(shell, style="App.TFrame")
        header.pack(fill="x", pady=(0, 13))
        ttk.Label(header, text="◈  KITSUFLOW  /  VOICE COMPANION", style="Brand.TLabel").pack(side="left")
        self.page_buttons = {}
        nav = ttk.Frame(header, style="App.TFrame")
        nav.pack(side="right")
        for name in ("Home", "Settings"):
            button = ttk.Button(nav, text=name, style="Nav.TButton", command=lambda value=name: self.show_page(value))
            button.pack(side="left", padx=(8, 0))
            self.page_buttons[name] = button
        self.pages = {}
        for name in ("Home", "Settings"):
            page = ttk.Frame(shell, style="App.TFrame")
            self.pages[name] = page
        home = self.pages["Home"]
        intro = ttk.Frame(home, style="Card.TFrame", padding=22)
        intro.pack(fill="x")
        ttk.Label(intro, text="Voice clip controls", style="Heading.TLabel").pack(anchor="w")
        ttk.Label(intro, text="Listen for your clip phrase and send a clip request to KitsuFlowBOT.",
                  style="Muted.TLabel").pack(anchor="w", pady=(3, 13))
        ttk.Label(intro, textvariable=self.status).pack(anchor="w", pady=(0, 4))
        ttk.Label(intro, textvariable=self.phrase, style="Muted.TLabel").pack(anchor="w")
        ttk.Label(intro, textvariable=self.routing, style="Muted.TLabel").pack(anchor="w", pady=(2, 14))
        controls = ttk.Frame(intro, style="Card.TFrame")
        controls.pack(fill="x")
        self.start_button = ttk.Button(controls, text="▶  Start listening", command=self.start, style="Primary.TButton")
        self.start_button.pack(side="left")
        self.stop_button = ttk.Button(controls, text="■  Stop", command=self.stop_listening, state="disabled", style="Danger.TButton")
        self.stop_button.pack(side="left", padx=10)
        ttk.Button(controls, text="♪  Test sound", command=self.play_trigger_sound).pack(side="left")
        loghead = ttk.Frame(home, style="App.TFrame")
        loghead.pack(fill="x", pady=(18, 8))
        ttk.Label(loghead, text="Activity log", style="Brand.TLabel").pack(side="left")
        ttk.Button(loghead, text="Clear log", command=self.clear_log).pack(side="right")
        logframe = ttk.Frame(home, style="Card.TFrame", padding=9)
        logframe.pack(fill="both", expand=True)
        self.log = tk.Text(logframe, height=15, wrap="word", state="disabled",
                           bg=panel, fg=text, insertbackground=text, selectbackground="#1b766a",
                           font=("Consolas", 10), relief="flat", padx=13, pady=12, borderwidth=0)
        bar = ttk.Scrollbar(logframe, orient="vertical", command=self.log.yview)
        self.log.configure(yscrollcommand=bar.set)
        bar.pack(side="right", fill="y")
        self.log.pack(side="left", fill="both", expand=True)
        settings_page = self.pages["Settings"]
        canvas = tk.Canvas(settings_page, bg=bg, highlightthickness=0, borderwidth=0)
        scrollbar = ttk.Scrollbar(settings_page, orient="vertical", command=canvas.yview)
        canvas.configure(yscrollcommand=scrollbar.set)
        self.settings_canvas = canvas
        self.settings_page = settings_page
        self.root.bind_all("<MouseWheel>", self.scroll_settings, add="+")
        self.root.bind_all("<Button-4>", self.scroll_settings, add="+")
        self.root.bind_all("<Button-5>", self.scroll_settings, add="+")
        scrollbar.pack(side="right", fill="y")
        canvas.pack(side="left", fill="both", expand=True)
        content = ttk.Frame(canvas, style="App.TFrame", padding=(0, 0, 12, 10))
        window_id = canvas.create_window((0, 0), window=content, anchor="nw")
        content.bind("<Configure>", lambda _: canvas.configure(scrollregion=canvas.bbox("all")))
        canvas.bind("<Configure>", lambda e: canvas.itemconfigure(window_id, width=e.width))
        def card(title, description=""):
            pane = ttk.Frame(content, style="Card.TFrame", padding=17)
            pane.pack(fill="x", pady=(0, 12))
            ttk.Label(pane, text=title, style="Heading.TLabel").pack(anchor="w")
            if description:
                ttk.Label(pane, text=description, style="Muted.TLabel").pack(anchor="w", pady=(2, 9))
            return pane
        account = card("Connection", "Pair this computer with your KitsuFlowBOT creator account.")
        def row(parent, label, variable, secret=False):
            ttk.Label(parent, text=label).pack(anchor="w", pady=(9, 4))
            ttk.Entry(parent, textvariable=variable, show="•" if secret else "").pack(fill="x")
        row(account, "Dashboard URL", self.server)
        row(account, "Device pairing key", self.key, True)
        recognition = card("Speech recognition", "Choose Whisper or Vosk, then download the selected model.")
        ttk.Label(recognition, text="Speech recognition engine").pack(anchor="w", pady=(8, 4))
        ttk.Combobox(recognition, textvariable=self.engine, values=["whisper", "vosk"], state="readonly").pack(fill="x")
        ttk.Label(recognition, text="Whisper model (auto detects hardware)").pack(anchor="w", pady=(9, 4))
        ttk.Combobox(recognition, textvariable=self.whisper_model, values=["auto", *MODELS], state="readonly").pack(fill="x")
        ttk.Label(recognition, text="Whisper processing (Auto / CPU / CUDA GPU)").pack(anchor="w", pady=(9, 4))
        ttk.Combobox(recognition, textvariable=self.whisper_backend, values=["auto", "cpu", "cuda"], state="readonly").pack(fill="x")
        ttk.Label(recognition, text="GTX 980 Ti: Auto uses CPU with current faster-whisper. NVENC video encoding is separate.", style="Muted.TLabel").pack(anchor="w", pady=(6, 0))
        ttk.Label(recognition, text="Offline Vosk model folder").pack(anchor="w", pady=(9, 4))
        modelrow = ttk.Frame(recognition, style="Card.TFrame")
        modelrow.pack(fill="x")
        ttk.Entry(modelrow, textvariable=self.model).pack(side="left", fill="x", expand=True)
        ttk.Button(modelrow, text="Browse", command=self.browse_model).pack(side="left", padx=7)
        self.download_button = ttk.Button(recognition, text="Download / repair selected model", command=self.download_model)
        self.download_button.pack(anchor="w", pady=(10, 5))
        self.model_progress = ttk.Progressbar(recognition, maximum=100, mode="determinate")
        self.model_progress.pack(fill="x")
        microphone = card("Microphone", "Choose your preferred recording device. Duplicate drivers are hidden by default.")
        microw = ttk.Frame(microphone, style="Card.TFrame")
        microw.pack(fill="x", pady=(6, 0))
        self.micbox = ttk.Combobox(microw, textvariable=self.device, state="readonly")
        self.micbox.pack(side="left", fill="x", expand=True)
        ttk.Button(microw, text="Refresh", command=self.refresh_mics).pack(side="left", padx=(8, 0))
        ttk.Checkbutton(microphone, text="Show all audio devices (including virtual inputs)",
                        variable=self.show_all_mics, command=self.refresh_mics).pack(anchor="w", pady=(10, 0))
        feedback = card("Feedback", "Play a brief confirmation when your configured clip phrase is recognised.")
        ttk.Checkbutton(feedback, text="Play confirmation sound", variable=self.trigger_sound).pack(anchor="w", pady=(5, 0))
        footer = ttk.Frame(content, style="App.TFrame")
        footer.pack(fill="x", pady=(0, 12))
        ttk.Button(footer, text="Save settings", command=self.save, style="Primary.TButton").pack(side="right")
        self.show_page("Home")
        self.push("GPU: " + (self.gpu["name"] if self.gpu else "No NVIDIA GPU detected") + " • Auto Whisper model: " + recommended_model(self.gpu))
        self.push("Ready. Set up your pairing key in Settings, then start listening.")

    def show_page(self, name):
        for page in self.pages.values():
            page.pack_forget()
        self.pages[name].pack(fill="both", expand=True)
        for label, button in self.page_buttons.items():
            button.configure(style="NavActive.TButton" if label == name else "Nav.TButton")

    def scroll_settings(self, event):
        if not self.pages["Settings"].winfo_ismapped():
            return
        widget = self.root.winfo_containing(event.x_root, event.y_root)
        if widget is None or not str(widget).startswith(str(self.settings_page)):
            return
        direction = (-1 if event.num == 4 else 1 if event.num == 5 else
                     -1 if event.delta > 0 else 1)
        self.settings_canvas.yview_scroll(direction * 3, "units")
        return "break"

    def clear_log(self):
        self.log.configure(state="normal")
        self.log.delete("1.0", "end")
        self.log.configure(state="disabled")

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
            saved_name = self.settings.get("KITSUFLOW_MIC_NAME", "")
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
            chosen = next((label for label in devices if label == saved_name), None)
            if chosen is None:
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
                "KITSUFLOW_MIC_NAME": self.device.get() if selected is not None else "",
                "KITSUFLOW_TRIGGER_SOUND": "true" if self.trigger_sound.get() else "false",
                "KITSUFLOW_SHOW_ALL_MICS": "true" if self.show_all_mics.get() else "false",
                "KITSUFLOW_WHISPER_BACKEND": self.whisper_backend.get(),
                "KITSUFLOW_STT_ENGINE": self.engine.get(), "KITSUFLOW_WHISPER_MODEL": self.whisper_model.get()}

    def save(self):
        try:
            values = self.values()
            save_env(values)
            self.settings = values.copy()
            self.push("All settings saved to " + str(ENV))
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
                preference = values.get("KITSUFLOW_WHISPER_BACKEND", "auto")
                device, precision = backend(self.gpu, preference)
                try:
                    model = WhisperModel(str(model_folder), device=device, compute_type=precision)
                except (RuntimeError, ValueError, OSError) as gpu_error:
                    if device != "cuda" or preference == "cuda": raise
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
                    # Whisper inserts punctuation and may put words around the phrase.
                    # Compare token sequences so "oh my god, clip it." matches "clip it",
                    # while "clipboard" does not. Also tolerate punctuation between words.
                    spoken_words = re.findall(r"\b\w+\b", text.casefold())
                    trigger_words = re.findall(r"\b\w+\b", str(phrase).casefold())
                    matched = bool(trigger_words) and any(
                        spoken_words[i:i + len(trigger_words)] == trigger_words
                        for i in range(len(spoken_words) - len(trigger_words) + 1)
                    )
                    if not matched or now - last < config.get("cooldown", 45):
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
