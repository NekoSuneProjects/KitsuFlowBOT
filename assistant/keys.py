"""PC key presses: chat commands press keys / mouse buttons in the focused game (Windows).

Safety:
  * Keys are only sent while the foreground window's title contains the text set in the app
    (e.g. "Minecraft" or "ELDEN RING"), so actions never type into Discord, OBS or a browser.
  * Only known game keys; Windows/meta keys, Alt+F4, Alt+Tab, Ctrl+Esc… are refused.
  * At most 10 steps, 5 s per hold and 15 s per action; actions never overlap.
Scan codes are used (not virtual keys) so games that read DirectInput / raw input see them.
"""
import sys
import threading
import time

SCAN = {
    "esc": 0x01, "1": 0x02, "2": 0x03, "3": 0x04, "4": 0x05, "5": 0x06, "6": 0x07, "7": 0x08, "8": 0x09,
    "9": 0x0A, "0": 0x0B, "minus": 0x0C, "equals": 0x0D, "backspace": 0x0E, "tab": 0x0F,
    "q": 0x10, "w": 0x11, "e": 0x12, "r": 0x13, "t": 0x14, "y": 0x15, "u": 0x16, "i": 0x17, "o": 0x18,
    "p": 0x19, "lbracket": 0x1A, "rbracket": 0x1B, "enter": 0x1C, "ctrl": 0x1D, "a": 0x1E, "s": 0x1F,
    "d": 0x20, "f": 0x21, "g": 0x22, "h": 0x23, "j": 0x24, "k": 0x25, "l": 0x26, "semicolon": 0x27,
    "quote": 0x28, "backtick": 0x29, "shift": 0x2A, "backslash": 0x2B, "z": 0x2C, "x": 0x2D, "c": 0x2E,
    "v": 0x2F, "b": 0x30, "n": 0x31, "m": 0x32, "comma": 0x33, "period": 0x34, "slash": 0x35,
    "alt": 0x38, "space": 0x39, "capslock": 0x3A, "f1": 0x3B, "f2": 0x3C, "f3": 0x3D, "f4": 0x3E,
    "f5": 0x3F, "f6": 0x40, "f7": 0x41, "f8": 0x42, "f9": 0x43, "f10": 0x44, "f11": 0x57, "f12": 0x58,
    "num7": 0x47, "num8": 0x48, "num9": 0x49, "num4": 0x4B, "num5": 0x4C, "num6": 0x4D, "num1": 0x4F,
    "num2": 0x50, "num3": 0x51, "num0": 0x52,
}
# Keys that need the E0 "extended" prefix.
EXTENDED = {"up": 0x48, "down": 0x50, "left": 0x4B, "right": 0x4D, "insert": 0x52, "delete": 0x53,
            "home": 0x47, "end": 0x4F, "pageup": 0x49, "pagedown": 0x51}
MOUSE = {"click": (0x0002, 0x0004), "rclick": (0x0008, 0x0010), "mclick": (0x0020, 0x0040)}
BLOCKED_COMBOS = [{"alt", "f4"}, {"alt", "tab"}, {"ctrl", "esc"}, {"ctrl", "shift", "esc"}, {"ctrl", "alt", "delete"}]
MAX_HOLD_MS, MAX_TOTAL_MS, MAX_STEPS = 5000, 15000, 10
_lock = threading.Lock()


class KeyPressError(Exception):
    pass


def validate(steps):
    """Checks job steps ([{keys, hold} | {wait}]) and returns them normalised."""
    if not isinstance(steps, list) or not steps:
        raise KeyPressError("Action has no key steps")
    if len(steps) > MAX_STEPS:
        raise KeyPressError(f"At most {MAX_STEPS} key steps")
    out, total = [], 0
    for step in steps:
        if not isinstance(step, dict):
            raise KeyPressError("Bad key step")
        if "wait" in step:
            ms = int(step["wait"])
            if not 10 <= ms <= MAX_HOLD_MS:
                raise KeyPressError("Wait must be 10–5000 ms")
            out.append({"wait": ms})
            total += ms
            continue
        keys = [str(k).lower() for k in step.get("keys", [])]
        hold = int(step.get("hold", 80))
        if not keys or len(keys) > 4:
            raise KeyPressError("A combo needs 1–4 keys")
        if not 10 <= hold <= MAX_HOLD_MS:
            raise KeyPressError("Hold must be 10–5000 ms")
        for key in keys:
            if key in MOUSE:
                if len(keys) != 1:
                    raise KeyPressError("Mouse clicks can't be combined with keys")
            elif key not in SCAN and key not in EXTENDED:
                raise KeyPressError(f'"{key}" is not an allowed key')
        if set(keys) in BLOCKED_COMBOS:
            raise KeyPressError("+".join(keys) + " is blocked for safety")
        out.append({"keys": keys, "hold": hold})
        total += hold
    if total > MAX_TOTAL_MS:
        raise KeyPressError("A key action can last at most 15 seconds")
    return out


