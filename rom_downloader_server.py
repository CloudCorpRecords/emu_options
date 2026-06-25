import http.server
import socketserver
import urllib.request
import urllib.parse
import json
import os
import sys
import threading
import time
import glob

PORT = 8080
WORKSPACE_DIR = "/Users/reneopserabase/Documents/emu_stuff"
DOWNLOAD_DIR = os.path.join(WORKSPACE_DIR, "Downloads")
CACHE_DIR = os.path.join(WORKSPACE_DIR, "cache")
STATIC_DIR = os.path.join(WORKSPACE_DIR, "downloader")
COMPAT_DB_PATH = os.path.join(WORKSPACE_DIR, "compat_db.json")

os.makedirs(DOWNLOAD_DIR, exist_ok=True)
os.makedirs(CACHE_DIR, exist_ok=True)
os.makedirs(STATIC_DIR, exist_ok=True)

# ---------------------------------------------------------------------------
# Compatibility Patch Database helpers
# ---------------------------------------------------------------------------

def _load_compat_db():
    """Load compat_db.json, returning the full dict. Creates skeleton if missing."""
    if os.path.exists(COMPAT_DB_PATH):
        try:
            with open(COMPAT_DB_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"version": "1.0.0", "games": {}, "known_flags": {}}

def _save_compat_db(db):
    """Persist compat_db.json atomically."""
    tmp = COMPAT_DB_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(db, f, indent=2, ensure_ascii=False)
    os.replace(tmp, COMPAT_DB_PATH)

def get_compat_flags(game_title):
    """
    Return a dict of {flag: value} for the given game title.
    Uses multiple matching strategies so filenames like
    '007 Blood Stone (USA)' match DB key '007 Blood Stone'.
    Returns {} if no patch entry exists.
    """
    import re
    db = _load_compat_db()
    games = db.get("games", {})

    # Normalise: lowercase, strip region tags like (USA)(v1.0), replace separators
    def _normalise(s):
        s = re.sub(r'\([^)]*\)', '', s)   # remove (USA), (Europe), etc.
        s = re.sub(r'\[[^\]]*\]', '', s)   # remove [!], [T-En], etc.
        s = re.sub(r'[_\-.]', ' ', s)      # replace underscores/dashes/dots
        return s.lower().strip()

    norm_title = _normalise(game_title)

    # 1. Exact match (original)
    if game_title in games:
        return games[game_title].get("flags", {})

    best = None
    best_score = 0

    for key, val in games.items():
        norm_key = _normalise(key)

        # 2. Exact normalised match
        if norm_key == norm_title:
            return val.get("flags", {})

        # 3. Title starts with the key (e.g. filename has extra region info)
        if norm_title.startswith(norm_key) and len(norm_key) > best_score:
            best = val
            best_score = len(norm_key)

        # 4. All words from the DB key appear in the filename
        key_words = set(norm_key.split())
        title_words = set(norm_title.split())
        if key_words and key_words.issubset(title_words):
            score = len(key_words)
            if score > best_score:
                best = val
                best_score = score

    if best:
        return best.get("flags", {})
    return {}

def build_flag_string(flags):
    """
    Convert a flags dict into a shell-safe argument string.
    Always uses explicit  --flag=true / --flag=false syntax so that
    emulators like XeniOS that require '=true' to override defaults work.
    False values are OMITTED (flag stays at its emulator default).
    """
    parts = []
    for flag, value in flags.items():
        if value is True:
            parts.append(f"{flag}=true")
        elif value is False:
            continue  # false = don't override, use emulator default
        else:
            parts.append(f"{flag}={value}")
    return " ".join(parts)

