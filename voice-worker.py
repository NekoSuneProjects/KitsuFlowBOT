#!/usr/bin/env python3
"""Opt-in, low concurrency Twitch audio phrase detector; no audio retained."""
import json, os, subprocess, threading, time, urllib.request, urllib.error, re, sys
from vosk import Model, KaldiRecognizer

BASE=os.environ.get("VOICE_API_URL","http://kitsuflowbot:3000").rstrip("/")
SECRET=os.environ.get("VOICE_WORKER_SECRET","")
MODEL=os.environ.get("VOSK_MODEL_PATH","/models/vosk")
CAP=max(1,min(3,int(os.environ.get("VOICE_MAX_CHANNELS","1"))))
if len(SECRET)<24 or not os.path.isdir(MODEL):
    sys.exit("VOICE_WORKER_SECRET (24+ chars) and VOSK_MODEL_PATH directory are required.")
model=Model(MODEL)
running={}
lock=threading.Lock()

def call(path,data=None):
    content=None if data is None else json.dumps(data).encode()
    req=urllib.request.Request(BASE+path,data=content,headers={"x-voice-worker-key":SECRET,"Content-Type":"application/json"},method="POST" if data is not None else "GET")
    with urllib.request.urlopen(req,timeout=90) as response:return json.load(response)

def monitor(channel,login,phrase,platform,url,stop):
    source=None;decoder=None
    try:
        if not re.fullmatch(r"[a-zA-Z0-9_-]{2,32}",login):return\n        if platform not in ("twitch","kick","vpzone"):return\n        if platform != "twitch" and url != ("https://kick.com/" if platform == "kick" else "https://vpzone.tv/")+login:return
        source=subprocess.Popen(["streamlink","--loglevel","error","--stdout",("https://www.twitch.tv/"+login if platform == "twitch" else url),"worst"],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
        decoder=subprocess.Popen(["ffmpeg","-nostdin","-hide_banner","-loglevel","error","-i","pipe:0","-vn","-ac","1","-ar","16000","-f","s16le","pipe:1"],stdin=source.stdout,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
        source.stdout.close()
        recognizer=KaldiRecognizer(model,16000)
        last=0
        while not stop.is_set():
            buf=decoder.stdout.read(4000)
            if not buf:break
            if recognizer.AcceptWaveform(buf):
                words=json.loads(recognizer.Result()).get("text","").strip().lower()
                if phrase in words and time.monotonic()-last>20:
                    last=time.monotonic()
                    try:
                        output=call("/internal/voice/detected" if platform=="twitch" else "/internal/voice/platform/detected",{"channel":channel,"platform":platform,"transcript":words})
                        print("Voice trigger",platform,channel,output.get("clip_id") or output.get("status"),flush=True)
                    except (urllib.error.HTTPError,Exception) as exc: print("Detection error",channel,str(exc)[:180],flush=True)
    finally:
        for process in [decoder,source]:
            if process:
                process.terminate()
                try:process.wait(timeout=4)
                except subprocess.TimeoutExpired:process.kill()
        with lock:running.pop((platform,channel),None)

while True:
    try:
        channels=call("/internal/voice/channels")["channels"]
        desired={(ch.get("platform","twitch"),ch["channel"]):ch for ch in channels}
        with lock:
            for channel,item in list(running.items()):
                if channel not in desired or desired[channel]["phrase"]!=item["phrase"]:item["stop"].set()
            for channel,item in desired.items():
                if channel in running or len(running)>=CAP:continue
                stop=threading.Event()
                thread=threading.Thread(target=monitor,args=(item["channel"],item["login"],item["phrase"],item.get("platform","twitch"),item.get("url",""),stop),daemon=True)
                running[channel]={"stop":stop,"phrase":item["phrase"],"thread":thread}
                thread.start()
    except Exception as exc:print("Voice scheduler error:",str(exc)[:200],flush=True)
    time.sleep(25)
