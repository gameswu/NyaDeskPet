# ASR Configuration

ASR (Automatic Speech Recognition) lets you talk to your desktop pet by voice. NyaDeskPet uses a local offline recognition engine — no internet connection needed.

## Table of Contents
- [ASR Configuration](#asr-configuration)
  - [Table of Contents](#table-of-contents)
  - [Prerequisites](#prerequisites)
    - [1. Install FFmpeg](#1-install-ffmpeg)
    - [2. Download the ASR Model](#2-download-the-asr-model)
  - [Enable Speech Recognition](#enable-speech-recognition)
  - [Using Voice Input](#using-voice-input)
  - [Microphone Settings](#microphone-settings)
    - [Background Mode](#background-mode)
    - [Volume Threshold](#volume-threshold)
  - [Supported Languages](#supported-languages)
  - [Troubleshooting](#troubleshooting)
  - [Next Steps](#next-steps)

---

## Prerequisites

Two things are needed to use speech recognition:

### 1. Install FFmpeg

FFmpeg is the fundamental tool for audio processing.

**Windows:**
1. Download the Windows build from the [FFmpeg website](https://ffmpeg.org/download.html)
2. Extract to any directory (e.g., `C:\ffmpeg`)
3. Add the `bin` subdirectory to the system PATH environment variable

**macOS:**
```bash
brew install ffmpeg
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt install ffmpeg
```

Verify installation:
```bash
ffmpeg -version
```

### 2. Download the ASR Model

NyaDeskPet uses **Sherpa-ONNX Sense-Voice-Small** by default, supporting Chinese, English, Japanese, Korean, and Cantonese.

Model files should be placed in:

```
models/asr/sense-voice-small/
├── model.onnx         ← Model file (~200MB)
└── tokens.txt         ← Vocabulary file
```

> [!TIP]
> Download the corresponding model from the [Sherpa-ONNX model repository](https://github.com/k2-fsa/sherpa-onnx).

---

## Enable Speech Recognition

1. Make sure FFmpeg is installed and model files are in place
2. Open the **Settings → Connection** tab
3. Select the ASR model in the **Microphone Settings** area
4. Save settings

If the model loads successfully, the **Microphone button** in the chat bottom bar will become active. If the model is unavailable, the button will appear grayed out.

---

## Using Voice Input

1. Click the **Microphone button** to start recording
2. Speak into the microphone
3. After **1.5 seconds of silence**, recognition stops automatically
4. The recognized text will be filled into the input box (or sent directly, depending on settings)

---

## Microphone Settings

<div align="center">
    <img src="../images/asr-mic-settings.png" alt="Microphone Settings" width="300"/>
</div>

In the **Settings → Connection** tab, you can adjust the following options:

| Option | Description | Default |
|--------|------------|---------|
| ASR Model | Select the speech recognition model | sense-voice-small |
| Background Mode | Continuously listen to microphone input | Off |
| Volume Threshold | Sounds below this threshold are ignored | 30 |
| Auto Send | Automatically send message after recognition | On |

### Background Mode

When enabled, the microphone continuously listens. It automatically starts recognition when sound above the threshold is detected, and stops after silence. Ideal for hands-free usage.

### Volume Threshold

Adjust this value to filter out ambient noise. In noisy environments, increase the threshold; in quiet environments, decrease it.

---

## Supported Languages

| Language | Support |
|----------|---------|
| Chinese (Mandarin) | ✅ |
| English | ✅ |
| Japanese | ✅ |
| Korean | ✅ |
| Cantonese | ✅ |

The model automatically detects the language — no manual switching required.

---

## Troubleshooting

**Q: Microphone button is grayed out**
- Check if FFmpeg is installed: run `ffmpeg -version` in the terminal
- Check if model files are in the correct location: `models/asr/sense-voice-small/`
- Check if microphone permission has been granted to the app

**Q: Recognition is inaccurate**
- Ensure a quiet environment
- Lower the volume threshold
- Keep an appropriate distance from the microphone

**Q: No audio input**
- Check system microphone settings and confirm the default input device
- macOS users need to grant microphone permission to NyaDeskPet in System Settings

---

## Next Steps

Once configured, you can use voice input in [Conversations](Conversation.md).