# Archive.org collection identifiers for each system
SYSTEM_ARCHIVES = {
    "nes": "ef_nintendo_entertainment_-system_-no-intro_2024-04-23",
    "snes": "ef_nintendo_snes_no-intro_2024-04-20",
    "n64": "ef_nintendo_64_no-intro_2024-02-10",
    "gba": "ef_gba_no-intro_2024-02-21",
    "gbc": "ef_GBC_No-Intro",
    "gb": "ef_Nintendo_Gameboy_No-Intro_2024-04-23",
    "genesis": "nointro.md",
    "gamegear": "nointro.gg",
    "sms": "nointro.ms-mkiii",
    "pcengine": "nointro.tg-16",
    "sega32x": "nointro.32x",
    "atari2600": "nointro.atari-2600",
    "nds": "2024-nintendo-ds-hearto-1g1r-collection",
    "psx": "2024-sony-playstation-usa-hearto-1g1r-collection",
    "saturn": "2024-sega-saturn-hearto-1g1r-collection",
    "psp": [
        "psp-chd-zstd-redump-part1",
        "psp-chd-zstd-redump-part2"
    ],
    "segacd": "htgdb-gamepacks",
    "atari7800": "Atari7800RomCollectionByGhostware",
    "lynx": "AtariLynxRomCollectionByGhostware",
    "vb": "virtual-boy-myrient",
    "wonderswan": "WonderswanRomCollectionByGhostware",
    "wonderswan-color": "WonderswanColorRomCollectionByGhostware",
    "colecovision": "ef_coleco_no-intro_2024-03-17",
    "intellivision": "MattelIntellivision2014ReferenceSet-CompleteTosecRomCollection",
    "vectrex": "gce-vectrex_202111",
    "odyssey2": "full-magnavox-odyssey-2-rom-collection-for-for-retro-achievement-by-retro-raven-updated-4-oct-2024",
    "sg1000": "SegaSG-1000RomCollectionByGhostware",
    "ngp": "ef_snk_neogeo_Pocket_neogeo_pocket_color_no-intro_2024",
    "ngpc": "Neo-GeoPocketColorRomCollectionByGhostware",
    "xbox360": [
        "CentralArquivista-XBOX360-part1",
        "CentralArquivista-XBOX360-part2",
        "CentralArquivista-XBOX360-part3",
        "CentralArquivista-XBOX360-part4",
        "redump-microsoft-xbox-360-games-myrient-unique-files",
        "redump_x360",
        "XBOX-360-ISO",
        "minecraft-xbox-360-edition-world-en-ja-fr-de-es-it-pt-zh-ko",
        "goat-simulator-360-bc.-7z",
        "resident-evil-4-usa-eur_20260219",
        "otomedius-gorgeous-japan-t-en-by-game-stone-v-1.81",
        "life-is-strange-complete-season-Xbox360"
    ]
}

# Supported extensions per system
SYSTEM_EXTENSIONS = {
    "nes": [".nes", ".zip"],
    "snes": [".sfc", ".smc", ".zip"],
    "n64": [".z64", ".n64", ".zip"],
    "gba": [".gba", ".zip"],
    "gbc": [".gbc", ".zip"],
    "gb": [".gb", ".zip"],
    "genesis": [".md", ".bin", ".zip"],
    "gamegear": [".gg", ".zip"],
    "sms": [".sms", ".zip"],
    "pcengine": [".pce", ".zip"],
    "sega32x": [".32x", ".zip"],
    "atari2600": [".a26", ".bin", ".zip"],
    "nds": [".nds", ".zip", ".7z"],
    "psx": [".bin", ".cue", ".iso", ".chd", ".zip", ".7z"],
    "saturn": [".bin", ".cue", ".iso", ".chd", ".zip", ".7z"],
    "psp": [".iso", ".cso", ".zip", ".7z", ".chd"],
    "segacd": [".chd", ".bin", ".cue", ".iso", ".zip", ".7z"],
    "atari7800": [".a78", ".bin", ".zip"],
    "lynx": [".lnx", ".zip"],
    "vb": [".vb", ".zip"],
    "wonderswan": [".ws", ".zip"],
    "wonderswan-color": [".wsc", ".zip"],
    "colecovision": [".col", ".rom", ".zip"],
    "intellivision": [".int", ".bin", ".zip"],
    "vectrex": [".vec", ".bin", ".zip"],
    "odyssey2": [".bin", ".zip"],
    "sg1000": [".sg", ".bin", ".zip"],
    "ngp": [".ngp", ".zip"],
    "ngpc": [".ngc", ".zip"],
    "xbox360": [".iso", ".xex", ".zip", ".rar", ".7z"]
}

# Global dictionary to track active downloads
# format: { download_id: { "filename": ..., "bytes_written": ..., "total_size": ..., "status": ..., "error": ... } }
downloads_status = {}

# Optional path prefix filters for archives shared between multiple systems
# Only files whose name starts with one of these prefixes will be included
SYSTEM_PATH_FILTERS = {
    "segacd": ["MegaCD/", "@MegaCD"],
}

