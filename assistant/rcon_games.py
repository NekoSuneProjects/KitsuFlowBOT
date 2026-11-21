"""Game actions over RCON for ARK and other RCON games (Palworld, Factorio, Project Zomboid, …).

Each game has its own RCON connection settings in the app. Jobs say which game they are for;
the app refuses server-admin commands for that game even if KitsuFlowBOT sent them.
"""
import re

from minecraft import Rcon, RconError

# First word (lower-case) of commands that are never run. Mirrors the server-side lists.
BLOCKED = {
    "ark": {"doexit", "quit", "exit", "saveworld", "banplayer", "unbanplayer", "kickplayer",
            "allowplayertojoinnocheck", "disallowplayertojoinnocheck", "destroyall", "destroywilddinos",
            "destroystructures", "destroytribestructures", "destroytribedinos", "destroytribeplayers",
            "destroytribeid", "destroyallenemies", "setmessageoftheday", "enablecheats", "setcheatplayer",
            "slomo", "setglobalpause", "renameplayer", "renametribe", "settargetdinocolor"},
    "palworld": {"shutdown", "doexit", "kickplayer", "banplayer", "unbanplayer", "save"},
    "factorio": {"/quit", "/ban", "/unban", "/kick", "/promote", "/demote", "/admins", "/purge", "/server-save",
                 "/config", "/whitelist", "/mute", "/unmute", "/delete-blueprint-library"},
    "zomboid": {"quit", "save", "banuser", "unbanuser", "banid", "unbanid", "kickuser", "setaccesslevel",
                "grantadmin", "removeadmin", "adduser", "addusertowhitelist", "removeuserfromwhitelist",
                "changeoption", "reloadoptions", "reloadlua", "setpassword", "releasesafehouse"},
    "rcon": {"stop", "quit", "exit", "shutdown", "doexit", "restart", "ban", "kick", "op", "admin"},
}
LABELS = {"ark": "ARK", "palworld": "Palworld", "factorio": "Factorio", "zomboid": "Project Zomboid",
          "rcon": "RCON game"}
OTHER_GAMES = ("palworld", "factorio", "zomboid", "rcon")
# What {player} may look like per game. ARK uses the numeric in-game player ID.
PLAYER = {
    "ark": re.compile(r"^\d{1,20}$"),
    "factorio": re.compile(r"^[A-Za-z0-9_.\-]{1,60}$"),
    "zomboid": re.compile(r"^[A-Za-z0-9_.\-]{1,32}$"),
    "palworld": re.compile(r"^[A-Za-z0-9_\-]{1,32}$"),
    "rcon": re.compile(r"^[A-Za-z0-9_.\-]{1,32}$"),
}
PLAYER_HINT = {"ark": "your ARK player ID (a number, see ListPlayers)", "factorio": "your Factorio name",
               "zomboid": "your Project Zomboid username", "palworld": "your Palworld name",
               "rcon": "your player name"}
ERROR = re.compile(r"^(Unknown command|Unknown or incomplete|Command not found|Invalid command|Error:)", re.I)


def check_command(game, line):
    words = line.split()
    if not words:
        raise RconError("Empty command")
    word = words[0].lower()
    if game == "ark" and word in ("cheat", "admincheat") and len(words) > 1:
        word = words[1].lower()
    if word in BLOCKED.get(game, BLOCKED["rcon"]):
        raise RconError(f'"{word}" is a server-admin command and is not allowed')


def run_action(game, payload, host, port, password, player):
    """Runs the commands of an RCON game job. Returns a short summary; raises RconError."""
    if game not in BLOCKED:
        raise RconError("Unknown RCON game " + repr(game))
    raw = [str(c) for c in payload.get("commands", [])][:10]
    if not raw:
        raise RconError("Action has no commands")
    if any("{player}" in c for c in raw) and not PLAYER[game].match(player or ""):
        raise RconError(f"Set {PLAYER_HINT[game]} in the Assistant app (Games page)")
    commands = [c.replace("{player}", player or "") for c in raw]
    if game != "factorio":  # Factorio console commands keep their leading slash
        commands = [c.lstrip("/") for c in commands]
    for line in commands:
        check_command(game, line)
    outputs = []
    with Rcon(host, port, password) as rcon:
        for line in commands:
            outputs.append(rcon.command(line).strip())
    errors = [o for o in outputs if ERROR.search(o)]
    if errors:
        raise RconError(LABELS[game] + " said: " + errors[0][:150])
    return f"Ran {len(commands)} command(s)" + (": " + outputs[-1][:120] if outputs[-1] else "")


def test_connection(game, host, port, password):
    probe = {"ark": "ListPlayers", "palworld": "Info", "factorio": "/players online", "zomboid": "players"}
    with Rcon(host, port, password) as rcon:
        return rcon.command(probe.get(game, "help")).strip() or "Connected"
