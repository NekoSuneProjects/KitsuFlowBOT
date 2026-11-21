"""Settings stored in a .env file next to the executable (or this folder when run from source)."""
import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent
ENV = ROOT / ".env"

DEFAULTS = {
    # Connection
    "KITSUFLOW_URL": "https://kitsuflowbot.nekosunevr.co.uk",
    "KITSUFLOW_DEVICE_KEY": "",
    "KITSUFLOW_AUTOCONNECT": "true",
    # Voice clips
    "KITSUFLOW_STT_ENGINE": "whisper",
    "KITSUFLOW_WHISPER_MODEL": "auto",
    "KITSUFLOW_WHISPER_BACKEND": "auto",
    "KITSUFLOW_VOSK_MODEL": "model/vask",
    "KITSUFLOW_MIC_DEVICE": "",
    "KITSUFLOW_MIC_NAME": "",
    "KITSUFLOW_SHOW_ALL_MICS": "false",
    "KITSUFLOW_TRIGGER_SOUND": "true",
    # Beat Saber song requests
    "KITSUFLOW_BSR_ENABLED": "false",
    "KITSUFLOW_BEATSABER_DIR": "",
    # Minecraft Interactive (RCON)
    "KITSUFLOW_MC_ENABLED": "false",
    "KITSUFLOW_MC_HOST": "127.0.0.1",
    "KITSUFLOW_MC_PORT": "25575",
    "KITSUFLOW_MC_PASSWORD": "",
    "KITSUFLOW_MC_PLAYER": "",
    # ARK (RCON). {player} is the numeric in-game player ID.
    "KITSUFLOW_ARK_ENABLED": "false",
    "KITSUFLOW_ARK_HOST": "127.0.0.1",
    "KITSUFLOW_ARK_PORT": "27020",
    "KITSUFLOW_ARK_PASSWORD": "",
    "KITSUFLOW_ARK_PLAYER": "",
    # Other RCON game: palworld | factorio | zomboid | rcon
    "KITSUFLOW_RCON_ENABLED": "false",
    "KITSUFLOW_RCON_GAME": "palworld",
    "KITSUFLOW_RCON_HOST": "127.0.0.1",
    "KITSUFLOW_RCON_PORT": "25575",
    "KITSUFLOW_RCON_PASSWORD": "",
    "KITSUFLOW_RCON_PLAYER": "",
    # PC key presses (Windows): only typed while this window title is focused
    "KITSUFLOW_KEYS_ENABLED": "false",
    "KITSUFLOW_KEYS_WINDOW": "",
}


def truthy(value):
    return str(value).strip().lower() in ("true", "1", "yes", "on")


def read_env():
    """Saved .env values win over process environment variables, which win over defaults."""
    values = DEFAULTS.copy()
    saved = set()
    if ENV.exists():
        for line in ENV.read_text(encoding="utf-8-sig").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key, raw = key.strip(), value.strip()
            if key not in values:
                continue
            saved.add(key)
            if raw.startswith('"'):
                try:
                    values[key] = json.loads(raw)
                except (ValueError, TypeError):
                    values[key] = raw.strip('"')
            else:
                values[key] = raw.strip("'")
    for key in values:
        if key not in saved and os.environ.get(key):
            values[key] = os.environ[key]
    return values


def save_env(values):
    """Atomic write; on Linux the file is readable by the current user only (it holds secrets)."""
    def quote(v):
        return '"' + str(v).replace("\\", "\\\\").replace('"', '\\"').replace("\n", "") + '"'

    text = "# KitsuFlowBOT Assistant - keep this file private (device key, RCON password)\n" + "".join(
        key + "=" + quote(values.get(key, DEFAULTS[key])) + "\n" for key in DEFAULTS
    )
    ENV.parent.mkdir(parents=True, exist_ok=True)
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=ENV.parent, prefix=".kitsuflow-",
                                         suffix=".tmp", delete=False) as stream:
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
