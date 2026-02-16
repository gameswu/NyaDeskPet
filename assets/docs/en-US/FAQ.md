# FAQ

---

## Installation & Launch

### Q: Security warning on first launch?

**Windows:** Windows Defender SmartScreen may block the app. Click "More info" → "Run anyway".

**macOS:** The system may say "Cannot verify developer". Go to **System Settings → Privacy & Security**, find NyaDeskPet and click "Open Anyway".

### Q: Can't see the character after launch?

- Check if the window is hidden behind other apps — use the system tray menu and select "Show"
- The window may be off-screen. Try: Tray menu → Show, or restart the app

---

## Model Related

### Q: Live2D model won't load?

1. **Check the path**: Confirm the `.model3.json` file path is correct
2. **Check file integrity**: The model directory must contain `.moc3`, textures, and other files
3. **Format compatibility**: NyaDeskPet supports **Cubism 4** format; Cubism 2/3 is not supported
4. **Check logs**: Enable logging in settings to view detailed error messages

### Q: Model displays abnormally (black blocks, distortion)?

- Texture files may be corrupted — re-download or re-extract the model
- Some models may use unsupported extension features

---

## AI Conversation

### Q: Character doesn't respond to messages?

1. **Check LLM provider**: Confirm at least one LLM provider has been added and set as primary
2. **Check API Key**: Confirm the API Key is valid and has sufficient balance
3. **Check connection status**: Confirm the backend Agent is started and connected
4. **Check network**: LLM APIs require internet access

### Q: AI responses are slow?

- Different models and providers have different response speeds
- Check network connection quality
- Try switching providers or using a faster model

### Q: How to clear conversation history?

- Click the **Chat button** to open the sidebar
- Create a new conversation, or delete old ones
- Conversation history is stored in a local SQLite database

---

## Speech Recognition

### Q: Microphone button is grayed out?

1. **Check FFmpeg**: Run `ffmpeg -version` in the terminal to confirm it's installed
2. **Check model files**: Confirm `models/asr/sense-voice-small/` contains `model.onnx` and `tokens.txt`
3. **Check system permissions**: Confirm the app has microphone access permission

### Q: Speech recognition is inaccurate?

- Use in a quiet environment
- Lower the volume threshold
- Speak closer to the microphone
- Speak at a moderate pace with clear pronunciation

### Q: How to use voice in a noisy environment?

Increase the **Settings → Connection → Volume Threshold** to filter ambient noise. The default is 30; in noisy environments, try 50-70.

---

## Plugins

### Q: Plugin fails to start?

1. **Check dependencies**: Confirm runtime environments like Python are installed
2. **Check terminal output**: Error messages from the plugin process
3. **Check ports**: Whether ports used by the plugin are occupied
4. **Permission issues**: On macOS/Linux, confirm launch scripts have execute permission

### Q: Tool call confirmation prompts are too frequent?

- `low` and `medium` level permissions can check "Remember this choice"
- `high` and `critical` level operations require confirmation every time for security reasons

### Q: How to uninstall third-party plugins?

1. Stop the plugin in the plugin panel
2. Delete the corresponding plugin directory in `plugins/` or `agent-plugins/`
3. Restart the app

---

## Display & Interface

### Q: How to switch between dark/light themes?

In **Settings → Display → Theme**, choose: Light, Dark, or Follow System.

### Q: How to switch languages?

In **Settings → Display → Language**, choose: 简体中文 or English.

### Q: How to keep the pet always on top?

Via system tray menu → check "Always on Top".

### Q: How to hide UI and keep only the character?

Three ways:
1. **Double-click** the Live2D character
2. Click the **👁️ button** in the bottom bar
3. System tray menu → UI Toggle

---

## Updates

### Q: Will settings be lost after updating?

No. Settings, conversation history, and plugin configurations are stored in the user data directory — updating the app won't affect this data.

### Q: Can't connect to the update server?

- Check network connection
- If GitHub is inaccessible, change the update source URL in **Settings → About**
- You can also manually download and install the new version

---

## Performance

### Q: App uses too much memory?

- Live2D models and textures consume a certain amount of memory
- Long conversations with accumulated history also increase memory usage
- Creating a new conversation can free up some memory
- The ASR model (~200MB) is only loaded when speech recognition is in use

### Q: Notes after enabling auto-start?

After enabling "Auto Start" in **Settings → Display**, the app will run automatically on system startup. If auto-connect is also configured, the Agent server will start automatically as well.

---

## Other

### Q: Where is data stored?

| Data | Location |
|------|----------|
| App settings | Browser localStorage |
| Conversation history | SQLite database in user data directory |
| Plugin config | User data directory |
| Plugin permissions | `plugin-permissions.json` in user data directory |
| Log files | `logs/` in user data directory |

### Q: How to report bugs or suggestions?

Go to the GitHub Issues page to submit. When submitting, please include:
1. Operating system and version
2. NyaDeskPet version number
3. Steps to reproduce the issue
4. Related logs (if available)

### Q: How to support the project?

- ⭐ Star the project on GitHub
- 🐛 Submit bug reports and feature suggestions
- 🔌 Develop and share plugins
- 📖 Help improve documentation
