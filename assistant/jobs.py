"""Background worker: polls KitsuFlowBOT for Assistant jobs (Beat Saber, game actions) and reports results."""
import threading
import time

import beatsaber
import keys
import minecraft
import rcon_games
from api import ApiError
from settings import truthy

POLL_SECONDS = 3
CONFIG_SECONDS = 60


class JobWorker(threading.Thread):
    """`get_settings()` returns the current settings dict; `emit(kind, value)` reports to the UI."""

    def __init__(self, api, get_settings, emit):
        super().__init__(daemon=True)
        self.api = api
        self.get_settings = get_settings
        self.emit = emit
        self.stop_event = threading.Event()
        self.key_sender = None  # tests inject a fake; None uses Windows SendInput

    def stop(self):
        self.stop_event.set()

    def run(self):
        failures, last_config = 0, 0.0
        while not self.stop_event.is_set():
            try:
                if time.monotonic() - last_config > CONFIG_SECONDS:
                    self.emit("assistant_config", self.api.assistant_config())
                    last_config = time.monotonic()
                jobs = self.api.next_jobs()
                if failures:
                    self.emit("status", "Connected")
                failures = 0
                for job in jobs:
                    if self.stop_event.is_set():
                        break
                    self.handle(job)
            except ApiError as exc:
                failures += 1
                self.emit("status", "Connection problem")
                if failures in (1, 5) or failures % 20 == 0:
                    self.emit("log", "KitsuFlowBOT: " + str(exc))
                if exc.status == 401:
                    self.emit("status", "Device key rejected")
                    self.stop_event.wait(60)
                    continue
            except Exception as exc:  # never let the worker die
                failures += 1
                self.emit("log", "Job worker error: " + str(exc))
            self.stop_event.wait(POLL_SECONDS if not failures else min(60, POLL_SECONDS * 2 ** min(failures, 4)))

    def handle(self, job):
        kind, payload, settings = job.get("kind"), job.get("payload") or {}, self.get_settings()
        try:
            if kind == "bsr":
                if not truthy(settings.get("KITSUFLOW_BSR_ENABLED")):
                    raise RuntimeError("Song requests are turned off in the Assistant app")
                title = f"{payload.get('songAuthor', '')} - {payload.get('songName', '')} [{payload.get('key', '')}]"
                self.emit("log", "Beat Saber: installing " + title)
                message = beatsaber.install_map(payload, settings.get("KITSUFLOW_BEATSABER_DIR", ""))
                self.emit("bsr_installed", title)
            elif kind == "minecraft":
                if not truthy(settings.get("KITSUFLOW_MC_ENABLED")):
                    raise RuntimeError("Minecraft Interactive is turned off in the Assistant app")
                self.emit("log", "Minecraft: " + str(payload.get("action", "action")))
                message = minecraft.run_action(
                    payload, settings.get("KITSUFLOW_MC_HOST", "127.0.0.1"), settings.get("KITSUFLOW_MC_PORT", "25575"),
                    settings.get("KITSUFLOW_MC_PASSWORD", ""), settings.get("KITSUFLOW_MC_PLAYER", ""))
            elif kind == "ark":
                if not truthy(settings.get("KITSUFLOW_ARK_ENABLED")):
                    raise RuntimeError("ARK actions are turned off in the Assistant app")
                self.emit("log", "ARK: " + str(payload.get("action", "action")))
                message = rcon_games.run_action(
                    "ark", payload, settings.get("KITSUFLOW_ARK_HOST", "127.0.0.1"),
                    settings.get("KITSUFLOW_ARK_PORT", "27020"), settings.get("KITSUFLOW_ARK_PASSWORD", ""),
                    settings.get("KITSUFLOW_ARK_PLAYER", ""))
            elif kind == "rcon":
                game, configured = str(payload.get("game", "rcon")), settings.get("KITSUFLOW_RCON_GAME", "rcon")
                if not truthy(settings.get("KITSUFLOW_RCON_ENABLED")):
                    raise RuntimeError("RCON game actions are turned off in the Assistant app")
                if game != configured:
                    raise RuntimeError(f"This action is for {rcon_games.LABELS.get(game, game)}, but the app is "
                                       f"set up for {rcon_games.LABELS.get(configured, configured)}")
                self.emit("log", rcon_games.LABELS.get(game, game) + ": " + str(payload.get("action", "action")))
                message = rcon_games.run_action(
                    game, payload, settings.get("KITSUFLOW_RCON_HOST", "127.0.0.1"),
                    settings.get("KITSUFLOW_RCON_PORT", "25575"), settings.get("KITSUFLOW_RCON_PASSWORD", ""),
                    settings.get("KITSUFLOW_RCON_PLAYER", ""))
            elif kind == "keys":
                if not truthy(settings.get("KITSUFLOW_KEYS_ENABLED")):
                    raise RuntimeError("Key presses are turned off in the Assistant app")
                self.emit("log", "Keys: " + str(payload.get("action", "action")))
                message = keys.run_action(payload, settings.get("KITSUFLOW_KEYS_WINDOW", ""), sender=self.key_sender)
            else:
                raise RuntimeError("This Assistant version does not support '" + str(kind) + "' jobs; please update")
            ok = True
        except Exception as exc:
            ok, message = False, str(exc) or exc.__class__.__name__
        self.emit("log", ("  ✓ " if ok else "  ✗ ") + message)
        try:
            self.api.report(job["id"], ok, message)
        except ApiError as exc:
            self.emit("log", "Could not report job result: " + str(exc))
