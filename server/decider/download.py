"""Download pinned public weights without ever receiving inspection input."""

import os
from pathlib import Path
import urllib.request

from model_files import FILES, MODEL_DIR, MODEL_REPO, MODEL_REVISION, matches


def prepare(directory: Path = MODEL_DIR, offline: bool = False) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    for name, (size, digest) in FILES.items():
        target = directory / name
        if matches(target, size, digest):
            print(f"decider: cached {name}", flush=True)
            continue
        if offline:
            raise RuntimeError(f"DECIDER_OFFLINE=true: missing or invalid {target}; import the pinned model cache first.")
        temporary = target.with_name(name + ".partial")
        url = f"https://huggingface.co/{MODEL_REPO}/resolve/{MODEL_REVISION}/{name}"
        print(f"decider: downloading {name} ({size} bytes)", flush=True)
        try:
            with urllib.request.urlopen(url, timeout=120) as response, temporary.open("wb") as output:
                for chunk in iter(lambda: response.read(8 * 1024 * 1024), b""):
                    output.write(chunk)
            if not matches(temporary, size, digest):
                raise RuntimeError(f"Checksum mismatch for {name}; the model cache was not updated.")
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)
    print("decider: pinned Decider-4B model cache is ready", flush=True)


if __name__ == "__main__":
    prepare(offline=os.environ.get("DECIDER_OFFLINE", "false").lower() == "true")
