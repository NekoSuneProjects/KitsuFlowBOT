"""KitsuFlowBOT Assistant window: Home, Voice Clips, Beat Saber, Minecraft and Settings pages."""
import os
import queue
import re
import subprocess
import sys
import threading
import time
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

import beatsaber
import minecraft
from api import ApiError, KitsuFlowApi
from jobs import JobWorker
from model_downloader import install_model, valid_model
from settings import DEFAULTS, ENV, ROOT, read_env, save_env, truthy
from version import VERSION
from voice import listen
from whisper_models import MODELS, cache_dir, ensure_whisper_model, gpu_information, model_complete, recommended_model

BG, PANEL, RAISED, BORDER = "#0b111b", "#151f2d", "#1c2b3c", "#304354"
TEXT, MUTED, TEAL = "#f2f7fd", "#9eafc2", "#48e4c2"
PAGES = ("Home", "Voice Clips", "Beat Saber", "Minecraft", "Settings")


class AssistantApp:
    def __init__(self):
        self.root = tk.Tk()
        self.root.title("KitsuFlowBOT Assistant")
        self.root.geometry("960x700")
        self.root.minsize(720, 540)
        self.settings = read_env()
        self.inbox = queue.Queue()
        self.gpu = gpu_information()
        self.worker = None
        self.voice_stop = threading.Event()
        self.voice_thread = None
        self.cancel_download = threading.Event()
        self.downloading = False
        self.closing = False
        self.devices = {"System default": None}
        # Tk variables, one per setting.
        self.vars = {}
        for key, value in self.settings.items():
            boolean = DEFAULTS[key] in ("true", "false")
            self.vars[key] = tk.BooleanVar(value=truthy(value)) if boolean else tk.StringVar(value=value)
        self.mic_choice = tk.StringVar()
        self.status = tk.StringVar(value="Disconnected")
        self.channel = tk.StringVar(value="Not connected")
        self.voice_status = tk.StringVar(value="Voice clips stopped")
        self.voice_phrase = tk.StringVar(value="Trigger phrase: —")
        self.mc_status = tk.StringVar(value="")
        self.snapshot = self.values()
        for var in list(self.vars.values()) + [self.mic_choice]:
            var.trace_add("write", lambda *_: self._refresh_snapshot())
        self._style()
        self._build()
        self.refresh_mics()
        self.root.protocol("WM_DELETE_WINDOW", self.close)
        self.root.after(100, self.process_messages)
        self.push(f"KitsuFlowBOT Assistant {VERSION}. GPU: " + (self.gpu["name"] if self.gpu else "none detected")
                  + " · auto Whisper model: " + recommended_model(self.gpu))
        if self.settings["KITSUFLOW_DEVICE_KEY"] and truthy(self.settings["KITSUFLOW_AUTOCONNECT"]):
            self.root.after(500, self.connect)
        elif not self.settings["KITSUFLOW_DEVICE_KEY"]:
            self.push("Open Settings and paste the device key from Studio → Voice & Clips → Pair a PC.")

    # ---------------------------------------------------------------- settings
    def values(self):
        out = {}
        for key, var in self.vars.items():
            value = var.get()
            out[key] = ("true" if value else "false") if isinstance(var, tk.BooleanVar) else str(value).strip()
        selected = self.devices.get(self.mic_choice.get())
        out["KITSUFLOW_MIC_DEVICE"] = "" if selected is None else str(selected)
        out["KITSUFLOW_MIC_NAME"] = self.mic_choice.get() if selected is not None else ""
        return out

    def _refresh_snapshot(self):
        self.snapshot = self.values()  # read by the job worker thread

    def save(self, quiet=False):
        try:
            values = self.values()
            save_env(values)
            self.settings = values
            if not quiet:
                self.push("Settings saved to " + str(ENV))
        except Exception as exc:
            messagebox.showerror("Cannot save settings", str(exc))

    # ---------------------------------------------------------------- layout
    def _style(self):
        self.root.configure(bg=BG)
        style = ttk.Style(self.root)
        if "clam" in style.theme_names():
            style.theme_use("clam")
        style.configure("App.TFrame", background=BG)
        style.configure("Card.TFrame", background=PANEL)
        style.configure("TFrame", background=PANEL)
        style.configure("TLabel", background=PANEL, foreground=TEXT, font=("Segoe UI", 10))
        style.configure("Muted.TLabel", foreground=MUTED)
        style.configure("Heading.TLabel", foreground=TEXT, font=("Segoe UI Semibold", 15))
        style.configure("Brand.TLabel", background=BG, foreground=TEAL, font=("Segoe UI Semibold", 16))
        style.configure("TButton", background="#1b3147", foreground=TEXT, bordercolor=BORDER, lightcolor="#1b3147",
                        darkcolor="#1b3147", padding=(14, 8), font=("Segoe UI Semibold", 10), relief="flat")
        style.map("TButton", background=[("active", "#294860"), ("disabled", "#192837")],
                  foreground=[("disabled", "#738b9f")])
        for name, color, fg in (("Primary.TButton", "#159f8a", "#061b1a"), ("Danger.TButton", "#57323f", "#ffe8ee"),
                                ("Nav.TButton", "#1b3147", TEXT), ("NavActive.TButton", "#159f8a", "#061b1a")):
            style.configure(name, background=color, foreground=fg, bordercolor=color, lightcolor=color,
                            darkcolor=color, padding=(16, 9), font=("Segoe UI Semibold", 10), relief="flat")
        style.map("Primary.TButton", background=[("active", "#31d2b6"), ("disabled", "#355657")])
        style.map("Danger.TButton", background=[("active", "#784356"), ("disabled", "#392b34")])
        style.map("Nav.TButton", background=[("active", "#294860")])
        style.configure("TEntry", fieldbackground=RAISED, foreground=TEXT, bordercolor=BORDER, lightcolor=BORDER,
                        darkcolor=BORDER, insertcolor=TEXT, padding=7)
        style.configure("TCombobox", fieldbackground=RAISED, background=RAISED, foreground=TEXT, bordercolor=BORDER,
                        lightcolor=BORDER, darkcolor=BORDER, arrowcolor=TEXT, padding=7)
        style.map("TCombobox", fieldbackground=[("readonly", RAISED)], foreground=[("readonly", TEXT)],
                  selectbackground=[("readonly", RAISED)], selectforeground=[("readonly", TEXT)])
        style.configure("TCheckbutton", background=PANEL, foreground=TEXT)
        style.map("TCheckbutton", background=[("active", PANEL)])
        style.configure("TProgressbar", troughcolor=RAISED, background=TEAL, borderwidth=0)
        self.root.option_add("*TCombobox*Listbox.background", RAISED)
        self.root.option_add("*TCombobox*Listbox.foreground", TEXT)

    def _build(self):
        shell = ttk.Frame(self.root, style="App.TFrame", padding=16)
        shell.pack(fill="both", expand=True)
        header = ttk.Frame(shell, style="App.TFrame")
        header.pack(fill="x", pady=(0, 12))
        ttk.Label(header, text="◈  KITSUFLOWBOT  /  ASSISTANT", style="Brand.TLabel").pack(side="left")
        nav = ttk.Frame(header, style="App.TFrame")
        nav.pack(side="right")
        self.nav_buttons, self.pages, self.canvases = {}, {}, {}
        for name in PAGES:
            button = ttk.Button(nav, text=name, style="Nav.TButton", command=lambda n=name: self.show(n))
            button.pack(side="left", padx=(6, 0))
            self.nav_buttons[name] = button
        self.body = ttk.Frame(shell, style="App.TFrame")
        self.body.pack(fill="both", expand=True)
        self._home()
        self._voice_page()
        self._beatsaber_page()
        self._minecraft_page()
        self._settings_page()
        self.root.bind_all("<MouseWheel>", self._wheel, add="+")
        self.root.bind_all("<Button-4>", self._wheel, add="+")
        self.root.bind_all("<Button-5>", self._wheel, add="+")
        for event in ("<MouseWheel>", "<Button-4>", "<Button-5>"):
            self.root.bind_class("TCombobox", event, self._wheel)  # don't cycle selections on scroll
        self.show("Home")

    def _scroll_page(self, name):
        outer = ttk.Frame(self.body, style="App.TFrame")
        canvas = tk.Canvas(outer, bg=BG, highlightthickness=0, borderwidth=0)
        bar = ttk.Scrollbar(outer, orient="vertical", command=canvas.yview)
        canvas.configure(yscrollcommand=bar.set)
        bar.pack(side="right", fill="y")
        canvas.pack(side="left", fill="both", expand=True)
        inner = ttk.Frame(canvas, style="App.TFrame", padding=(0, 0, 12, 10))
        window = canvas.create_window((0, 0), window=inner, anchor="nw")
        inner.bind("<Configure>", lambda _: canvas.configure(scrollregion=canvas.bbox("all")))
        canvas.bind("<Configure>", lambda e: canvas.itemconfigure(window, width=e.width))
        self.pages[name], self.canvases[name] = outer, canvas
        return inner

    def _wheel(self, event):
        current = next((n for n, p in self.pages.items() if p.winfo_ismapped()), None)
        canvas = self.canvases.get(current)
        if not canvas:
            return None
        direction = -1 if event.num == 4 else 1 if event.num == 5 else (-1 if event.delta > 0 else 1)
        canvas.yview_scroll(direction * 3, "units")
        return "break"

    def show(self, name):
        for page in self.pages.values():
            page.pack_forget()
        self.pages[name].pack(fill="both", expand=True)
        for label, button in self.nav_buttons.items():
            button.configure(style="NavActive.TButton" if label == name else "Nav.TButton")

    @staticmethod
    def _card(parent, title, description=""):
        pane = ttk.Frame(parent, style="Card.TFrame", padding=16)
        pane.pack(fill="x", pady=(0, 12))
        ttk.Label(pane, text=title, style="Heading.TLabel").pack(anchor="w")
        if description:
            ttk.Label(pane, text=description, style="Muted.TLabel", wraplength=820, justify="left").pack(anchor="w", pady=(2, 8))
        return pane

    def _entry(self, parent, label, key, secret=False):
        ttk.Label(parent, text=label).pack(anchor="w", pady=(8, 3))
        entry = ttk.Entry(parent, textvariable=self.vars[key], show="•" if secret else "")
        entry.pack(fill="x")
        return entry

    def _check(self, parent, label, key):
        ttk.Checkbutton(parent, text=label, variable=self.vars[key]).pack(anchor="w", pady=(8, 0))

    def _save_row(self, parent):
        row = ttk.Frame(parent, style="App.TFrame")
        row.pack(fill="x", pady=(0, 12))
        ttk.Button(row, text="Save settings", style="Primary.TButton", command=self.save).pack(side="right")

    # ---------------------------------------------------------------- pages
    def _home(self):
        page = ttk.Frame(self.body, style="App.TFrame")
        self.pages["Home"] = page
        top = self._card(page, "Connection", "The Assistant connects to your KitsuFlowBOT dashboard and runs voice clips, "
                                             "Beat Saber song requests and Minecraft actions for your channel.")
        ttk.Label(top, textvariable=self.status).pack(anchor="w")
        ttk.Label(top, textvariable=self.channel, style="Muted.TLabel").pack(anchor="w", pady=(2, 10))
        row = ttk.Frame(top, style="Card.TFrame")
        row.pack(fill="x")
        self.connect_button = ttk.Button(row, text="Connect", style="Primary.TButton", command=self.toggle_connection)
        self.connect_button.pack(side="left")
        ttk.Button(row, text="Open Settings", command=lambda: self.show("Settings")).pack(side="left", padx=8)
        head = ttk.Frame(page, style="App.TFrame")
        head.pack(fill="x", pady=(6, 6))
        ttk.Label(head, text="Activity log", style="Brand.TLabel").pack(side="left")
        ttk.Button(head, text="Clear", command=self.clear_log).pack(side="right")
        frame = ttk.Frame(page, style="Card.TFrame", padding=8)
        frame.pack(fill="both", expand=True)
        self.log = tk.Text(frame, height=14, wrap="word", state="disabled", bg=PANEL, fg=TEXT, insertbackground=TEXT,
                           font=("Consolas", 10), relief="flat", padx=12, pady=10, borderwidth=0)
        bar = ttk.Scrollbar(frame, orient="vertical", command=self.log.yview)
        self.log.configure(yscrollcommand=bar.set)
        bar.pack(side="right", fill="y")
        self.log.pack(side="left", fill="both", expand=True)

    def _voice_page(self):
        page = self._scroll_page("Voice Clips")
        control = self._card(page, "Voice clips", "Say your clip phrase and the Assistant asks KitsuFlowBOT to clip your "
                                                  "Twitch stream. Speech is recognised on this PC; audio is never uploaded.")
        ttk.Label(control, textvariable=self.voice_status).pack(anchor="w")
        ttk.Label(control, textvariable=self.voice_phrase, style="Muted.TLabel").pack(anchor="w", pady=(2, 10))
        row = ttk.Frame(control, style="Card.TFrame")
        row.pack(fill="x")
        self.voice_start = ttk.Button(row, text="▶  Start listening", style="Primary.TButton", command=self.start_voice)
        self.voice_start.pack(side="left")
        self.voice_stop_button = ttk.Button(row, text="■  Stop", style="Danger.TButton", command=self.stop_voice, state="disabled")
        self.voice_stop_button.pack(side="left", padx=8)
        ttk.Button(row, text="♪  Test sound", command=self.play_trigger_sound).pack(side="left")
        rec = self._card(page, "Speech recognition", "Whisper (recommended) or Vosk. Models download once into model/.")
        ttk.Label(rec, text="Engine").pack(anchor="w", pady=(6, 3))
        ttk.Combobox(rec, textvariable=self.vars["KITSUFLOW_STT_ENGINE"], values=["whisper", "vosk"], state="readonly").pack(fill="x")
        ttk.Label(rec, text="Whisper model (auto picks one for your hardware)").pack(anchor="w", pady=(8, 3))
        ttk.Combobox(rec, textvariable=self.vars["KITSUFLOW_WHISPER_MODEL"], values=["auto", *MODELS], state="readonly").pack(fill="x")
        ttk.Label(rec, text="Whisper processing").pack(anchor="w", pady=(8, 3))
        ttk.Combobox(rec, textvariable=self.vars["KITSUFLOW_WHISPER_BACKEND"], values=["auto", "cpu", "cuda"], state="readonly").pack(fill="x")
        self._entry(rec, "Vosk model folder", "KITSUFLOW_VOSK_MODEL")
        self.download_button = ttk.Button(rec, text="Download / repair selected model", command=self.download_model)
        self.download_button.pack(anchor="w", pady=(10, 5))
        self.model_progress = ttk.Progressbar(rec, maximum=100, mode="determinate")
        self.model_progress.pack(fill="x")
        mic = self._card(page, "Microphone")
        row = ttk.Frame(mic, style="Card.TFrame")
        row.pack(fill="x", pady=(6, 0))
        self.micbox = ttk.Combobox(row, textvariable=self.mic_choice, state="readonly")
        self.micbox.pack(side="left", fill="x", expand=True)
        ttk.Button(row, text="Refresh", command=self.refresh_mics).pack(side="left", padx=(8, 0))
        ttk.Checkbutton(mic, text="Show all audio devices (including virtual inputs)",
                        variable=self.vars["KITSUFLOW_SHOW_ALL_MICS"], command=self.refresh_mics).pack(anchor="w", pady=(8, 0))
        self._check(mic, "Play a confirmation sound when the phrase is recognised", "KITSUFLOW_TRIGGER_SOUND")
        self._save_row(page)

    def _beatsaber_page(self):
        page = self._scroll_page("Beat Saber")
        card = self._card(page, "Beat Saber song requests (PC)",
                          "Viewers type !bsr <BeatSaver key> in your Twitch chat. Turn on !bsr in Studio → Assistant App, then "
                          "the map downloads from BeatSaver into Beat Saber_Data/CustomLevels and the bot confirms in chat.")
        self._check(card, "Install song requests on this PC", "KITSUFLOW_BSR_ENABLED")
        self._entry(card, "Beat Saber game folder (contains 'Beat Saber_Data')", "KITSUFLOW_BEATSABER_DIR")
        row = ttk.Frame(card, style="Card.TFrame")
        row.pack(fill="x", pady=(8, 0))
        ttk.Button(row, text="Browse", command=self.browse_beatsaber).pack(side="left")
        ttk.Button(row, text="Detect", command=self.detect_beatsaber).pack(side="left", padx=8)
        ttk.Button(row, text="Open CustomLevels", command=self.open_custom_levels).pack(side="left")
        recent = self._card(page, "Installed this session")
        self.bsr_list = tk.Listbox(recent, height=8, bg=RAISED, fg=TEXT, relief="flat", highlightthickness=0,
                                   selectbackground="#1b766a", font=("Segoe UI", 10))
        self.bsr_list.pack(fill="x")
        self._save_row(page)

    def _minecraft_page(self):
        page = self._scroll_page("Minecraft")
        card = self._card(page, "Minecraft Interactive (RCON)",
                          "Chat commands, stream events and Studio tests run Minecraft commands on your server. In "
                          "server.properties set enable-rcon=true, rcon.port and a long rcon.password, and keep that port "
                          "closed to the internet. Create actions in Studio → Assistant App.")
        self._check(card, "Run Minecraft actions on this PC", "KITSUFLOW_MC_ENABLED")
        self._entry(card, "RCON host", "KITSUFLOW_MC_HOST")
        self._entry(card, "RCON port", "KITSUFLOW_MC_PORT")
        self._entry(card, "RCON password", "KITSUFLOW_MC_PASSWORD", secret=True)
        self._entry(card, "Your Minecraft player name (used for {player})", "KITSUFLOW_MC_PLAYER")
        row = ttk.Frame(card, style="Card.TFrame")
        row.pack(fill="x", pady=(10, 0))
        ttk.Button(row, text="Test RCON connection", command=self.test_rcon).pack(side="left")
        ttk.Label(row, textvariable=self.mc_status, style="Muted.TLabel").pack(side="left", padx=10)
        actions = self._card(page, "Actions from Studio", "Refreshed every minute while connected.")
        self.mc_list = tk.Listbox(actions, height=8, bg=RAISED, fg=TEXT, relief="flat", highlightthickness=0,
                                  selectbackground="#1b766a", font=("Segoe UI", 10))
        self.mc_list.pack(fill="x")
        self._save_row(page)

    def _settings_page(self):
        page = self._scroll_page("Settings")
        card = self._card(page, "KitsuFlowBOT connection",
                          "Pair this PC in Studio → Voice & Clips → Pair a PC and paste the one-time device key here. "
                          "Revoke it in Studio if this PC is lost.")
        self._entry(card, "Dashboard URL", "KITSUFLOW_URL")
        self._entry(card, "Device pairing key", "KITSUFLOW_DEVICE_KEY", secret=True)
        self._check(card, "Connect automatically when the app starts", "KITSUFLOW_AUTOCONNECT")
        ttk.Label(card, text="Settings are stored in " + str(ENV), style="Muted.TLabel").pack(anchor="w", pady=(10, 0))
        self._save_row(page)

    # ---------------------------------------------------------------- log + messages
    def push(self, message):
        self.log.configure(state="normal")
        self.log.insert("end", time.strftime("%H:%M:%S") + "  " + str(message) + "\n")
        if int(self.log.index("end-1c").split(".")[0]) > 1500:
            self.log.delete("1.0", "200.0")
        self.log.see("end")
        self.log.configure(state="disabled")

    def clear_log(self):
        self.log.configure(state="normal")
        self.log.delete("1.0", "end")
        self.log.configure(state="disabled")

    def emit(self, kind, value):
        self.inbox.put((kind, value))

    def process_messages(self):
        if self.closing:
            return
        try:
            while True:
                kind, value = self.inbox.get_nowait()
                if kind == "log":
                    self.push(value)
                elif kind == "status":
                    self.status.set(value)
                elif kind == "voice_status":
                    self.voice_status.set(value)
                elif kind == "config":
                    self.voice_phrase.set("Trigger phrase: " + value.get("phrase", "clip it") + " · platforms: "
                                          + ", ".join(value.get("platforms", [])))
                elif kind == "assistant_config":
                    self._apply_assistant_config(value)
                elif kind == "bsr_installed":
                    self.bsr_list.insert(0, time.strftime("%H:%M  ") + value)
                elif kind == "model_progress":
                    self.model_progress["value"] = value[0]
                    self.voice_status.set(value[1])
                elif kind == "model_done":
                    self.downloading = False
                    self.download_button.config(state="normal")
                    self.voice_status.set("Model ready" if value else "Model download failed")
                    if value == "listen":
                        self.start_voice()
                elif kind == "trigger_sound":
                    self.play_trigger_sound()
                elif kind == "voice_stopped":
                    self.voice_status.set("Voice clips stopped")
                    self.voice_start.config(state="normal")
                    self.voice_stop_button.config(state="disabled")
                elif kind == "rcon":
                    self.mc_status.set(value)
                elif kind == "worker_stopped":
                    if not (self.worker and self.worker.is_alive()):
                        self.status.set("Disconnected")
                        self.connect_button.config(text="Connect", style="Primary.TButton")
        except queue.Empty:
            pass
        self.root.after(100, self.process_messages)

    def _apply_assistant_config(self, config):
        name = config.get("channel") or "your channel"
        features = ["Beat Saber requests " + ("on" if config.get("bsr", {}).get("enabled") else "off in Studio")]
        actions = config.get("minecraft", {}).get("actions", [])
        features.append(f"{len(actions)} Minecraft action(s)")
        self.channel.set("Channel: " + name + " · " + " · ".join(features))
        self.mc_list.delete(0, "end")
        for a in actions:
            trigger = "!" + a["command"] if a["trigger_type"] == "command" else "on " + str(a.get("event_type"))
            self.mc_list.insert("end", f"{a['name']}  ({trigger})" + ("" if a.get("enabled") else "  [off]"))

    # ---------------------------------------------------------------- connection
    def toggle_connection(self):
        if self.worker and self.worker.is_alive():
            self.disconnect()
        else:
            self.connect()

    def connect(self):
        values = self.values()
        try:
            api = KitsuFlowApi(values["KITSUFLOW_URL"], values["KITSUFLOW_DEVICE_KEY"])
        except ApiError as exc:
            messagebox.showwarning("Cannot connect", str(exc))
            self.show("Settings")
            return
        self.save(quiet=True)
        self.disconnect()
        self.api = api
        self.worker = JobWorker(api, lambda: self.snapshot, self.emit)
        original_run = self.worker.run

        def run_and_notify():
            try:
                original_run()
            finally:
                self.emit("worker_stopped", None)

        self.worker.run = run_and_notify
        self.worker.start()
        self.status.set("Connected")
        self.connect_button.config(text="Disconnect", style="Danger.TButton")
        self.push("Connected to " + api.server)

    def disconnect(self):
        if self.worker:
            self.worker.stop()
            self.worker = None
            self.status.set("Disconnected")
            self.connect_button.config(text="Connect", style="Primary.TButton")

    # ---------------------------------------------------------------- voice
    def _model_path(self, values):
        path = Path(values["KITSUFLOW_VOSK_MODEL"]).expanduser()
        return path if path.is_absolute() else ROOT / path

    def start_voice(self):
        values = self.values()
        try:
            api = KitsuFlowApi(values["KITSUFLOW_URL"], values["KITSUFLOW_DEVICE_KEY"])
        except ApiError as exc:
            messagebox.showwarning("Pairing required", str(exc))
            return
        if self.voice_thread and self.voice_thread.is_alive():
            return
        model_path = self._model_path(values)
        if values["KITSUFLOW_STT_ENGINE"] == "vosk" and not valid_model(model_path):
            if model_path.exists():
                messagebox.showerror("Invalid model folder", "Choose an empty folder or a valid Vosk model.")
                return
            self.push("Vosk model missing; downloading it before listening.")
            return self.download_model(then_listen=True)
        if values["KITSUFLOW_STT_ENGINE"] == "whisper":
            selected = values["KITSUFLOW_WHISPER_MODEL"]
            selected = recommended_model(self.gpu) if selected == "auto" else selected
            if not model_complete(cache_dir(ROOT, selected)):
                self.push("Downloading Whisper " + selected + " before listening.")
                return self.download_model(then_listen=True)
        self.voice_stop.clear()
        self.voice_start.config(state="disabled")
        self.voice_stop_button.config(state="normal")
        self.voice_thread = threading.Thread(
            target=listen, daemon=True,
            args=(api, values, model_path, self.gpu, self.voice_stop,
                  lambda kind, value: self.emit("voice_status" if kind == "status" else kind, value)))
        self.voice_thread.start()

    def stop_voice(self):
        self.voice_stop.set()
        self.voice_status.set("Stopping…")

    def download_model(self, then_listen=False):
        if self.downloading:
            return
        self.downloading = True
        self.cancel_download.clear()
        self.download_button.config(state="disabled")
        values = self.values()
        model_path = self._model_path(values)

        def worker():
            try:
                progress = lambda p, msg: self.emit("model_progress", (p, msg))
                if values["KITSUFLOW_STT_ENGINE"] == "whisper":
                    selected = values["KITSUFLOW_WHISPER_MODEL"]
                    selected = recommended_model(self.gpu) if selected == "auto" else selected
                    ensure_whisper_model(ROOT, selected, progress, cancel=self.cancel_download)
                else:
                    install_model(model_path, progress, cancel=self.cancel_download)
                if not self.cancel_download.is_set():
                    self.emit("model_done", "listen" if then_listen else True)
            except InterruptedError:
                self.emit("log", "Model download cancelled.")
                self.emit("model_done", False)
            except Exception as exc:
                self.emit("log", "Model download error: " + str(exc))
                self.emit("model_done", False)

        threading.Thread(target=worker, daemon=True).start()

    def play_trigger_sound(self):
        if not self.vars["KITSUFLOW_TRIGGER_SOUND"].get():
            return self.push("Enable the confirmation sound to hear the test.")

        def play():
            try:
                import numpy as np
                import sounddevice as sd
                rate = 24000

                def note(hz, duration):
                    t = np.arange(int(rate * duration), dtype=np.float32) / rate
                    envelope = np.minimum(1.0, t / 0.015) * np.minimum(1.0, (duration - t) / 0.045)
                    return (0.14 * np.sin(2 * np.pi * hz * t) * envelope).astype(np.float32)

                sd.play(np.concatenate((note(660, 0.10), np.zeros(int(rate * 0.04), dtype=np.float32), note(880, 0.14))),
                        samplerate=rate, blocking=True)
            except Exception as exc:
                self.emit("log", "Confirmation sound unavailable: " + str(exc))

        threading.Thread(target=play, daemon=True).start()

    def refresh_mics(self):
        try:
            import sounddevice as sd
            raw, apis = sd.query_devices(), sd.query_hostapis()
            saved_name, persisted = self.settings.get("KITSUFLOW_MIC_NAME", ""), self.settings.get("KITSUFLOW_MIC_DEVICE", "")
            show_all = self.vars["KITSUFLOW_SHOW_ALL_MICS"].get()
            candidates = []
            for index, item in enumerate(raw):
                if item["max_input_channels"] <= 0 or not str(item["name"]).strip():
                    continue
                name, api = str(item["name"]).strip(), str(apis[item["hostapi"]]["name"])
                # Windows lists each microphone through MME, DirectSound, WASAPI and WDM-KS.
                key = re.sub(r"[^a-z0-9]+", "", re.sub(r"\s*\((?:[0-9]+-\s*)?\w*(?:input|output)\w*\)\s*$", "", name, flags=re.I).lower())
                hidden = any(x in name.lower() for x in ("microsoft sound mapper", "primary sound capture driver",
                                                         "stereo mix", "what u hear", "wave out mix", "loopback", "monitor of "))
                priority = 0 if "MME" in api else 1 if "WASAPI" in api else 2 if "DirectSound" in api else 3
                candidates.append((hidden, priority, index, name, api, key))
            candidates.sort(key=lambda x: (x[0], x[1], x[2]))
            devices, seen = {"System default": None}, set()
            for hidden, _, index, name, api, key in candidates:
                if not show_all and (hidden or key in seen):
                    continue
                seen.add(key)
                label = f"{name} ({api})" if show_all else name
                devices[label if label not in devices else f"{label} [{index}]"] = index
            self.devices = devices
            self.micbox["values"] = list(devices)
            chosen = saved_name if saved_name in devices else next(
                (label for label, i in devices.items() if i is not None and persisted.isdigit() and i == int(persisted)), None)
            self.mic_choice.set(chosen or "System default")
        except Exception as exc:
            self.push("Microphone listing failed: " + str(exc))

    # ---------------------------------------------------------------- beat saber / minecraft helpers
    def browse_beatsaber(self):
        folder = filedialog.askdirectory(title="Select your Beat Saber game folder")
        if folder:
            self.vars["KITSUFLOW_BEATSABER_DIR"].set(folder)
            if not beatsaber.is_game_folder(folder):
                messagebox.showwarning("Beat Saber", "That folder has no 'Beat Saber_Data'. Pick the game's install folder.")

    def detect_beatsaber(self):
        found = beatsaber.detect_game_folder()
        if found:
            self.vars["KITSUFLOW_BEATSABER_DIR"].set(found)
            self.push("Beat Saber found: " + found)
        else:
            messagebox.showinfo("Beat Saber", "Beat Saber was not found in the usual Steam/Oculus folders. Use Browse.")

    def open_custom_levels(self):
        try:
            folder = beatsaber.custom_levels(self.vars["KITSUFLOW_BEATSABER_DIR"].get())
        except beatsaber.InstallError as exc:
            return messagebox.showwarning("Beat Saber", str(exc))
        if os.name == "nt":
            os.startfile(folder)  # noqa: S606 - opens the folder in Explorer
        else:
            subprocess.Popen(["xdg-open" if sys.platform != "darwin" else "open", str(folder)])

    def test_rcon(self):
        values = self.values()
        self.mc_status.set("Testing…")

        def run():
            try:
                result = minecraft.test_connection(values["KITSUFLOW_MC_HOST"], values["KITSUFLOW_MC_PORT"],
                                                   values["KITSUFLOW_MC_PASSWORD"])
                self.emit("rcon", "✓ " + result[:90])
            except Exception as exc:
                self.emit("rcon", "✗ " + str(exc))

        threading.Thread(target=run, daemon=True).start()

    # ---------------------------------------------------------------- lifecycle
    def close(self):
        if self.closing:
            return
        self.closing = True
        self.voice_stop.set()
        self.cancel_download.set()
        if self.worker:
            self.worker.stop()
        self.root.destroy()  # worker threads are daemons; never hang on close

    def run(self):
        self.root.mainloop()
