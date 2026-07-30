#!/bin/sh
set -eu

VENV_DIR="$HOME/.readplace-ci/vlm-venv"
MODEL="${1:-mlx-community/Qwen3-VL-30B-A3B-Instruct-4bit}"

python3 -m venv "$VENV_DIR"
"$VENV_DIR/bin/pip" install --quiet --upgrade mlx-vlm
"$VENV_DIR/bin/hf" download "$MODEL"
mkdir -p "$HOME/ci-frames"