def get_system_rom_list(system):
    """Fetches or loads from cache the list of ROM files for a system."""
    if system not in SYSTEM_ARCHIVES:
        return []
    
    cache_path = os.path.join(CACHE_DIR, f"{system}.json")
    
    # Check if cache exists and is fresh (less than 24 hours old)
    if os.path.exists(cache_path):
        mtime = os.path.getmtime(cache_path)
        if time.time() - mtime < 86400: # 24 hours
            try:
                with open(cache_path, "r") as f:
                    return json.load(f)
            except Exception as e:
                print(f"Error reading cache for {system}: {e}", file=sys.stderr)
    
    # Otherwise fetch from archive.org metadata API
    cfg = SYSTEM_ARCHIVES[system]
    identifiers = cfg if isinstance(cfg, list) else [cfg]
    
    rom_list = []
    for identifier in identifiers:
        url = f"https://archive.org/metadata/{identifier}"
        print(f"Fetching metadata for {system} from {url}...")
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=15) as response:
                data = json.loads(response.read().decode('utf-8'))
                
                files = data.get("files", [])
                valid_exts = SYSTEM_EXTENSIONS.get(system, [".zip"])
                path_filters = SYSTEM_PATH_FILTERS.get(system, None)
                
                for f in files:
                    name = f.get("name", "")
                    name_lower = name.lower()
                    
                    # Skip metadata/system files
                    if name.startswith("__"):
                        continue
                    
                    # If this archive is shared, only include files under our system's paths
                    if path_filters and not any(name.startswith(pf) for pf in path_filters):
                        continue
                    
                    # Match target extensions
                    if any(name_lower.endswith(ext) for ext in valid_exts):
                        size_str = f.get("size", "0")
                        try:
                            size = int(size_str)
                        except ValueError:
                            size = 0
                        
                        rom_list.append({
                            "name": name,
                            "size": size,
                            "format": f.get("format", ""),
                            "archive_id": identifier
                        })
        except Exception as e:
            print(f"Error fetching metadata for {system} from {identifier}: {e}", file=sys.stderr)
            
    # Write to cache if we retrieved any results
    if rom_list:
        try:
            with open(cache_path, "w") as f:
                json.dump(rom_list, f)
            print(f"Successfully cached {len(rom_list)} ROMs for {system}")
        except Exception as e:
            print(f"Error writing cache for {system}: {e}", file=sys.stderr)
        return rom_list
    else:
        # Fallback to expired cache if it exists
        if os.path.exists(cache_path):
            try:
                with open(cache_path, "r") as f:
                    return json.load(f)
            except Exception:
                pass
        return []

def resolve_playable_file(dir_path):
    """Given a directory path, scans it recursively and returns the path to the main playable file."""
    if not os.path.isdir(dir_path):
        return dir_path
        
    # Priority extensions
    priority_exts = [".cue", ".ccd", ".chd", ".iso", ".xex"]
    fallback_exts = [".bin", ".nds", ".gba", ".gbc", ".gb", ".nes", ".sfc", ".smc", ".z64", ".n64"]
    
    all_files = []
    for root, _, files in os.walk(dir_path):
        for f in files:
            if not f.startswith('.'):
                all_files.append(os.path.join(root, f))
                
    # Search for priority extensions first
    for ext in priority_exts:
        for fpath in all_files:
            if fpath.lower().endswith(ext):
                return fpath
                
    # Fall back to other valid extensions
    for ext in fallback_exts:
        for fpath in all_files:
            if fpath.lower().endswith(ext):
                return fpath
                
    # If nothing matched, just return the first file if any, else the directory itself
    return all_files[0] if all_files else dir_path

def extract_archive(archive_path, extract_dir):
    """Extracts zip, 7z, or rar files using 7z command-line tool or Python zipfile module."""
    ext = os.path.splitext(archive_path.lower())[1]
    if ext not in [".zip", ".7z", ".rar"]:
        return False
        
    os.makedirs(extract_dir, exist_ok=True)
    
    # Try 7z first
    exe_7z = "/opt/homebrew/bin/7z"
    if not os.path.exists(exe_7z):
        exe_7z = "7z"
        
    try:
        import subprocess
        cmd = [exe_7z, "x", "-y", f"-o{extract_dir}", archive_path]
        print(f"Running extraction: {' '.join(cmd)}")
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if result.returncode == 0:
            print(f"Successfully extracted {archive_path} using 7z")
            return True
        else:
            print(f"7z extraction failed: {result.stderr}")
    except Exception as e:
        print(f"Failed to extract with 7z: {e}")
        
    # Fallback to python zipfile for .zip
    if ext == ".zip":
        try:
            print(f"Attempting fallback zipfile extraction for {archive_path}...")
            import zipfile
            with zipfile.ZipFile(archive_path, 'r') as zip_ref:
                zip_ref.extractall(extract_dir)
            print(f"Successfully extracted {archive_path} using zipfile")
            return True
        except Exception as e:
            print(f"Fallback zipfile extraction failed: {e}")
            
    return False