class WindowsSender:
    """Sends input with user32.SendInput."""

    def __init__(self):
        if sys.platform != "win32":
            raise KeyPressError("Key presses work on Windows only")
        import ctypes
        from ctypes import wintypes

        ulong_ptr = ctypes.c_size_t

        class KEYBDINPUT(ctypes.Structure):
            _fields_ = [("wVk", wintypes.WORD), ("wScan", wintypes.WORD), ("dwFlags", wintypes.DWORD),
                        ("time", wintypes.DWORD), ("dwExtraInfo", ulong_ptr)]

        class MOUSEINPUT(ctypes.Structure):
            _fields_ = [("dx", wintypes.LONG), ("dy", wintypes.LONG), ("mouseData", wintypes.DWORD),
                        ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD), ("dwExtraInfo", ulong_ptr)]

        class HARDWAREINPUT(ctypes.Structure):
            _fields_ = [("uMsg", wintypes.DWORD), ("wParamL", wintypes.WORD), ("wParamH", wintypes.WORD)]

        class _UNION(ctypes.Union):
            _fields_ = [("ki", KEYBDINPUT), ("mi", MOUSEINPUT), ("hi", HARDWAREINPUT)]

        class INPUT(ctypes.Structure):
            _fields_ = [("type", wintypes.DWORD), ("u", _UNION)]

        self.ctypes, self.INPUT, self.KEYBDINPUT, self.MOUSEINPUT = ctypes, INPUT, KEYBDINPUT, MOUSEINPUT
        self.user32 = ctypes.WinDLL("user32", use_last_error=True)
        self.user32.SendInput.argtypes = (wintypes.UINT, ctypes.POINTER(INPUT), ctypes.c_int)
        self.user32.GetForegroundWindow.restype = wintypes.HWND
        self.user32.GetWindowTextW.argtypes = (wintypes.HWND, wintypes.LPWSTR, ctypes.c_int)

    def _send(self, item):
        if self.user32.SendInput(1, self.ctypes.byref(item), self.ctypes.sizeof(item)) != 1:
            raise KeyPressError("Windows blocked the key press (is the game running as administrator?)")

    def key(self, name, down):
        flags = 0x0008 | (0 if down else 0x0002)  # KEYEVENTF_SCANCODE | KEYEVENTF_KEYUP
        if name in EXTENDED:
            flags |= 0x0001
        scan = EXTENDED.get(name) or SCAN[name]
        item = self.INPUT(type=1)
        item.u.ki = self.KEYBDINPUT(0, scan, flags, 0, 0)
        self._send(item)

    def mouse(self, name, down):
        item = self.INPUT(type=0)
        item.u.mi = self.MOUSEINPUT(0, 0, 0, MOUSE[name][0 if down else 1], 0, 0)
        self._send(item)

    def foreground_title(self):
        hwnd = self.user32.GetForegroundWindow()
        buffer = self.ctypes.create_unicode_buffer(512)
        self.user32.GetWindowTextW(hwnd, buffer, 512)
        return buffer.value


def run_action(payload, window_filter, sender=None, sleep=time.sleep):
    """Presses the job's key steps in the game window. Returns a summary; raises KeyPressError."""
    window_filter = (window_filter or "").strip().lower()
    if not window_filter:
        raise KeyPressError("Set the game window title in the Assistant app (Games page → Key presses)")
    steps = validate(payload.get("steps"))
    sender = sender or WindowsSender()
    if not _lock.acquire(timeout=20):
        raise KeyPressError("Another key action is still running")
    held = []
    try:
        for step in steps:
            title = sender.foreground_title()
            if window_filter not in title.lower():
                raise KeyPressError(f'The game window is not focused (focused: "{title[:60]}")')
            if "wait" in step:
                sleep(step["wait"] / 1000)
                continue
            if step["keys"][0] in MOUSE:
                sender.mouse(step["keys"][0], True)
                held.append(("mouse", step["keys"][0]))
            else:
                for key in step["keys"]:
                    sender.key(key, True)
                    held.append(("key", key))
            sleep(step["hold"] / 1000)
            while held:
                kind, name = held.pop()
                (sender.mouse if kind == "mouse" else sender.key)(name, False)
    finally:
        for kind, name in reversed(held):  # never leave a key stuck down
            try:
                (sender.mouse if kind == "mouse" else sender.key)(name, False)
            except Exception:
                pass
        _lock.release()
    return f"Pressed {len([s for s in steps if 'keys' in s])} key step(s)"
