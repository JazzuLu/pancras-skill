import subprocess
import json
import os
import sys
import time
import base64
import urllib.request
import datetime
import re
import shutil

def run_cmd(args):
    res = subprocess.run(args, capture_output=True, text=True)
    if res.returncode != 0:
        print(f"Command failed: {' '.join(args)}\nError: {res.stderr}", file=sys.stderr)
        return None
    return res.stdout.strip()

def query_ollama(model_name, prompt):
    url = "http://localhost:11434/api/generate"
    payload = {
        "model": model_name,
        "prompt": prompt,
        "stream": False,
        "keep_alive": 0,
        "options": {
            "num_ctx": 4096
        }
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=300) as response:
            resp_body = response.read().decode("utf-8")
            resp_json = json.loads(resp_body)
            return resp_json.get("response", "").strip()
    except Exception as e:
        print(f"Error querying Ollama ({model_name}): {e}", file=sys.stderr)
        return ""

def get_english_slug(model_name, title):
    prompt = f"Please generate a 3-5 word concise English slug representing this Chinese video title: '{title}'. Output ONLY the lowercase hyphen-separated slug itself (e.g. 'most-used-11-skills'), with no punctuation, no quotes, and no explanatory text."
    slug = query_ollama(model_name, prompt)
    # Clean up just in case
    slug = slug.strip().lower().replace(" ", "-")
    slug = re.sub(r'[^a-z0-9\-]', '', slug)
    slug = re.sub(r'\-+', '-', slug)
    return slug if slug else "douyin-video"

def get_fresh_cdn_url(short_url):
    session_name = f"whisper_pipeline_session_{int(time.time())}"
    browser_id = "chrome_local_100758753856454873"
    
    print("Opening browser session to capture video requests...")
    open_args = [
        "browser-act",
        "--session", session_name,
        "browser", "open", browser_id, short_url
    ]
    if run_cmd(open_args) is None:
        return None, None, None
        
    print("Waiting 6 seconds for page to load and network requests to capture...")
    time.sleep(6)
    
    print("Exporting network requests...")
    export_args = [
        "browser-act",
        "--session", session_name,
        "--format", "json",
        "network", "requests"
    ]
    reqs_json = run_cmd(export_args)
    if not reqs_json:
        print("Failed to export network requests.", file=sys.stderr)
        run_cmd(["browser-act", "session", "close", session_name])
        return None, None, None
        
    try:
        data = json.loads(reqs_json)
        reqs = data.get("requests", [])
    except Exception as e:
        print(f"Failed to parse network requests JSON: {e}", file=sys.stderr)
        run_cmd(["browser-act", "session", "close", session_name])
        return None, None, None
        
    # Find aweme/v1/web/aweme/detail request
    target_req = None
    for r in reqs:
        req_url = r.get("url", "")
        rtype = r.get("resource_type", "")
        status = r.get("status", 0)
        if "aweme/v1/web/aweme/detail" in req_url and rtype in ["XHR", "Fetch"] and status == 200:
            target_req = r
            break
            
    if not target_req:
        print("Could not find aweme/detail API request in the logs.", file=sys.stderr)
        run_cmd(["browser-act", "session", "close", session_name])
        return None, None, None
        
    req_id = target_req.get("request_id")
    print(f"Found detail request ID: {req_id}. Fetching response body...")
    
    # Fetch response body
    body_args = [
        "browser-act",
        "--session", session_name,
        "--format", "json",
        "network", "request", req_id
    ]
    body_json = run_cmd(body_args)
    
    # Close session immediately to release resource
    print("Closing browser session...")
    run_cmd(["browser-act", "session", "close", session_name])
    
    if not body_json:
        print("Failed to fetch request body.", file=sys.stderr)
        return None, None, None
        
    try:
        detail_data = json.loads(body_json)
        body_str = detail_data.get("response_body", "")
        if not body_str:
            print("No response body found in the request detail.", file=sys.stderr)
            return None, None, None
            
        body = json.loads(body_str)
        aweme_detail = body.get("aweme_detail", {})
        video = aweme_detail.get("video", {})
        play_addr = video.get("play_addr", {})
        url_list = play_addr.get("url_list", [])
        
        if url_list:
            print(f"Successfully extracted fresh play URL: {url_list[0]}")
            return url_list[0], body, data
        else:
            print("No video URLs found in play_addr.", file=sys.stderr)
            return None, None, None
    except Exception as e:
        print(f"Error parsing detail body: {e}", file=sys.stderr)
        return None, None, None

