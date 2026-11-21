# KitsuFlowBOT Assistant: quick start

## 1. Pair the app with your channel

1. Download the newest Windows or Linux ZIP from [GitHub Releases](https://github.com/NekoSuneProjects/KitsuFlowBOT/releases) and extract it.
2. Open **KitsuFlowBOTAssistant.exe** (Windows) or **KitsuFlowBOTAssistant** (Linux; mark it executable first).
3. In KitsuFlowBOT Studio, open **Voice & Clips → Pair a PC** and copy the one-time `kfv_…` device key.
4. In the app, go to **Settings**, paste the key, click **Save settings**, then click **Connect**.

The Home page then shows your channel and the features Studio has turned on. Keep the app running while you stream: Beat Saber requests and Minecraft actions only run while it is connected.

## 2. Voice clips

1. Open **Voice Clips** and pick your microphone (tick *Show all audio devices* for virtual inputs).
2. Choose an engine. Whisper with model **auto** suits most PCs; Vosk is the offline alternative.
3. Click **Start listening**. The model downloads on first use, into `model/whisper/<name>` or `model/vask`.
4. Say your clip phrase (set in Studio → Voice & Clips) to create a clip.

## 3. Beat Saber song requests (`!bsr`)

1. In Studio → **Assistant App**, turn on song requests and set who can request, the per-user cooldown and the queue size.
2. In the app's **Beat Saber** page, tick *enabled* and click **Detect**, or **Browse** to the game folder (the one containing `Beat Saber_Data`).
3. Viewers type `!bsr 25f`. KitsuFlowBOT checks the map on BeatSaver and the app downloads it into `Beat Saber_Data/CustomLevels`. Chat then gets a confirmation.

Requests are refused while the app is offline, when the queue is full, or when the map is already queued.

## 4. Minecraft Interactive (RCON)

1. In your server's `server.properties`, set:
   ```properties
   enable-rcon=true
   rcon.port=25575
   rcon.password=choose-a-long-password
   ```
   Then restart the server. Keep the RCON port closed to the internet unless the server is on another machine you control.
2. In the app's **Minecraft** page, enter the host, port, password and your in-game name. Then click **Test RCON connection**.
3. In Studio → **Assistant App**, add actions. An action can be a chat command (for example `!creeper`, with a points cost and cooldown) or a stream event (follow, sub, gift sub, cheer, Kick kicks, tip or raid, with an optional minimum amount). Each action runs one or more commands, such as `execute at {player} run summon creeper ~ ~ ~`. Use **Test** to try one.

`{player}` is your in-game name and `{user}` is the viewer's name. Server-admin commands such as `op`, `stop` or `ban` are always refused. If an action fails, the viewer's points are refunded.

## Settings file

Settings live in `.env` beside the executable (see `.env.example`). It holds your device key and RCON password, so don't share it. You can revoke the device key in Studio at any time.
