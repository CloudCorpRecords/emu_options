#!/bin/bash
# Move to the directory where this script resides
cd "$(dirname "$0")"

clear
echo "======================================================="
echo "   Aura Console Developer Launcher & Installer  "
echo "======================================================="
echo "Workspace: $(pwd)"
echo ""

# Check if Node.js & npm are installed globally
HAS_NODE=true
if ! command -v npm &> /dev/null || ! command -v node &> /dev/null; then
    HAS_NODE=false
fi

# If global Node is missing, attempt to set up a local portable Node.js
if [ "$HAS_NODE" = false ]; then
    if [ -f "node-bin/bin/node" ] && [ -f "node-bin/bin/npm" ]; then
        echo "Local portable Node.js detected."
        export PATH="$(pwd)/node-bin/bin:$PATH"
        HAS_NODE=true
    else
        echo "Node.js is not installed globally on your system."
        echo "Downloading a local portable Node.js to run the Desktop App wrapper..."
        echo ""
        
        # Determine CPU architecture
        ARCH=$(uname -m)
        NODE_VER="v20.11.0"
        if [ "$ARCH" = "arm64" ]; then
            NODE_URL="https://nodejs.org/dist/${NODE_VER}/node-${NODE_VER}-darwin-arm64.tar.gz"
        else
            NODE_URL="https://nodejs.org/dist/${NODE_VER}/node-${NODE_VER}-darwin-x64.tar.gz"
        fi
        
        echo "Downloading: $NODE_URL"
        curl -L -o node-temp.tar.gz "$NODE_URL"
        
        if [ $? -eq 0 ]; then
            echo "Extracting Node.js..."
            mkdir -p node-bin-temp
            tar -xzf node-temp.tar.gz -C node-bin-temp --strip-components=1
            rm -rf node-bin
            mv node-bin-temp node-bin
            rm -f node-temp.tar.gz
            
            export PATH="$(pwd)/node-bin/bin:$PATH"
            HAS_NODE=true
            echo "Local Node.js installed successfully!"
            echo ""
        else
            echo "ERROR: Failed to download local Node.js."
            rm -f node-temp.tar.gz
        fi
    fi
fi

if [ "$HAS_NODE" = true ]; then
    echo "Starting Desktop App mode..."
    echo ""
    
    # 1. Check and Install Node.js dependencies
    if [ ! -d "node_modules" ] || [ ! -f "node_modules/.bin/electron" ]; then
        echo "[1/4] node_modules or electron binary missing. Installing Node.js dependencies..."
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
            read -p "Press open to exit..."
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

else
    echo "Could not load Node.js. Falling back to Web Browser mode..."
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
    echo "Starting ROM server on port 8080..."
    echo "Opening http://localhost:8080 in your browser..."
    echo ""
    echo "Keep this window open to keep the server running."
    echo "Press Ctrl+C here to stop the server."
    echo "======================================================="
    echo ""
    
    # Open the browser
    open "http://localhost:8080"

    # Execute the server script
    "$PYTHON_BIN" rom_downloader_server.py
fi
