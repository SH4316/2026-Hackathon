"""Immutable official Decider-4B v3 artifacts; no weights are stored in the image."""

import hashlib
from pathlib import Path

MODEL_ID = "Mapika/decider-4b"
MODEL_REPO = "Mapika/decider-4b-GGUF"
MODEL_REVISION = "d3a78581751d518bbfa9e871a6d84059554d53c5"
GGUF_FILE = "decider-4b-v3-Q4_K_M.gguf"
MODEL_DIR = Path("/models") / MODEL_REVISION
# Sizes and SHA-256 from the pinned Hub tree/LFS metadata, and the small source files.
FILES = {
    GGUF_FILE: (2708804000, "fc6e32a39ca74a4201f7a7b2393bde16b83b7c26957465f257ca75c5c3fc3b3a"),
    "tokenizer.json": (19989325, "06b9509352d2af50381ab2247e083b80d32d5c0aba91c272ca9ff729b6a0e523"),
    "tokenizer_config.json": (1127, "171ecbe7ddae98d11840698f7df2b8d5b4722139db0f0620d3bbf429bd656250"),
    "decider_config.json": (2007, "574004c766731c3c6170768c2510f0416c0fd1794a03fbf74f05b8084ae30401"),
    "chat_template.jinja": (7756, "a4aee8afcf2e0711942cf848899be66016f8d14a889ff9ede07bca099c28f715"),
}


def matches(path: Path, size: int, digest: str) -> bool:
    if not path.is_file() or path.stat().st_size != size:
        return False
    checksum = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(8 * 1024 * 1024), b""):
            checksum.update(chunk)
    return checksum.hexdigest() == digest


def verify(directory: Path = MODEL_DIR) -> None:
    for name, (size, digest) in FILES.items():
        if not matches(directory / name, size, digest):
            raise RuntimeError(f"Missing or invalid {name}; run the decider-pull service with a valid cache.")
