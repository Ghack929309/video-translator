import sys
import requests

SERVER_URL = "http://localhost:50000"

def test_synthesize(wav_path):
    print("Testing /health ...")
    try:
        r = requests.get(f"{SERVER_URL}/health")
        print(r.json())
    except Exception as e:
        print(f"Failed to reach server: {e}")
        return

    print("Testing /synthesize (cross_lingual) ...")
    try:
        with open(wav_path, "rb") as f:
            files = {"reference_audio": ("ref.wav", f, "audio/wav")}
            data = {
                "text": "Hello, this is a test from the new FastAPI server.",
                "mode": "cross_lingual",
                "speed": "1.0"
            }
            res = requests.post(f"{SERVER_URL}/synthesize", files=files, data=data)

        if res.status_code == 200:
            with open("output.wav", "wb") as out:
                out.write(res.content)
            print("Success! Saved output.wav (play with: ffplay output.wav)")
        else:
            print(f"Error {res.status_code}: {res.text}")
    except Exception as e:
        print(f"Request failed: {e}")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        test_synthesize(sys.argv[1])
    else:
        print("Usage: python test_server.py <reference.wav>")
