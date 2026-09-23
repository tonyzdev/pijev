#!/bin/bash
# Pi vs PiJev on private-repository tasks. Usage: run.sh <model> <arms> <outdir-name> [parallel] [instance ids, comma-separated; default all]
SC=${PIJ_SCRATCH:-/private/tmp/claude-501/-Users-tonglin-Documents-PiJ/b9b0a3fa-096c-42ee-957d-c89d2ec7782c/scratchpad}
HERE=$(cd "$(dirname "$0")" && pwd)
MODEL=${1:-deepseek-v4-pro}; ARMS=${2:-pi,pij-jev}; OUT=${3:-agent-private-repo-pro}; PAR=${4:-2}
IDS=${5:-$(python3 -c "import json;print(','.join(i['instance_id'] for i in json.load(open('$HERE/instances.json'))))")}
cd "$HERE/../.." && set -a && . ./.env && set +a
exec npx tsx eval/swebench-agent.ts --dataset "$HERE/instances.json" --instances "$IDS" --repos "${PRIVATE_REPO_PARENT:-$(python3 -c "import json;print(json.load(open('$HERE/.local.json'))['PRIVATE_REPO_PARENT'])")}" \
  --out "$SC/$OUT" --arms "$ARMS" --model "$MODEL" --parallel "$PAR"
