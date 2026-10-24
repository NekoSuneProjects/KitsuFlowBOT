# KitsuFlow Voice Companion

Lightweight Windows/Linux microphone companion. Recognises speech locally using offline Vosk. Sends only the detected trigger phrase over HTTPS to KitsuFlowBOT; **no microphone audio is uploaded**. No OBS or Twitch/Kick/VPZone OAuth credentials on the PC.

## Setup

1. In KitsuFlowBOT Dashboard → Voice & Clips → Desktop Companion, select **Pair PC**, copy the one-time device key and save it privately.
2. Install Python 3.10+ and run `python -m pip install -r requirements.txt` (Linux may also need `portaudio19-dev` and microphone access).
3. Download a small offline speech model from https://alphacephei.com/vosk/models and extract it into this directory as `model/`.
4. Set `KITSUFLOW_DEVICE_KEY` in your PC environment; leave `KITSUFLOW_URL` as your dashboard or set it to your own HTTPS deployment.
5. Run `python companion.py`. To select a mic, run `python companion.py --list-mics` and `python companion.py --device 2`.

The default phrase is **clip it**. Change phrase, routing, cooldown and enabled platforms in the Dashboard; the PC refreshes configuration every minute. The device key is stored hashed on the server and can be revoked any time in the dashboard.

Native clipping: **Twitch only**, when the linked creator is live and authorised with `clips:edit`. **Kick and VPZone** return explicit `unsupported` results until they expose a verified native create-clip API. The app does not capture stream video, create local files, or pretend unsupported clips exist. Twitch's clip create API may return a clip ID before the playable clip is fully processed.

Security: never share device keys, expose the server on plain HTTP except for localhost development, or commit models/device keys to Git. Grant microphone access only to the local app. Avoid duplicate triggering by disabling the old server-side voice worker if not needed.
