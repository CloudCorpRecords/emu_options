#!/bin/bash
# Move to the directory where this script resides
cd "$(dirname "$0")"

clear
echo "======================================================="
echo "   Aura Console Developer Launcher & Installer  "
echo "======================================================="
echo "Workspace: $(pwd)"
echo ""

# 1. Check and Install Node.js dependencies
if [ ! -d "node_modules" ]; then
    echo "[1/4] node_modules not found. Installing Node.js dependencies..."
    npm install
    if [ $? -ne 0 ]; then
        echo "ERROR: Failed to install npm packages."
        read -p "Press enter to exit..."
        exit 1
    fi
else
    echo "[1/4] Node.js dependencies are installed."
fi

# 2. Check and Setup Python Virtual Environment
if [ ! -d "venv" ]; then
    echo "[2/4] Python virtual environment (venv) not found. Creating..."
    python3 -m venv venv
    if [ $? -ne 0 ]; then
        echo "ERROR: Failed to create virtual environment."
        read -p "Press enter to exit..."
        exit 1
    fi
else
    echo "[2/4] Python virtual environment is ready."
fi

# 3. Check and Install PyInstaller
source venv/bin/activate
if ! command -v pyinstaller &> /dev/null; then
    echo "[3/4] PyInstaller not found in venv. Installing..."
    pip install pyinstaller
    if [ $? -ne 0 ]; then
        echo "ERROR: Failed to install PyInstaller."
        read -p "Press enter to exit..."
        exit 1
    fi
else
    echo "[3/4] PyInstaller is ready."
fi

# 4. Check if Python compilation is needed
COMPILE_NEEDED=false
if [ ! -f "bin/rom_downloader_server" ]; then
    COMPILE_NEEDED=true
elif [ "rom_downloader_server.py" -nt "bin/rom_downloader_server" ]; then
    COMPILE_NEEDED=true
fi

if [ "$COMPILE_NEEDED" = true ]; then
    echo "[4/4] Python backend has changed or binary is missing. Compiling standalone server..."
    pyinstaller --onefile --clean rom_downloader_server.py
    if [ $? -ne 0 ]; then
        echo "ERROR: PyInstaller compilation failed."
        read -p "Press enter to exit..."
        exit 1
    fi
    mkdir -p bin
    cp dist/rom_downloader_server bin/
    echo "Backend compiled successfully."
else
    echo "[4/4] Python backend binary is up-to-date. Skipping compilation."
fi

echo ""
echo "======================================================="
echo "Starting Aura Console Desktop App..."
echo "======================================================="
echo ""

# Run Electron
npm start
