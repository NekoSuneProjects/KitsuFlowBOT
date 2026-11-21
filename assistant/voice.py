"""Voice clips: listen to the microphone locally (Whisper or Vosk) and ask KitsuFlowBOT to clip
when the configured phrase is heard. Audio never leaves the PC; only the trigger is sent.
(Moved unchanged from the original voice companion, using the shared API client.)"""
import json
import queue
import re
import time

from api import ApiError
from settings import ROOT, truthy
from whisper_models import backend, cache_dir, model_complete, recommended_model


def phrase_heard(text, phrase):
    """Token match, so "oh my god, clip it." matches "clip it" but "clipboard" does not."""
    spoken = re.findall(r"\b\w+\b", text.casefold())
    trigger = re.findall(r"\b\w+\b", str(phrase).casefold())
    return bool(trigger) and any(spoken[i:i + len(trigger)] == trigger for i in range(len(spoken) - len(trigger) + 1))


def listen(api, values, model_path, gpu, stop, send):
    """Runs until `stop` is set. `send(kind, value)` reports log/status/config/trigger_sound to the UI."""
    try:
        import sounddevice as sd
        engine = values["KITSUFLOW_STT_ENGINE"]
        if engine == "vosk":
            from vosk import KaldiRecognizer, Model, SetLogLevel
            SetLogLevel(-1)
        else:
            import numpy as np
            from faster_whisper import WhisperModel
        if stop.is_set():
            return
        config = api.voice_config()
        send("config", config)
        send("status", "Loading offline speech model…")
        device = precision = model_folder = None
        if engine == "vosk":
            recognizer = KaldiRecognizer(Model(str(model_path)), 16000)
        else:
            selected_model = values["KITSUFLOW_WHISPER_MODEL"]
            if selected_model == "auto":
                selected_model = recommended_model(gpu)
            model_folder = cache_dir(ROOT, selected_model)
            if not model_complete(model_folder):
                raise RuntimeError("Whisper model is incomplete. Press Download selected model to repair it.")
            preference = values.get("KITSUFLOW_WHISPER_BACKEND", "auto")
            device, precision = backend(gpu, preference)
            try:
                model = WhisperModel(str(model_folder), device=device, compute_type=precision)
            except (RuntimeError, ValueError, OSError) as gpu_error:
                if device != "cuda" or preference == "cuda":
                    raise
                send("log", "GPU backend unavailable: " + str(gpu_error)[:160] + ". Falling back to CPU.")
                device, precision = "cpu", "int8"
                model = WhisperModel(str(model_folder), device=device, compute_type=precision)
            send("log", "Whisper " + selected_model + " loaded on " + device + " (" + precision + ")")
            segment_buffer = bytearray()
        if stop.is_set():
            return
        audio = queue.Queue(maxsize=64)

        def capture(indata, frames, timing, status):
            if status:
                send("log", "Mic status: " + str(status))
            try:
                audio.put_nowait(bytes(indata))
            except queue.Full:
                pass

        selected = values["KITSUFLOW_MIC_DEVICE"]
        with sd.RawInputStream(samplerate=16000, blocksize=4000, dtype="int16", channels=1,
                               device=int(selected) if selected else None, callback=capture):
            send("status", "Listening for voice clips")
            send("log", "Listening for: " + config.get("phrase", "clip it"))
            last, last_refresh = 0.0, time.monotonic()
            while not stop.is_set():
                now = time.monotonic()
                if now - last_refresh > 60:
                    try:
                        config = api.voice_config()
                        send("config", config)
                        last_refresh = now
                    except ApiError as exc:
                        send("log", "Settings refresh failed: " + str(exc))
                try:
                    data = audio.get(timeout=0.4)
                except queue.Empty:
                    continue
                if engine == "vosk":
                    if not recognizer.AcceptWaveform(data):
                        continue
                    text = " ".join(json.loads(recognizer.Result()).get("text", "").lower().split())
                else:
                    segment_buffer.extend(data)
                    # 4-second chunks keep memory bounded while still catching a spoken trigger.
                    if len(segment_buffer) < 16000 * 2 * 4:
                        continue
                    samples = np.frombuffer(bytes(segment_buffer), dtype=np.int16).astype(np.float32) / 32768.0
                    segment_buffer.clear()
                    try:
                        chunks, _ = model.transcribe(samples, language="en", beam_size=1, vad_filter=True,
                                                     condition_on_previous_text=False)
                        text = " ".join(" ".join(piece.text.lower().split()) for piece in chunks).strip()
                    except (RuntimeError, OSError) as gpu_error:
                        if device != "cuda":
                            raise
                        send("log", "CUDA inference failed (" + str(gpu_error)[:120] + "). Switching Whisper to CPU/int8.")
                        del model
                        device, precision = "cpu", "int8"
                        model = WhisperModel(str(model_folder), device=device, compute_type=precision)
                        chunks, _ = model.transcribe(samples, language="en", beam_size=1, vad_filter=True,
                                                     condition_on_previous_text=False)
                        text = " ".join(" ".join(piece.text.lower().split()) for piece in chunks).strip()
                        send("log", "Whisper recovered on CPU (int8).")
                    if text:
                        send("log", "Whisper heard: " + text[:120])
                phrase = config.get("phrase", "clip it")
                if not phrase_heard(text, phrase) or now - last < config.get("cooldown", 45):
                    continue
                last = now
                send("log", "Voice trigger recognised: " + phrase)
                if truthy(values.get("KITSUFLOW_TRIGGER_SOUND", "true")):
                    send("trigger_sound", None)
                try:
                    output = api.voice_trigger(phrase)
                    for item in output.get("results", []):
                        send("log", item["platform"] + ": " + item["status"] + " — " +
                             str(item.get("clip_id") or item.get("detail", "")))
                except ApiError as exc:
                    send("log", "Clip request failed: " + str(exc))
    except Exception as exc:
        send("log", "Voice listening stopped: " + str(exc))
    finally:
        send("voice_stopped", None)