def download_worker(download_id, system, filename):
    """Background thread to download a file from archive.org."""
    if system not in SYSTEM_ARCHIVES:
        downloads_status[download_id] = {"status": "error", "error": "Invalid system"}
        return
    
    # Resolve the correct Archive.org collection identifier for this specific ROM
    identifier = None
    rom_list = get_system_rom_list(system)
    for rom in rom_list:
        if rom.get("name") == filename:
            identifier = rom.get("archive_id")
            break
            
    # Fallback to the first collection in the list or the string itself
    if not identifier:
        cfg = SYSTEM_ARCHIVES[system]
        identifier = cfg[0] if isinstance(cfg, list) else cfg
        
    escaped_filename = urllib.parse.quote(filename, safe='/')
    url = f"https://archive.org/download/{identifier}/{escaped_filename}"
    
    # Organize downloads into system-specific subfolders using only the base filename
    base_filename = os.path.basename(filename)
    system_dir = os.path.join(DOWNLOAD_DIR, system)
    os.makedirs(system_dir, exist_ok=True)
    dest_path = os.path.join(system_dir, base_filename)
    
    downloads_status[download_id] = {
        "filename": filename,
        "bytes_written": 0,
        "total_size": 0,
        "status": "starting",
        "error": None
    }
    
    print(f"Starting download from {url} to {dest_path}...")
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as response:
            total_size = int(response.headers.get('content-length', 0))
            downloads_status[download_id]["total_size"] = total_size
            downloads_status[download_id]["status"] = "downloading"
            
            bytes_written = 0
            block_size = 65536 # 64KB chunks
            
            with open(dest_path, "wb") as out_file:
                while True:
                    buffer = response.read(block_size)
                    if not buffer:
                        break
                    out_file.write(buffer)
                    bytes_written += len(buffer)
                    downloads_status[download_id]["bytes_written"] = bytes_written
            
            # Post-download extraction for specific systems
            base_no_ext, ext = os.path.splitext(base_filename)
            ext_lower = ext.lower()
            if system in ["psx", "saturn", "segacd", "xbox360", "psp"] and ext_lower in [".zip", ".7z", ".rar"]:
                downloads_status[download_id]["status"] = "extracting"
                extract_dir = os.path.join(system_dir, base_no_ext)
                print(f"Extracting {dest_path} to {extract_dir}...")
                success = extract_archive(dest_path, extract_dir)
                if success:
                    print(f"Extraction successful. Deleting original archive {dest_path}")
                    try:
                        os.remove(dest_path)
                    except Exception as e:
                        print(f"Failed to delete original archive: {e}")
                    downloads_status[download_id]["status"] = "completed"
                else:
                    downloads_status[download_id]["status"] = "error"
                    downloads_status[download_id]["error"] = "Extraction failed"
            else:
                downloads_status[download_id]["status"] = "completed"
                print(f"Completed download of {filename}")
            
    except Exception as e:
        print(f"Download failed for {filename}: {e}", file=sys.stderr)
        downloads_status[download_id]["status"] = "error"
        downloads_status[download_id]["error"] = str(e)
        if os.path.exists(dest_path):
            try:
                os.remove(dest_path)
            except Exception:
                pass

