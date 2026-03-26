"""
Local test for CosyVoice 3 RunPod handler.

Usage:
  1. Start handler locally:
     MODEL_SOURCE=huggingface python handler.py --rp_serve_api --rp_api_port 8000

  2. Run this test:
     python test_handler.py <path_to_reference.wav>
"""

import base64
import json
import sys

import requests

SERVER_URL = "http://localhost:8000"


def test_cross_lingual(wav_path: str):
    """Test cross-lingual synthesis."""
    with open(wav_path, "rb") as f:
        wav_b64 = base64.b64encode(f.read()).decode("ascii")

    payload = {
        "input": {
            "tts_text": "Hello, this is a test of the CosyVoice speech synthesis system.",
            "mode": "cross_lingual",
            "prompt_wav": wav_b64,
            "speed": 1.0,
        }
    }

    print("Sending cross_lingual request...")
    resp = requests.post(f"{SERVER_URL}/runsync", json=payload, timeout=120)
    result = resp.json()

    if "error" in result.get("output", {}):
        print(f"ERROR: {result['output']['error']}")
        if "traceback" in result["output"]:
            print(result["output"]["traceback"])
        return False

    output = result["output"]
    pcm_bytes = base64.b64decode(output["audio"])
    duration = output["duration_sec"]
    sample_rate = output["sample_rate"]

    print(f"✓ cross_lingual: {duration}s audio ({len(pcm_bytes)} bytes, {sample_rate}Hz)")

    with open("test_output_cross_lingual.pcm", "wb") as f:
        f.write(pcm_bytes)
    print(f"  Saved: test_output_cross_lingual.pcm")
    print(f"  Play:  ffplay -f s16le -ar {sample_rate} -ac 1 test_output_cross_lingual.pcm")
    return True


def test_zero_shot(wav_path: str):
    """Test zero-shot synthesis."""
    with open(wav_path, "rb") as f:
        wav_b64 = base64.b64encode(f.read()).decode("ascii")

    payload = {
        "input": {
            "tts_text": "This is a zero-shot test using the same voice.",
            "mode": "zero_shot",
            "prompt_wav": wav_b64,
            "prompt_text": "Hello, this is a reference transcript for voice cloning.",
            "speed": 1.0,
        }
    }

    print("Sending zero_shot request...")
    resp = requests.post(f"{SERVER_URL}/runsync", json=payload, timeout=120)
    result = resp.json()

    if "error" in result.get("output", {}):
        print(f"ERROR: {result['output']['error']}")
        if "traceback" in result["output"]:
            print(result["output"]["traceback"])
        return False

    output = result["output"]
    pcm_bytes = base64.b64decode(output["audio"])
    duration = output["duration_sec"]
    sample_rate = output["sample_rate"]

    print(f"✓ zero_shot: {duration}s audio ({len(pcm_bytes)} bytes, {sample_rate}Hz)")

    with open("test_output_zero_shot.pcm", "wb") as f:
        f.write(pcm_bytes)
    print(f"  Saved: test_output_zero_shot.pcm")
    print(f"  Play:  ffplay -f s16le -ar {sample_rate} -ac 1 test_output_zero_shot.pcm")
    return True


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python test_handler.py <reference_audio.wav>")
        print("  Provide a 3-10s WAV file of the speaker's voice.")
        sys.exit(1)

    wav_path = sys.argv[1]
    print(f"Using reference audio: {wav_path}\n")

    passed = 0
    total = 2

    if test_cross_lingual(wav_path):
        passed += 1
    print()
    if test_zero_shot(wav_path):
        passed += 1

    print(f"\n{'=' * 40}")
    print(f"Results: {passed}/{total} tests passed")
