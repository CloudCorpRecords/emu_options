#!/bin/bash
# Move to the directory where this script resides
cd "$(dirname "$0")"

echo "================================================="
echo "  Aura Console - Starting Local ROM Server...   "
echo "================================================="
echo "Workspace: $(pwd)"
echo ""

# Resolve python3 path
PYTHON_BIN=""
if [ -x "/opt/homebrew/bin/python3" ]; then
    PYTHON_BIN="/opt/homebrew/bin/python3"
elif [ -x "/usr/bin/python3" ]; then
    PYTHON_BIN="/usr/bin/python3"
else
    PYTHON_BIN=$(which python3 2>/dev/null || true)
fi

if [ -z "$PYTHON_BIN" ]; then
    echo "ERROR: Python 3 was not found on your system."
    echo "Please install Python 3 or ensure it is in your PATH."
    read -p "Press enter to exit..."
    exit 1
fi

echo "Using Python: $PYTHON_BIN"
echo "Starting server on port 8080..."
echo "Opening http://localhost:8080 in your browser..."
echo ""
echo "Keep this window open to keep the server running."
echo "Press Ctrl+C here to stop the server."
echo "================================================="

# Open the browser
open "http://localhost:8080"

# Execute the server script
"$PYTHON_BIN" rom_downloader_server.py
