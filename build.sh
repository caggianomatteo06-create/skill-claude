#!/usr/bin/env bash
# Impacchetta una cartella skill nel file .skill installabile.
#   ./build.sh sbobina-lezioni
# Senza argomenti impacchetta tutte le cartelle che contengono un SKILL.md.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

impacchetta() {
  local nome="${1%/}"
  [[ -f "$nome/SKILL.md" ]] || { echo "salto $nome: manca SKILL.md"; return; }
  rm -f "$nome.skill"
  zip -r -q "$nome.skill" "$nome" \
    -x "$nome/.venv/*" "*/__pycache__/*" "*.pyc" "*/.DS_Store"
  echo "creato $nome.skill ($(du -h "$nome.skill" | cut -f1))"
}

if (( $# )); then
  for nome in "$@"; do impacchetta "$nome"; done
else
  for skill in */SKILL.md; do impacchetta "$(dirname "$skill")"; done
fi
