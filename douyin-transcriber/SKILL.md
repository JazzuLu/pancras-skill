---
name: douyin-transcriber
description: Transcribe and polish Douyin video audio using local Whisper.cpp and local Ollama Qwen 9B.
---

# Skill: Douyin Transcriber & Polishing Pipeline

This skill automates the download, transcription, and editing of Douyin (抖音) short videos. It uses local Whisper.cpp for Speech-to-Text and queries a local Ollama model to format, correct, and add paragraph structure to the raw transcription.

## Requirements

1. **`browser-act`**: A CLI tool that controls the browser to extract video stream URLs. Make sure you have a valid session profile.
2. **`whisper-cli`**: The Whisper.cpp command-line utility. Must be accessible in your `$PATH`.
3. **Whisper Model**: Located in the skill's model folder (`models/ggml-medium.bin`).
4. **`ffmpeg`**: Required to extract audio tracks from downloaded video streams (automatically searched in system `$PATH` or falls back to `/opt/homebrew/bin/ffmpeg`).
5. **Ollama**: Running locally at `http://localhost:11434` with `Qwen3.5-9B-Abliterated:latest` pulled and ready. (Other Qwen models such as `qwen2.5:7b` or `qwen2.5:14b` can also be used by changing the `llm_model` variable in `scripts/transcribe_and_polish.py`).

## How it Works

The pipeline executes the following stages:
1. **Request Capturing**: Opens a temporary browser tab using `browser-act` to load the Douyin short link, intercepts the `aweme/v1/web/aweme/detail` request, and parses the response body to find the direct video CDN stream URL.
2. **Stream Download**: Downloads the raw video stream to a temporary file (`scratch/temp_video.mp4`).
3. **Audio Extraction**: Extracts a 16kHz mono WAV audio file (`scratch/temp_audio.wav`) from the video stream using `ffmpeg`.
4. **Local Transcription**: Calls `whisper-cli` with the `ggml-medium.bin` model to perform high-quality local Speech-to-Text.
5. **LLM Polishing**: Feeds the raw transcript to the local Ollama model (`Qwen3.5-9B-Abliterated:latest` or custom model) with specialized editor guidelines (correcting homophones, removing stutters, formatting paragraphs).
6. **Page Bundle Output**: Writes the polished text as a markdown document (`index.md`) alongside metadata files into a timestamped directory inside `crawlers/` in the active workspace.

## Usage

Run the Python script directly from your active project workspace directory:

```bash
python3 /Users/pancraslu/WorkingPlace/Coding/AI/pancras-skill/douyin-transcriber/scripts/transcribe_and_polish.py <douyin_short_url>
```

This will output the results inside the current workspace's `./crawlers/` directory (e.g. `crawlers/20260610-[slug]/index.md`).
