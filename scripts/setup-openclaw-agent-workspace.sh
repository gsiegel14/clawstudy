#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/Applications/clawstudy"
TEMPLATE_DIR="$ROOT_DIR/templates/openclaw-workspace"
TARGET_DIR="${TARGET_DIR:-$ROOT_DIR/moltworker/workspace}"
FORCE="false"

usage() {
  cat <<USAGE
Usage:
  bash /Applications/clawstudy/scripts/setup-openclaw-agent-workspace.sh [--target-dir <path>] [--force]

Options:
  --target-dir <path>  Target OpenClaw workspace directory to seed.
  --force              Overwrite existing files.
  -h, --help           Show this help text.
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --target-dir)
      if [ "$#" -lt 2 ]; then
        echo "Missing value for --target-dir"
        exit 1
      fi
      TARGET_DIR="$2"
      shift 2
      ;;
    --force)
      FORCE="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1"
      usage
      exit 1
      ;;
  esac
done

if [ ! -d "$TEMPLATE_DIR" ]; then
  echo "Template directory not found: $TEMPLATE_DIR"
  exit 1
fi

mkdir -p "$TARGET_DIR" "$TARGET_DIR/memory"

FILES=(
  "AGENTS.md"
  "SOUL.md"
  "TOOLS.md"
  "USER.md"
  "IDENTITY.md"
  "HEARTBEAT.md"
)

written=0
skipped=0

for name in "${FILES[@]}"; do
  src="$TEMPLATE_DIR/$name"
  dst="$TARGET_DIR/$name"

  if [ ! -f "$src" ]; then
    echo "Missing template file: $src"
    exit 1
  fi

  if [ -f "$dst" ] && [ "$FORCE" != "true" ]; then
    echo "[skip] $dst (already exists)"
    skipped=$((skipped + 1))
    continue
  fi

  install -m 0644 "$src" "$dst"
  echo "[write] $dst"
  written=$((written + 1))
done

# Copy skills/ directory tree
if [ -d "$TEMPLATE_DIR/skills" ]; then
  for skill_dir in "$TEMPLATE_DIR/skills"/*/; do
    [ -d "$skill_dir" ] || continue
    skill_name=$(basename "$skill_dir")
    src_skill="$skill_dir/SKILL.md"
    dst_skill_dir="$TARGET_DIR/skills/$skill_name"
    dst_skill="$dst_skill_dir/SKILL.md"

    mkdir -p "$dst_skill_dir"

    if [ ! -f "$src_skill" ]; then
      continue
    fi

    if [ -f "$dst_skill" ] && [ "$FORCE" != "true" ]; then
      echo "[skip] $dst_skill (already exists)"
      skipped=$((skipped + 1))
      continue
    fi

    install -m 0644 "$src_skill" "$dst_skill"
    echo "[write] $dst_skill"
    written=$((written + 1))
  done
fi

echo ""
echo "Workspace template sync complete"
echo "Target: $TARGET_DIR"
echo "Written: $written"
echo "Skipped: $skipped"
