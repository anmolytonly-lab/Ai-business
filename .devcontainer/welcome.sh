#!/usr/bin/env bash
# Shown each time you attach to the Codespace. Tells you exactly what is left
# to do, based on what is actually true right now — not a fixed script.
set -uo pipefail

echo ""
echo "─────────────────────────────────────────────"
echo "  AgentCorp — Shingar Beauty Salon"
echo "─────────────────────────────────────────────"

if [ -z "${GEMINI_API_KEY:-}" ] && ! grep -qs '^GEMINI_API_KEY=.\+' .env 2>/dev/null; then
  echo ""
  echo "  ⚠  No Gemini API key found — agents cannot run without one."
  echo ""
  echo "     Best: add it once as a Codespaces secret so every Codespace gets it"
  echo "       https://github.com/settings/codespaces  →  New secret"
  echo "       Name: GEMINI_API_KEY"
  echo "       Then rebuild the Codespace."
  echo ""
  echo "     Or just for now:"
  echo "       cp .env.example .env   &&   nano .env"
  echo ""
  exit 0
fi

DOCS=$(node -e "
try {
  const D=require('better-sqlite3');
  const db=new D('./data/agentcorp.db',{readonly:true,fileMustExist:true});
  console.log(db.prepare('SELECT COUNT(*) n FROM documents').get().n);
} catch { console.log(0); }
" 2>/dev/null || echo 0)

echo ""
echo "  ✓ Gemini API key found"

if [ "$DOCS" = "0" ]; then
  echo ""
  echo "  Next — load the salon's knowledge, then start:"
  echo ""
  echo "      npm run seed"
  echo "      npm start"
else
  echo "  ✓ Knowledge base loaded ($DOCS documents)"
  echo ""
  echo "  Start it:"
  echo ""
  echo "      npm start"
fi

echo ""
echo "  Then open port 3000 from the PORTS tab."
echo "─────────────────────────────────────────────"
echo ""