class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC_DIR, **kwargs)

    def end_headers(self):
        # Allow cross-origin requests for local API queries
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200, "ok")
        self.end_headers()

    def do_GET(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path
        query = urllib.parse.parse_qs(parsed_url.query)
        
        # Handle API search
        if path == "/api/search":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            
            system = query.get("system", [None])[0]
            q = query.get("q", [""])[0].lower()
            
            if not system:
                self.wfile.write(json.dumps({"error": "Missing system parameter"}).encode())
                return
                
            rom_list = get_system_rom_list(system)
            
            # Simple substring matching
            results = []
            for rom in rom_list:
                name = rom["name"]
                if q in name.lower():
                    results.append(rom)
                    if len(results) >= 100: # Cap at 100 matches
                        break
            
            self.wfile.write(json.dumps(results).encode())
            return
            
        # Handle API download trigger
        elif path == "/api/download":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            
            system = query.get("system", [None])[0]
            filename = query.get("filename", [None])[0]
            
            if not system or not filename:
                self.wfile.write(json.dumps({"error": "Missing system or filename parameter"}).encode())
                return
            
            # Generate a simple download ID
            download_id = str(abs(hash(filename + str(time.time()))))
            
            # Start download in a background thread
            t = threading.Thread(target=download_worker, args=(download_id, system, filename))
            t.daemon = True
            t.start()
            
            self.wfile.write(json.dumps({"download_id": download_id}).encode())
            return
            
        # Handle API download progress checking
        elif path == "/api/progress":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            
            download_id = query.get("id", [None])[0]
            if not download_id or download_id not in downloads_status:
                self.wfile.write(json.dumps({"error": "Invalid download ID"}).encode())
                return
                
            status_data = downloads_status[download_id]
            self.wfile.write(json.dumps(status_data).encode())
            return

        # Reveal downloads folder in Finder
        elif path == "/api/open-downloads":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            
            try:
                os.system(f'open "{DOWNLOAD_DIR}"')
                self.wfile.write(json.dumps({"success": True}).encode())
            except Exception as e:
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode())
            return
        
        elif path == "/api/list-downloads":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            
            try:
                result = []
                if os.path.exists(DOWNLOAD_DIR):
                    for system_dir in sorted(os.listdir(DOWNLOAD_DIR)):
                        system_path = os.path.join(DOWNLOAD_DIR, system_dir)
                        if not os.path.isdir(system_path):
                            continue
                        games = []
                        for fname in sorted(os.listdir(system_path)):
                            fpath = os.path.join(system_path, fname)
                            if fname.startswith('.'):
                                continue
                            
                            if os.path.isdir(fpath):
                                total_size = 0
                                for root, _, files in os.walk(fpath):
                                    for f in files:
                                        total_size += os.path.getsize(os.path.join(root, f))
                                playable_path = resolve_playable_file(fpath)
                                games.append({
                                    "filename": fname,
                                    "system": system_dir,
                                    "size": total_size,
                                    "path": playable_path
                                })
                            elif os.path.isfile(fpath):
                                fsize = os.path.getsize(fpath)
                                games.append({
                                    "filename": fname,
                                    "system": system_dir,
                                    "size": fsize,
                                    "path": fpath
                                })
                        if games:
                            result.extend(games)
                self.wfile.write(json.dumps(result).encode())
            except Exception as e:
                self.wfile.write(json.dumps({"error": str(e)}).encode())
            return
            
        # Launch the correct emulator for the given system (or OpenEmu as fallback)
        elif path == "/api/launch-emulator":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            
            system = query.get("system", [None])[0] or "nes"
            try:
                if system == "nds":
                    melon_paths = [
                        os.path.join(WORKSPACE_DIR, "melonDS.app"),
                        "/Applications/melonDS.app",
                    ]
                    found = next((p for p in melon_paths if os.path.exists(p)), None)
                    app = found or f"{WORKSPACE_DIR}/OpenEmu.app"
                elif system == "xbox360":
                    xenia_paths = [
                        os.path.join(WORKSPACE_DIR, "Xenia.app"),
                        os.path.join(WORKSPACE_DIR, "XeniOS.app"),
                        "/Applications/Xenia.app",
                        "/Applications/XeniOS.app",
                    ]
                    found = next((p for p in xenia_paths if os.path.exists(p)), None)
                    app = found or f"{WORKSPACE_DIR}/OpenEmu.app"
                elif system == "psp":
                    ppsspp_paths = [
                        "/Applications/PPSSPP.app",
                        os.path.join(WORKSPACE_DIR, "PPSSPP.app"),
                    ]
                    found = next((p for p in ppsspp_paths if os.path.exists(p)), None)
                    app = found or f"{WORKSPACE_DIR}/OpenEmu.app"
                else:
                    app = f"{WORKSPACE_DIR}/OpenEmu.app"
                os.system(f'open "{app}"')
                self.wfile.write(json.dumps({"success": True, "app": os.path.basename(app)}).encode())
            except Exception as e:
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode())
            return
        
        elif path == "/api/delete-game":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            
            filename = query.get("filename", [None])[0]
            system = query.get("system", [None])[0]
            if not filename or not system:
                self.wfile.write(json.dumps({"error": "Missing filename or system"}).encode())
                return
            
            target = os.path.join(DOWNLOAD_DIR, system, os.path.basename(filename))
            try:
                if os.path.exists(target):
                    if os.path.isdir(target):
                        import shutil
                        shutil.rmtree(target)
                    else:
                        os.remove(target)
                    self.wfile.write(json.dumps({"success": True}).encode())
                else:
                    self.wfile.write(json.dumps({"error": "File not found"}).encode())
            except Exception as e:
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode())
            return

        elif path == "/api/check-emulators":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            
            status = {
                "nds": os.path.exists(os.path.join(WORKSPACE_DIR, "melonDS.app")) or os.path.exists("/Applications/melonDS.app"),
                "xbox360": os.path.exists(os.path.join(WORKSPACE_DIR, "Xenia.app")) or os.path.exists(os.path.join(WORKSPACE_DIR, "XeniOS.app")) or os.path.exists("/Applications/Xenia.app") or os.path.exists("/Applications/XeniOS.app"),
                "psp": os.path.exists(os.path.join(WORKSPACE_DIR, "PPSSPP.app")) or os.path.exists("/Applications/PPSSPP.app"),
            }
            self.wfile.write(json.dumps(status).encode())
            return
            
        elif path == "/api/install-xenia":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            
            # Start installation in a background thread to prevent UI lockup
            def install_worker():
                downloads_status["xenia-install"] = {"status": "downloading", "bytes_written": 0, "total_size": 0}
                url = "https://github.com/xenios-jp/XeniOS/releases/download/release-v2.0.1-build-9730/xenios_macos_universal.dmg"
                dmg_path = os.path.join(WORKSPACE_DIR, "xenios_temp.dmg")
                mount_dir = "/tmp/xenios_mount"
                
                try:
                    # 1. Download DMG
                    print(f"Downloading XeniOS DMG from {url}...")
                    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
                    with urllib.request.urlopen(req) as response:
                        total_size = int(response.headers.get('content-length', 0))
                        downloads_status["xenia-install"]["total_size"] = total_size
                        
                        bytes_written = 0
                        block_size = 131072 # 128KB chunks
                        with open(dmg_path, "wb") as f:
                            while True:
                                buffer = response.read(block_size)
                                if not buffer:
                                    break
                                f.write(buffer)
                                bytes_written += len(buffer)
                                downloads_status["xenia-install"]["bytes_written"] = bytes_written
                                
                    # 2. Mount DMG
                    downloads_status["xenia-install"]["status"] = "mounting"
                    print("Mounting DMG...")
                    os.makedirs(mount_dir, exist_ok=True)
                    import subprocess
                    subprocess.run(["hdiutil", "attach", "-nobrowse", "-mountpoint", mount_dir, dmg_path], check=True)
                    
                    # 3. Copy App
                    downloads_status["xenia-install"]["status"] = "copying"
                    apps = [f for f in os.listdir(mount_dir) if f.endswith(".app")]
                    if not apps:
                        raise Exception("No .app bundle found inside the DMG.")
                    src_app = os.path.join(mount_dir, apps[0])
                    dest_app = os.path.join(WORKSPACE_DIR, "XeniOS.app")
                    print(f"Copying {src_app} to {dest_app}...")
                    if os.path.exists(dest_app):
                        import shutil
                        if os.path.isdir(dest_app):
                            shutil.rmtree(dest_app)
                        else:
                            os.remove(dest_app)
                            
                    subprocess.run(["cp", "-R", src_app, dest_app], check=True)
                    
                    # 4. Unmount and clean up
                    downloads_status["xenia-install"]["status"] = "unmounting"
                    print("Detaching DMG...")
                    subprocess.run(["hdiutil", "detach", mount_dir], check=True)
                    
                    if os.path.exists(dmg_path):
                        os.remove(dmg_path)
                    
                    downloads_status["xenia-install"]["status"] = "completed"
                    print("XeniOS installation completed successfully!")
                except Exception as e:
                    print(f"XeniOS installation failed: {e}")
                    downloads_status["xenia-install"]["status"] = "error"
                    downloads_status["xenia-install"]["error"] = str(e)
                    # Clean up
                    try:
                        import subprocess
                        subprocess.run(["hdiutil", "detach", mount_dir], stderr=subprocess.PIPE)
                    except Exception:
                        pass
                    if os.path.exists(dmg_path):
                        try: os.remove(dmg_path)
                        except Exception: pass
            
            t = threading.Thread(target=install_worker)
            t.daemon = True
            t.start()
            
            self.wfile.write(json.dumps({"success": True}).encode())
            return

        # Import downloaded ROM directly into OpenEmu
        elif path == "/api/import-game":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            
            filename = query.get("filename", [None])[0]
            system = query.get("system", [None])[0]
            if not filename:
                self.wfile.write(json.dumps({"error": "Missing filename parameter"}).encode())
                return
            
            # Files are saved flat (basename only) inside Downloads/<system>/
            # The filename coming in may be a nested path like "collection/System/game.zip"
            base_filename = os.path.basename(filename)
            
            # 1. Look in system-specific folder first (most reliable)
            dest_path = None
            if system:
                # Try finding as directory first (extracted folder)
                base_no_ext, _ = os.path.splitext(base_filename)
                candidates = [
                    os.path.join(DOWNLOAD_DIR, system, base_filename),
                    os.path.join(DOWNLOAD_DIR, system, base_no_ext)
                ]
                for candidate in candidates:
                    if os.path.exists(candidate):
                        dest_path = candidate
                        break
            
            # 2. Recursive glob fallback across all system subfolders
            if not dest_path:
                matches = glob.glob(os.path.join(DOWNLOAD_DIR, "**", base_filename), recursive=True)
                if matches:
                    dest_path = matches[0]
                else:
                    base_no_ext, _ = os.path.splitext(base_filename)
                    matches = glob.glob(os.path.join(DOWNLOAD_DIR, "**", base_no_ext), recursive=True)
                    if matches:
                        dest_path = matches[0]
            
            if not dest_path:
                print(f"File not found: {base_filename}")
                self.wfile.write(json.dumps({"error": f"File not found: {base_filename}. Please download it first."}).encode())
                return
                
            # If dest_path is a directory, resolve the main playable file
            if os.path.isdir(dest_path):
                dest_path = resolve_playable_file(dest_path)
                print(f"Resolved directory import to playable file: {dest_path}")
                
            if system == "xbox360":
                # Find Xbox 360 emulator
                xenia_paths = [
                    os.path.join(WORKSPACE_DIR, "Xenia.app"),
                    os.path.join(WORKSPACE_DIR, "XeniOS.app"),
                    "/Applications/Xenia.app",
                    "/Applications/XeniOS.app"
                ]
                found_xenia = None
                for p in xenia_paths:
                    if os.path.exists(p):
                        found_xenia = p
                        break
                
                if not found_xenia:
                    err_msg = (
                        "Xbox 360 emulator (Xenia.app or XeniOS.app) not found. "
                        "Please download the macOS experimental build and place it in your emu_stuff workspace folder.\n\n"
                        "Download Links:\n"
                        "- wmarti/xenia-mac (https://github.com/wmarti/xenia-mac/releases)\n"
                        "- xenios-jp/XeniOS (https://github.com/xenios-jp/XeniOS/releases)"
                    )
                    self.wfile.write(json.dumps({"success": False, "error": err_msg}).encode())
                    return
                
                # Locate executable within the app bundle to run directly in background
                binary_path = found_xenia
                if found_xenia.endswith(".app"):
                    macos_dir = os.path.join(found_xenia, "Contents", "MacOS")
                    if os.path.exists(macos_dir):
                        executables = [
                            f for f in os.listdir(macos_dir)
                            if not f.startswith('.') and os.path.isfile(os.path.join(macos_dir, f)) and f != "xenia.log"
                        ]
                        if executables:
                            pref = ["Xenia-edge", "Xenia", "xenia"]
                            chosen = None
                            for p_name in pref:
                                if p_name in executables:
                                    chosen = p_name
                                    break
                            if not chosen:
                                chosen = executables[0]
                            binary_path = os.path.join(macos_dir, chosen)
                
                try:
                    # --- Compatibility patch flag injection ---
                    game_name = os.path.splitext(os.path.basename(dest_path))[0]
                    compat_flags = get_compat_flags(game_name)
                    flag_str = build_flag_string(compat_flags)
                    if flag_str:
                        print(f"Compat flags for '{game_name}': {flag_str}")
                    cmd = f'"{binary_path}" {flag_str} "{dest_path}" &'.strip()
                    print(f"Executing direct launch command: {cmd}")
                    os.system(cmd)
                    self.wfile.write(json.dumps({"success": True, "compat_flags": compat_flags}).encode())
                except Exception as e:
                    self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode())
                return
            
            if system == "nds":
                # DeSmuME in OpenEmu is x86_64 only and crashes on Apple Silicon.
                # Route NDS games to melonDS which is a universal (arm64+x86_64) binary.
                melon_paths = [
                    os.path.join(WORKSPACE_DIR, "melonDS.app"),
                    "/Applications/melonDS.app",
                ]
                found_melon = next((p for p in melon_paths if os.path.exists(p)), None)
                if found_melon:
                    try:
                        os.system(f'open -a "{found_melon}" "{dest_path}"')
                        self.wfile.write(json.dumps({"success": True, "emulator": "melonDS"}).encode())
                    except Exception as e:
                        self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode())
                    return
                # Fall through to OpenEmu if melonDS not found
 
            if system == "psp":
                # Route PSP to PPSSPP if available (better performance than OpenEmu core)
                ppsspp_paths = [
                    "/Applications/PPSSPP.app",
                    os.path.join(WORKSPACE_DIR, "PPSSPP.app"),
                ]
                found_ppsspp = next((p for p in ppsspp_paths if os.path.exists(p)), None)
                if found_ppsspp:
                    try:
                        os.system(f'open -a "{found_ppsspp}" "{dest_path}"')
                        self.wfile.write(json.dumps({"success": True, "emulator": "PPSSPP"}).encode())
                    except Exception as e:
                        self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode())
                    return
                # Fall through to OpenEmu PPSSPP core if standalone not found
                
            try:
                os.system(f'open -a "{WORKSPACE_DIR}/OpenEmu.app" "{dest_path}"')
                self.wfile.write(json.dumps({"success": True}).encode())
            except Exception as e:
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode())
            return
            
        # -----------------------------------------------------------------------
        # Compatibility Patch API
        # -----------------------------------------------------------------------

        elif path == "/api/compat-db":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps(_load_compat_db()).encode())
            return

        elif path == "/api/compat-patch":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            game = query.get("game", [None])[0]
            if not game:
                self.wfile.write(json.dumps({"error": "Missing ?game= parameter"}).encode())
                return
            db = _load_compat_db()
            entry = db.get("games", {}).get(game)
            if entry:
                self.wfile.write(json.dumps({"found": True, "patch": entry}).encode())
            else:
                self.wfile.write(json.dumps({"found": False}).encode())
            return

        elif path == "/api/compat-export":
            db = _load_compat_db()
            export_bytes = json.dumps(db, indent=2, ensure_ascii=False).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Disposition", "attachment; filename=\"compat_db.json\"")
            self.send_header("Content-Length", str(len(export_bytes)))
            self.end_headers()
            self.wfile.write(export_bytes)
            return

        # Fallback to regular file server
        super().do_GET()

    def do_POST(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path
        query = urllib.parse.parse_qs(parsed_url.query)
        
        if path == "/api/upload":
            content_length = int(self.headers.get('Content-Length', 0))
            system = query.get("system", [None])[0]
            filename = query.get("filename", [None])[0]
            
            if not system or not filename:
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Missing system or filename parameter"}).encode())
                return
                
            # Clean filename to prevent directory traversal
            filename = os.path.basename(filename)
            system_dir = os.path.join(DOWNLOAD_DIR, system)
            os.makedirs(system_dir, exist_ok=True)
            dest_path = os.path.join(system_dir, filename)
            
            print(f"Uploading file to {dest_path} ({content_length} bytes)...")
            try:
                # Read content in chunks to avoid memory bloat
                bytes_left = content_length
                block_size = 65536
                with open(dest_path, "wb") as f:
                    while bytes_left > 0:
                        chunk_size = min(bytes_left, block_size)
                        chunk = self.rfile.read(chunk_size)
                        if not chunk:
                            break
                        f.write(chunk)
                        bytes_left -= len(chunk)
                
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"success": True, "filename": filename}).encode())
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode())
            return
            
        # -----------------------------------------------------------------------
        # Compat Patch POST endpoints
        # -----------------------------------------------------------------------

        elif path == "/api/compat-patch":
            # Save / update a patch entry
            content_length = int(self.headers.get("Content-Length", 0))
            try:
                body = json.loads(self.rfile.read(content_length))
                game_key = body.get("game_key") or body.get("title")
                if not game_key:
                    raise ValueError("Missing 'game_key' in request body")
                db = _load_compat_db()
                if "games" not in db:
                    db["games"] = {}
                import datetime
                body["last_tested"] = datetime.date.today().isoformat()
                if "reported_by" not in body:
                    body["reported_by"] = "local"
                # Remove internal key from stored entry
                entry = {k: v for k, v in body.items() if k != "game_key"}
                db["games"][game_key] = entry
                _save_compat_db(db)
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"success": True, "game_key": game_key}).encode())
            except Exception as e:
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode())
            return

        elif path == "/api/compat-delete":
            content_length = int(self.headers.get("Content-Length", 0))
            try:
                body = json.loads(self.rfile.read(content_length))
                game_key = body.get("game_key")
                if not game_key:
                    raise ValueError("Missing 'game_key'")
                db = _load_compat_db()
                removed = db.get("games", {}).pop(game_key, None)
                _save_compat_db(db)
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"success": True, "removed": removed is not None}).encode())
            except Exception as e:
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode())
            return

        elif path == "/api/compat-import":
            # Merge an uploaded compat_db.json into the local one
            content_length = int(self.headers.get("Content-Length", 0))
            try:
                incoming = json.loads(self.rfile.read(content_length))
                db = _load_compat_db()
                merged = 0
                for game_key, entry in incoming.get("games", {}).items():
                    if game_key not in db["games"]:
                        db["games"][game_key] = entry
                        merged += 1
                _save_compat_db(db)
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"success": True, "merged": merged}).encode())
            except Exception as e:
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode())
            return

        self.send_response(404)
        self.end_headers()

def run_server():
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), CustomHandler) as httpd:
        print(f"ROM Downloader Server running at http://localhost:{PORT}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server.")
            httpd.server_close()

if __name__ == "__main__":
    run_server()