def download_video(cdn_url, video_path):
    headers = {
        'Referer': 'https://www.douyin.com/',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
    req = urllib.request.Request(cdn_url, headers=headers)
    print("Downloading video stream...")
    try:
        with urllib.request.urlopen(req) as response:
            with open(video_path, 'wb') as out_file:
                out_file.write(response.read())
        print("Video downloaded successfully.")
        return True
    except Exception as e:
        print(f"Failed to download video: {e}", file=sys.stderr)
        return False

def extract_full_audio(video_path, audio_path):
    print("Extracting full audio to WAV (16kHz mono)...")
    ffmpeg_bin = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"
    cmd = [
        ffmpeg_bin,
        "-y",
        "-i", video_path,
        "-vn",
        "-acodec", "pcm_s16le",
        "-ar", "16000",
        "-ac", "1",
        audio_path
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    return res.returncode == 0

def run_whisper_stt(model_path, audio_path):
    print(f"Running whisper-cli with model {os.path.basename(model_path)}...")
    cmd = [
        "whisper-cli",
        "-m", model_path,
        "-l", "zh",
        "-f", audio_path,
        "-nt",
        "-np"
    ]
    start_time = time.time()
    res = subprocess.run(cmd, capture_output=True, text=True)
    duration = time.time() - start_time
    print(f"Transcription completed in {duration:.2f} seconds.")
    if res.returncode != 0:
        print(f"whisper-cli error: {res.stderr}", file=sys.stderr)
        return ""
    return res.stdout.strip()

def polish_transcript(model_name, raw_text):
    print(f"Polishing transcript with local LLM '{model_name}'...")
    prompt = f"""你是一个顶级的技术内容编辑和语音润色专家。下面是一段由 Whisper 语音转文字（STT）工具识别出的原始话语。由于是口语表述，其中包含大量的口头重复语、同音字/谐音字错误、拼写错误，且完全没有标点符号和段落划分。

请你遵循以下规则对这段话进行后处理（校对与修正）：
1. **修正识别错误的专业术语、工具名称与英文缩写**。例如（请根据上下文合理判断并替换）：
   - agent rich / Agent Rich / a卷的乐曲 -> Agent Reach
   - 那不费LM / 那不费 LM -> NotebookLM
   - BBBrowser / BBB Browser / bbbs -> browser-act (或者 browser-use)
   - Clone -> Chrome
   - From End Design / from nt3 -> Flux UI (或 FluxUI)
   - EUX Pro Max / EUX -> UX Architect (或 UX Pro Max)
   - Play Write MCP / Play light -> Playwright MCP
   - 规则大佬 / 归葬大楼 -> 归藏 (宝玉老师/归藏老师)
   - 16 / すぎては -> skills / Skills
2. **在不改变说话人任何原意、不删减说话人核心表达内容（保持完整逐字稿的口语化表达口吻）**的前提下，将这段话修正为通顺、无拼写错误、专业术语正确的中文文本。
3. **加上合理的标点符号和适当的段落分行**，以提升阅读体验。
4. **不要进行总结、概括或添加多余的解释，也不要输出思考链（如 <think> 标签）**。只输出最终校对后的正文文本。

原始文本：
{raw_text}

修正后的文本："""
    
    start_time = time.time()
    polished = query_ollama(model_name, prompt)
    duration = time.time() - start_time
    print(f"LLM polishing completed in {duration:.2f} seconds.")
    return polished

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 scripts/transcribe_and_polish.py <douyin_short_url>", file=sys.stderr)
        sys.exit(1)
        
    short_url = sys.argv[1]
    
    # Paths
    project_dir = os.getcwd()
    scratch_dir = os.path.join(project_dir, "scratch")
    
    # Locate model relative to this script's directory
    script_dir = os.path.dirname(os.path.abspath(__file__))
    model_path = os.path.abspath(os.path.join(script_dir, "..", "models", "ggml-medium.bin"))
    
    # Local LLM name to query via Ollama
    llm_model = "Qwen3.5-9B-Abliterated:latest"
    
    # Ensure project folders exist
    os.makedirs(scratch_dir, exist_ok=True)
    
    if not os.path.exists(model_path):
        print(f"Error: Whisper model file not found at {model_path}", file=sys.stderr)
        sys.exit(1)
        
    # 1. Fetch playback details and metadata
    cdn_url, detail_json, requests_json = get_fresh_cdn_url(short_url)
    if not cdn_url or not detail_json:
        print("Failed to capture video requests.", file=sys.stderr)
        sys.exit(1)
        
    # 2. Extract metadata details
    aweme_detail = detail_json.get("aweme_detail", {})
    create_time = aweme_detail.get("create_time", 0)
    desc = aweme_detail.get("desc", "")
    author_info = aweme_detail.get("author", {})
    nickname = author_info.get("nickname", "未知作者")
    
    # Formatting date
    if create_time:
        date_str = datetime.datetime.fromtimestamp(create_time).strftime("%Y%m%d")
    else:
        date_str = datetime.datetime.now().strftime("%Y%m%d")
        
    # Get clean title
    title = desc.split("#")[0].strip()
    if not title:
        title = "douyin-video"
        
    # 3. Generate clean English folder slug using LLM
    print("Generating English slug for folder structure...")
    slug = get_english_slug(llm_model, title)
    folder_name = f"{date_str}-{slug}"
    target_dir = os.path.join(project_dir, "crawlers", folder_name)
    assets_dir = os.path.join(target_dir, "assets")
    
    os.makedirs(target_dir, exist_ok=True)
    os.makedirs(assets_dir, exist_ok=True)
    
    print(f"Generated target folder: {target_dir}")
    
    # 4. Download and convert audio
    temp_video = os.path.join(scratch_dir, "temp_video.mp4")
    temp_audio = os.path.join(scratch_dir, "temp_audio.wav")
    
    if not download_video(cdn_url, temp_video):
        sys.exit(1)
        
    if not extract_full_audio(temp_video, temp_audio):
        print("Failed to extract audio.", file=sys.stderr)
        if os.path.exists(temp_video):
            os.remove(temp_video)
        sys.exit(1)
        
    # Clean up video file immediately
    if os.path.exists(temp_video):
        os.remove(temp_video)
        
    # 5. Transcribe with Whisper.cpp
    raw_transcript = run_whisper_stt(model_path, temp_audio)
    
    # Clean up audio file
    if os.path.exists(temp_audio):
        os.remove(temp_audio)
        
    if not raw_transcript:
        print("Speech-to-text returned empty output.", file=sys.stderr)
        sys.exit(1)
        
    # 6. Post-process (Polish) with local Qwen
    polished_transcript = polish_transcript(llm_model, raw_transcript)
    if not polished_transcript:
        print("Warning: LLM polishing failed. Saving raw verbatim text as output.", file=sys.stderr)
        polished_transcript = raw_transcript
        
    # 7. Write outputs to Page Bundle folder
    
    # Save raw transcript
    raw_path = os.path.join(assets_dir, "raw_verbatim.txt")
    with open(raw_path, "w", encoding="utf-8") as f:
        f.write(raw_transcript)
    print(f"Saved raw transcript to assets/raw_verbatim.txt")
    
    # Save metadata
    meta_path = os.path.join(assets_dir, "video_meta.json")
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(detail_json, f, indent=2, ensure_ascii=False)
    print(f"Saved metadata to assets/video_meta.json")
    
    # Save network requests
    reqs_path = os.path.join(assets_dir, "network_requests.json")
    with open(reqs_path, "w", encoding="utf-8") as f:
        json.dump(requests_json, f, indent=2, ensure_ascii=False)
    print(f"Saved network requests log to assets/network_requests.json")
    
    # Save final polished post index.md
    index_path = os.path.join(target_dir, "index.md")
    
    # Construct YAML frontmatter
    hugo_date = datetime.datetime.fromtimestamp(create_time).strftime("%Y-%m-%dT%H:%M:%S+08:00") if create_time else datetime.datetime.now().strftime("%Y-%m-%dT%H:%M:%S+08:00")
    
    index_content = f"""---
title: "{title}"
date: {hugo_date}
draft: false
tags: ["AI", "大模型", "语音转写", "知识整理"]
categories: ["自媒体"]
---

# {title}

**创作者**：{nickname}  
**发布日期**：{datetime.datetime.fromtimestamp(create_time).strftime("%Y-%m-%d") if create_time else "未知"}  
**视频链接**：{short_url}  

---

## 逐字原文 (本地 LLM 润色版)

{polished_transcript}
"""
    with open(index_path, "w", encoding="utf-8") as f:
        f.write(index_content)
    print(f"SUCCESS: Saved final polished markdown to {index_path}")
    print("\n--- Polished Output Snippet ---")
    print(polished_transcript[:400] + "...")
    print("------------------------------")

if __name__ == "__main__":
    main()
