/* ==========================================================================
   AURA CONSOLE - CONTROLLER & CLIENT LOGIC (XBOX REDESIGN)
   ========================================================================== */

document.addEventListener("DOMContentLoaded", () => {
  // ── Slider Navigation State ────────────────────────────────────────────────
  let currentSlideIndex = 0;
  const slidesWrapper = document.getElementById("slides-wrapper");
  const navTabs = document.querySelectorAll(".db-nav-tab");

  function goToSlide(index) {
    if (index < 0 || index > 5) return;
    currentSlideIndex = index;
    // 6 slides, each 16.6666% wide
    slidesWrapper.style.transform = `translateX(-${index * 16.6666}%)`;
    
    navTabs.forEach((tab, i) => {
      tab.classList.toggle("active", i === index);
    });

    // If switching to library, refresh it
    if (index === 2) {
      loadLibrary();
    }
    // If switching to Compat Lab, refresh it
    if (index === 4) {
      renderCompatList();
    }
    // If switching to AI Agent, refresh status and start polling
    if (index === 5) {
      initAiAgentTab();
    } else {
      stopAiAgentPolling();
    }
  }

  // Bind top nav clicks
  navTabs.forEach(tab => {
    tab.addEventListener("click", () => {
      const index = parseInt(tab.dataset.slide, 10);
      goToSlide(index);
    });
  });

  // Tactile Keyboard navigation (Arrow keys slide pages when no input is focused)
  window.addEventListener("keydown", (e) => {
    const active = document.activeElement;
    if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.contentEditable === "true")) {
      return; // Skip if typing
    }

    if (e.key === "ArrowLeft" || e.key === "Left") {
      goToSlide(Math.max(0, currentSlideIndex - 1));
    } else if (e.key === "ArrowRight" || e.key === "Right") {
      goToSlide(Math.min(5, currentSlideIndex + 1));
    }
  });

  // Bind Emulator Launcher Cards on Home slide
  document.querySelectorAll(".launcher-card").forEach(card => {
    card.addEventListener("click", (e) => {
      // Prevent card click triggering if they clicked the install button/progress UI
      if (e.target.closest(".install-xenia-btn") || e.target.closest(".install-xenia-progress")) {
        return;
      }
      
      const sys = card.dataset.sys;
      if (sys === "xbox360") {
        fetch("/api/check-emulators")
          .then(res => res.json())
          .then(status => {
            if (!status.xbox360) {
              showToast("XeniOS is not installed. Please click 'Download & Install XeniOS' first.", "warning");
              return;
            }
            launchEmulator(sys);
          })
          .catch(() => launchEmulator(sys));
      } else {
        launchEmulator(sys);
      }
    });
  });

  function launchEmulator(sys) {
    showToast(`Launching ${systemDisplayName(sys)} emulator...`, "info");
    fetch(`/api/launch-emulator?system=${sys}`)
      .then(res => res.json())
      .then(data => {
        if (data.error) showToast(`Launch error: ${data.error}`, "error");
      })
      .catch(err => console.error("Error launching emulator:", err));
  }

  // ── State ─────────────────────────────────────────────────────────────────
  let activeSystem = "nes";
  let activeSearchQuery = "";
  let searchTimeout = null;
  let activePollers = {};
  
  // Persistent Download Database (by system/filename key)
  let downloadedRoms = JSON.parse(localStorage.getItem("downloaded-roms") || "[]");

  // Recently Played game tracking
  let recentGame = JSON.parse(localStorage.getItem("recent-game") || "null");

  // ── Emulator routing table ─────────────────────────────────────────────────
  const SYSTEM_EMULATOR = {
    nds:          { label: "Play in melonDS",  app: "melonDS"  },
    xbox360:      { label: "Play in Xenia",    app: "Xenia"    },
    psp:          { label: "Play in PPSSPP",   app: "PPSSPP"   },
  };
  
  function getEmulatorInfo(system) {
    return SYSTEM_EMULATOR[system] || { label: "Play in OpenEmu", app: "OpenEmu" };
  }

  // ── Launch button label mapping ────────────────────────────────────────────
  const LAUNCH_LABEL = {
    nds:     "Launch melonDS",
    xbox360: "Launch Xenia",
    psp:     "Launch PPSSPP",
  };
  
  function getLaunchLabel(system) {
    return LAUNCH_LABEL[system] || "Launch OpenEmu";
  }

  // ── DOM refs ───────────────────────────────────────────────────────────────
  const consoleTabs         = document.querySelectorAll(".console-tab");
  const searchInput         = document.getElementById("search-input");
  const clearSearchBtn      = document.getElementById("clear-search");
  const gamesList           = document.getElementById("games-list");
  const statusMessage       = document.getElementById("status-message");
  const statusText          = document.getElementById("status-text");
  const spinner             = statusMessage.querySelector(".spinner");
  const downloadsContainer  = document.getElementById("downloads-container");
  const btnLaunchEmu        = document.getElementById("btn-launch-emu");
  const btnLaunchLabel      = document.getElementById("btn-launch-label");
  const btnLibrary          = document.getElementById("btn-library");
  const themeToggle         = document.getElementById("theme-toggle");

  // Legacy tab elements mapped to slider pages
  const tabDownloads        = document.getElementById("tab-downloads");
  const tabLibrary          = document.getElementById("tab-library");
  const libraryContainer    = document.getElementById("library-container");
  const librarySearch       = document.getElementById("library-search");
  const libraryCountBadge   = document.getElementById("library-count-badge");

  // Home Screen DOM elements
  const recentGameTag       = document.getElementById("recent-game-tag");
  const recentGameTitle     = document.getElementById("recent-game-title");
  const recentGameMeta      = document.getElementById("recent-game-meta");
  const recentGameTile      = document.getElementById("recent-game-tile");
  const statsLibCount       = document.getElementById("stats-lib-count");
  const statsLibSize        = document.getElementById("stats-lib-size");

  // ── Theme ─────────────────────────────────────────────────────────────────
  themeToggle.addEventListener("click", () => {
    const isDark = document.body.classList.toggle("dark-theme");
    document.body.classList.toggle("light-theme", !isDark);
    localStorage.setItem("color-scheme", isDark ? "dark" : "light");
    document.documentElement.style.setProperty("color-scheme", isDark ? "dark" : "light");
  });
  const savedTheme = localStorage.getItem("color-scheme") || "dark";
  if (savedTheme === "light") {
    document.body.classList.remove("dark-theme");
    document.body.classList.add("light-theme");
  }

  // ── Smart Launch button ────────────────────────────────────────────────────
  btnLaunchEmu.addEventListener("click", () => {
    fetch(`/api/launch-emulator?system=${activeSystem}`)
      .catch(err => console.error("Error launching emulator:", err));
  });

  // ── Header Library shortcut (Goes to Library slide) ────────────────────────
  if (btnLibrary) {
    btnLibrary.addEventListener("click", () => {
      goToSlide(2);
    });
  }

  function switchPanel(which) {
    if (which === "downloads") {
      goToSlide(3);
    } else if (which === "library") {
      goToSlide(2);
      loadLibrary();
    }
  }

  // ── Console Tab switching ──────────────────────────────────────────────────
  consoleTabs.forEach(tab => {
    tab.addEventListener("click", () => {
      if (tab.classList.contains("active")) return;
      consoleTabs.forEach(t => {
        t.classList.remove("active");
        t.setAttribute("aria-selected", "false");
      });
      tab.classList.add("active");
      tab.setAttribute("aria-selected", "true");
      activeSystem = tab.dataset.system;

      // Update header launch button label
      btnLaunchLabel.textContent = getLaunchLabel(activeSystem);

      // Reset search
      searchInput.value = "";
      clearSearchBtn.style.display = "none";
      activeSearchQuery = "";
      performSearch();
    });
  });

  // ── Search ─────────────────────────────────────────────────────────────────
  clearSearchBtn.addEventListener("click", () => {
    searchInput.value = "";
    clearSearchBtn.style.display = "none";
    searchInput.focus();
    activeSearchQuery = "";
    performSearch();
  });

  searchInput.addEventListener("input", (e) => {
    const val = e.target.value.trim();
    clearSearchBtn.style.display = val.length > 0 ? "flex" : "none";
    activeSearchQuery = val;
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => performSearch(), 300);
  });

  function performSearch() {
    spinner.style.display = "block";
    statusText.textContent = "Fetching game catalog from Archive.org...";
    gamesList.style.display = "none";
    statusMessage.style.display = "flex";

    const url = `/api/search?system=${activeSystem}&q=${encodeURIComponent(activeSearchQuery)}`;
    fetch(url)
      .then(res => res.json())
      .then(data => {
        spinner.style.display = "none";
        if (data.error) {
          statusText.textContent = `Error: ${data.error}`;
          return;
        }
        if (data.length === 0) {
          statusText.textContent = "No matching games found. Try a different search.";
          return;
        }
        statusMessage.style.display = "none";
        renderGames(data);
      })
      .catch(err => {
        console.error("Search error:", err);
        spinner.style.display = "none";
        statusText.textContent = "Network error. Make sure the local python server is running.";
      });
  }

  // ── Render Games ───────────────────────────────────────────────────────────
  function renderGames(games) {
    gamesList.innerHTML = "";
    gamesList.style.display = "grid";

    games.forEach(game => {
      const li = document.createElement("li");
      const isDownloaded = downloadedRoms.includes(game.name) || downloadedRoms.includes(game.name.split("/").pop());
      li.className = `game-card${isDownloaded ? " downloaded" : ""}`;
      li.dataset.filename = game.name;

      const niceTitle = cleanGameTitle(game.name);
      const sizeFormatted = formatBytes(game.size);
      const emuInfo = getEmulatorInfo(activeSystem);
      const playText = emuInfo.label;

      li.innerHTML = `
        <div class="game-info">
          <h3 class="game-title" title="${game.name}">${niceTitle}</h3>
          <div class="game-meta">
            <span class="meta-badge">${activeSystem.toUpperCase()}</span>
            <span>${sizeFormatted}</span>
          </div>
        </div>
        <button class="btn btn-download">
          ${isDownloaded ? `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            ${playText}
          ` : `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            Download
          `}
        </button>
      `;

      const downloadBtn = li.querySelector(".btn-download");
      downloadBtn.addEventListener("click", () => {
        if (li.classList.contains("downloaded")) {
          playRom(game.name, downloadBtn, activeSystem);
        } else {
          startRomDownload(game.name, downloadBtn, li, activeSystem);
        }
      });

      gamesList.appendChild(li);
    });
  }

  // ── Library Panel ──────────────────────────────────────────────────────────
  let libraryData = [];
  let libraryFilter = "";

  librarySearch.addEventListener("input", (e) => {
    libraryFilter = e.target.value.toLowerCase();
    renderLibrary();
  });

  function loadLibrary() {
    fetch("/api/list-downloads")
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          libraryContainer.innerHTML = `<div class="no-downloads"><p>Error: ${data.error}</p></div>`;
          return;
        }
        libraryData = data;
        
        // Sync downloadedRoms with the actual list of files retrieved from the server
        downloadedRoms = data.map(game => game.filename);
        localStorage.setItem("downloaded-roms", JSON.stringify(downloadedRoms));
        
        // Update badge
        const count = data.length;
        libraryCountBadge.textContent = count;
        libraryCountBadge.style.display = count > 0 ? "inline-flex" : "none";
        
        // Update Home Dashboard stats
        updateHomeStats();

        renderLibrary();
      })
      .catch(() => {
        libraryContainer.innerHTML = `<div class="no-downloads"><p>Could not load library. Is the server running?</p></div>`;
      });
  }

  function renderLibrary() {
    const filtered = libraryFilter
      ? libraryData.filter(g => g.filename.toLowerCase().includes(libraryFilter) || g.system.toLowerCase().includes(libraryFilter))
      : libraryData;

    if (filtered.length === 0) {
      libraryContainer.innerHTML = `<div class="no-downloads"><p>${libraryData.length === 0 ? "No games downloaded yet." : "No matches for \"" + libraryFilter + "\""}</p></div>`;
      return;
    }

    // Group by system
    const bySystem = {};
    filtered.forEach(g => {
      if (!bySystem[g.system]) bySystem[g.system] = [];
      bySystem[g.system].push(g);
    });

    libraryContainer.innerHTML = "";
    Object.entries(bySystem).sort().forEach(([sys, games]) => {
      const sysLabel = document.createElement("div");
      sysLabel.className = "lib-system-label";
      sysLabel.textContent = systemDisplayName(sys);
      libraryContainer.appendChild(sysLabel);

      games.forEach(game => {
        const row = document.createElement("div");
        row.className = "lib-game-row";
        const emuInfo = getEmulatorInfo(game.system);
        const niceTitle = cleanGameTitle(game.filename);

        row.innerHTML = `
          <div class="lib-game-info">
            <span class="lib-game-title" title="${game.filename}">${niceTitle}</span>
            <span class="lib-game-meta">${formatBytes(game.size, 1)}</span>
          </div>
          <div class="lib-game-actions">
            <button class="btn-lib-play" title="${emuInfo.app}" data-filename="${game.filename}" data-system="${game.system}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
              Play
            </button>
            <button class="btn-lib-delete" title="Delete file" data-filename="${game.filename}" data-system="${game.system}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg>
            </button>
          </div>
        `;

        row.querySelector(".btn-lib-play").addEventListener("click", (e) => {
          const btn = e.currentTarget;
          const origHTML = btn.innerHTML;
          btn.disabled = true;
          btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle></svg> Launching...`;

          setRecentGame(game.filename, game.system);

          fetch(`/api/import-game?filename=${encodeURIComponent(game.filename)}&system=${encodeURIComponent(game.system)}`)
            .then(res => res.json())
            .then(data => {
              btn.disabled = false;
              btn.innerHTML = origHTML;
              if (data.error) showToast(`Launch error: ${data.error}`, "error");
              else showToast(`Launched in ${emuInfo.app}!`, "success");
            })
            .catch(() => {
              btn.disabled = false;
              btn.innerHTML = origHTML;
              showToast("Launch failed", "error");
            });
        });

        row.querySelector(".btn-lib-delete").addEventListener("click", () => {
          if (!confirm(`Delete "${niceTitle}"?`)) return;
          fetch(`/api/delete-game?filename=${encodeURIComponent(game.filename)}&system=${encodeURIComponent(game.system)}`)
            .then(res => res.json())
            .then(data => {
              if (data.success) {
                libraryData = libraryData.filter(g => !(g.filename === game.filename && g.system === game.system));
                row.style.opacity = "0";
                setTimeout(() => { row.remove(); renderLibrary(); }, 250);
                showToast("Deleted.", "info");
                // Clear recent game if deleted
                if (recentGame && recentGame.filename === game.filename) {
                  localStorage.removeItem("recent-game");
                  recentGame = null;
                  updateRecentGameTile();
                }
                updateHomeStats();
              } else {
                showToast("Delete failed: " + (data.error || "unknown"), "error");
              }
            });
        });

        libraryContainer.appendChild(row);
      });
    });
  }

  // ── Home Slide Widget Updaters ─────────────────────────────────────────────
  function updateHomeStats() {
    if (statsLibCount) {
      statsLibCount.textContent = `${libraryData.length} Game${libraryData.length === 1 ? "" : "s"}`;
    }
    if (statsLibSize) {
      const totalSize = libraryData.reduce((acc, g) => acc + (g.size || 0), 0);
      statsLibSize.textContent = formatBytes(totalSize, 1);
    }
  }

  function setRecentGame(filename, system) {
    recentGame = { filename, system, timestamp: Date.now() };
    localStorage.setItem("recent-game", JSON.stringify(recentGame));
    updateRecentGameTile();
  }

  function updateRecentGameTile() {
    if (!recentGameTitle || !recentGameTag || !recentGameMeta) return;

    if (recentGame) {
      const niceTitle = cleanGameTitle(recentGame.filename);
      recentGameTag.textContent = "QUICK RESUME";
      recentGameTitle.textContent = niceTitle;
      recentGameMeta.textContent = `System: ${systemDisplayName(recentGame.system)}`;
    } else {
      recentGameTag.textContent = "WELCOME TO AURA";
      recentGameTitle.textContent = "Select a game to start playing";
      recentGameMeta.textContent = "Browse the catalog to download new games or play existing ones.";
    }
  }

  // Launch recent game when clicking hero tile
  if (recentGameTile) {
    recentGameTile.addEventListener("click", (e) => {
      // Don't trigger if they clicked the child Go to Library button
      if (e.target.id === "btn-library") return;

      if (recentGame) {
        showToast(`Launching ${cleanGameTitle(recentGame.filename)}...`, "info");
        fetch(`/api/import-game?filename=${encodeURIComponent(recentGame.filename)}&system=${encodeURIComponent(recentGame.system)}`)
          .then(res => res.json())
          .then(data => {
            if (data.error) showToast(`Launch error: ${data.error}`, "error");
          })
          .catch(err => console.error("Error launching game:", err));
      } else {
        // Slide to Store to browse games
        goToSlide(1);
      }
    });
  }

  function systemDisplayName(sys) {
    const names = {
      nes: "NES", snes: "SNES", gba: "Game Boy Advance", gbc: "Game Boy Color",
      gb: "Game Boy", n64: "Nintendo 64", genesis: "Sega Genesis", gamegear: "Game Gear",
      sms: "Master System", pcengine: "PC Engine / TG16", sega32x: "Sega 32X",
      atari2600: "Atari 2600", nds: "Nintendo DS", psx: "PlayStation",
      saturn: "Sega Saturn", psp: "PSP", segacd: "Sega CD", atari7800: "Atari 7800",
      lynx: "Atari Lynx", vb: "Virtual Boy", wonderswan: "WonderSwan",
      "wonderswan-color": "WonderSwan Color", colecovision: "ColecoVision",
      intellivision: "Intellivision", vectrex: "Vectrex", odyssey2: "Odyssey²",
      sg1000: "SG-1000", ngp: "Neo Geo Pocket", ngpc: "Neo Geo Pocket Color",
      xbox360: "Xbox 360",
    };
    return names[sys] || sys.toUpperCase();
  }

  // ── Toast notifications ────────────────────────────────────────────────────
  function showToast(msg, type = "info") {
    const t = document.createElement("div");
    t.className = `toast toast-${type}`;
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add("show"));
    setTimeout(() => {
      t.classList.remove("show");
      setTimeout(() => t.remove(), 350);
    }, 3000);
  }

  // ── Utilities ──────────────────────────────────────────────────────────────
  function formatBytes(bytes, decimals = 2) {
    if (!bytes || bytes === 0) return "0 B";
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
  }

  function cleanGameTitle(filename) {
    const base = filename.split("/").pop() || filename;
    let name = base.substring(0, base.lastIndexOf(".")) || base;
    name = name.replace(/\s*\(.*?\)/g, "").replace(/\s*\[.*?\]/g, "");
    return name.trim();
  }

  // ── Download ───────────────────────────────────────────────────────────────
  function startRomDownload(filename, buttonElement, cardElement, system) {
    buttonElement.disabled = true;
    buttonElement.innerHTML = `
      <div class="spinner" style="width:14px;height:14px;border-width:2px;margin-right:0;"></div>
      Queuing...
    `;

    fetch(`/api/download?system=${system}&filename=${encodeURIComponent(filename)}`)
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          alert(`Download error: ${data.error}`);
          resetDownloadButton(buttonElement);
          return;
        }
        const downloadId = data.download_id;
        createDownloadProgressCard(downloadId, filename);
        // Switch to downloads slide (Slide index 3)
        goToSlide(3);
        pollDownloadProgress(downloadId, cardElement, system);
      })
      .catch(err => {
        console.error("Download trigger failed:", err);
        alert("Failed to start download. Check python server.");
        resetDownloadButton(buttonElement);
      });
  }

  function resetDownloadButton(button) {
    button.disabled = false;
    button.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
      Download
    `;
  }

  // ── Progress Card ──────────────────────────────────────────────────────────
  function createDownloadProgressCard(id, filename) {
    const noDownloads = downloadsContainer.querySelector(".no-downloads");
    if (noDownloads) noDownloads.remove();

    const card = document.createElement("div");
    card.className = "download-progress-card";
    card.id = `progress-${id}`;
    const niceTitle = cleanGameTitle(filename);
    card.innerHTML = `
      <div class="progress-header">
        <span class="progress-title" title="${filename}">${niceTitle}</span>
        <span class="progress-pct" id="pct-${id}">0%</span>
      </div>
      <div class="progress-bar-bg">
        <div class="progress-bar-fill" id="fill-${id}"></div>
      </div>
      <div class="progress-footer">
        <span class="status-label" id="status-label-${id}">Connecting...</span>
        <span id="bytes-label-${id}">0 / 0 KB</span>
      </div>
    `;
    downloadsContainer.appendChild(card);
  }

  // ── Progress Polling ───────────────────────────────────────────────────────
  function pollDownloadProgress(id, cardElement, system) {
    const fill        = document.getElementById(`fill-${id}`);
    const pctText     = document.getElementById(`pct-${id}`);
    const statusLabel = document.getElementById(`status-label-${id}`);
    const bytesLabel  = document.getElementById(`bytes-label-${id}`);
    const emuInfo     = getEmulatorInfo(system);

    const intervalId = setInterval(() => {
      fetch(`/api/progress?id=${id}`)
        .then(res => res.json())
        .then(data => {
          if (data.error) {
            clearInterval(intervalId);
            handleDownloadError(id, data.error);
            return;
          }
          const { filename, status, bytes_written: written, total_size: total } = data;

          if (status === "downloading" && total > 0) {
            const pct = Math.round((written / total) * 100);
            fill.style.width = `${pct}%`;
            pctText.textContent = `${pct}%`;
            statusLabel.textContent = "Downloading...";
            bytesLabel.textContent = `${formatBytes(written, 1)} / ${formatBytes(total, 1)}`;
          } else if (status === "extracting") {
            fill.style.width = "100%";
            pctText.textContent = "Extracting...";
            statusLabel.textContent = "Extracting...";
            bytesLabel.textContent = "Unpacking files...";
          } else if (status === "completed") {
            clearInterval(intervalId);
            delete activePollers[id];

            fill.style.width = "100%";
            pctText.textContent = "100%";
            bytesLabel.textContent = formatBytes(written, 1);

            // Mark downloaded
            if (!downloadedRoms.includes(filename)) {
              downloadedRoms.push(filename);
              localStorage.setItem("downloaded-roms", JSON.stringify(downloadedRoms));
            }

            // Update card element in search grid
            if (cardElement && cardElement.dataset.filename === filename) {
              cardElement.classList.add("downloaded");
              const btn = cardElement.querySelector(".btn-download");
              btn.disabled = false;
              btn.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                ${emuInfo.label}
              `;
            }

            // Build completed footer with Play + Reveal in Library
            const progressCard = document.getElementById(`progress-${id}`);
            const progressFooter = progressCard.querySelector(".progress-footer");
            progressFooter.innerHTML = "";

            const statusCompleted = document.createElement("span");
            statusCompleted.className = "status-label completed";
            statusCompleted.textContent = "Finished";
            progressFooter.appendChild(statusCompleted);

            const btnGroup = document.createElement("div");
            btnGroup.style.display = "flex";
            btnGroup.style.gap = "6px";

            const playBtn = document.createElement("button");
            playBtn.className = "btn-mini";
            playBtn.style.borderColor = "var(--color-success)";
            playBtn.style.color = "var(--color-success)";
            playBtn.innerHTML = `▶ ${emuInfo.app}`;
            playBtn.addEventListener("click", () => {
              setRecentGame(filename, system);
              fetch(`/api/import-game?filename=${encodeURIComponent(filename)}&system=${encodeURIComponent(system)}`)
                .then(res => res.json())
                .then(d => { if (d.error) showToast(d.error, "error"); });
            });

            const libBtn = document.createElement("button");
            libBtn.className = "btn-mini";
            libBtn.textContent = "Library";
            libBtn.addEventListener("click", () => {
              goToSlide(2);
            });

            btnGroup.appendChild(playBtn);
            btnGroup.appendChild(libBtn);
            progressFooter.appendChild(btnGroup);

            // Trigger library stats refresh
            loadLibrary();

            showToast(`Downloaded! Playing in ${emuInfo.app}.`, "success");

          } else if (status === "error") {
            clearInterval(intervalId);
            delete activePollers[id];
            handleDownloadError(id, data.error || "Unknown error");
          }
        })
        .catch(err => console.error("Polling failed:", err));
    }, 500);

    activePollers[id] = intervalId;
  }

  function handleDownloadError(id, errorText) {
    const fill        = document.getElementById(`fill-${id}`);
    const pctText     = document.getElementById(`pct-${id}`);
    const statusLabel = document.getElementById(`status-label-${id}`);
    if (fill) fill.style.background = "#ef4444";
    if (pctText) pctText.textContent = "Error";
    if (statusLabel) {
      statusLabel.textContent = "Failed";
      statusLabel.className = "status-label error";
      statusLabel.title = errorText;
    }
    showToast("Download failed: " + errorText, "error");
  }

  // ── Play ROM ───────────────────────────────────────────────────────────────
  function playRom(filename, buttonElement, system) {
    const originalHTML = buttonElement.innerHTML;
    buttonElement.disabled = true;
    buttonElement.innerHTML = `
      <div class="spinner" style="width:14px;height:14px;border-width:2px;margin-right:0;"></div>
      Launching...
    `;

    setRecentGame(filename, system);

    fetch(`/api/import-game?filename=${encodeURIComponent(filename)}&system=${encodeURIComponent(system)}`)
      .then(res => res.json())
      .then(data => {
        buttonElement.disabled = false;
        buttonElement.innerHTML = originalHTML;
        if (data.error) showToast(`Launch error: ${data.error}`, "error");
        else showToast(`Launched in ${getEmulatorInfo(system).app}!`, "success");
      })
      .catch(err => {
        console.error("Launch failed:", err);
        buttonElement.disabled = false;
        buttonElement.innerHTML = originalHTML;
      });
  }

  // ── Drag & Drop Upload ────────────────────────────────────────────────────
  const extensionToSystem = {
    ".nes": "nes", ".sfc": "snes", ".smc": "snes",
    ".gba": "gba", ".gbc": "gbc", ".gb": "gb",
    ".z64": "n64", ".n64": "n64",
    ".nds": "nds",
    ".iso": "psp", ".cso": "psp",
    ".bin": "psx", ".cue": "psx", ".chd": "psx",
    ".a78": "atari7800", ".lnx": "lynx", ".vb": "vb",
    ".ws": "wonderswan", ".wsc": "wonderswan-color",
    ".col": "colecovision", ".rom": "colecovision",
    ".int": "intellivision", ".vec": "vectrex",
    ".sg": "sg1000", ".ngp": "ngp", ".ngc": "ngpc",
    ".xex": "xbox360",
  };

  // ── Manual Import and Open Downloads Folder ────────────────────────────────
  const btnOpenDownloads = document.getElementById("btn-open-downloads");
  const inputImportRom   = document.getElementById("input-import-rom");

  if (btnOpenDownloads) {
    btnOpenDownloads.addEventListener("click", () => {
      fetch("/api/open-downloads")
        .then(res => res.json())
        .then(data => {
          if (data.error) showToast("Error: " + data.error, "error");
        })
        .catch(() => showToast("Failed to open downloads folder", "error"));
    });
  }

  if (inputImportRom) {
    inputImportRom.addEventListener("change", e => {
      Array.from(e.target.files).forEach(file => {
        const ext = file.name.includes(".") ? file.name.substring(file.name.lastIndexOf(".")).toLowerCase() : "";
        let targetSystem = extensionToSystem[ext] || activeSystem;
        // Large ISOs (> 2GB) are typically Xbox 360, not PSP
        if (ext === ".iso" && file.size > 2 * 1024 * 1024 * 1024) {
          targetSystem = "xbox360";
        }
        uploadFile(file, targetSystem);
      });
      inputImportRom.value = "";
    });
  }

  const dragOverlay    = document.getElementById("drag-overlay");
  const dragOverlaySub = document.getElementById("drag-overlay-sub");
  let dragCounter = 0;

  window.addEventListener("dragenter", e => {
    e.preventDefault();
    dragCounter++;
    if (dragCounter === 1) {
      dragOverlay.style.display = "flex";
      setTimeout(() => dragOverlay.classList.add("active"), 10);
      const systemTab = document.querySelector(`.console-tab[data-system="${activeSystem}"]`);
      const systemName = systemTab ? systemTab.querySelector(".console-name").textContent : "Active Console";
      dragOverlaySub.textContent = `File will be imported into ${systemName}`;
    }
  });
  window.addEventListener("dragover", e => e.preventDefault());
  window.addEventListener("dragleave", e => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter === 0) {
      dragOverlay.classList.remove("active");
      setTimeout(() => { if (dragCounter === 0) dragOverlay.style.display = "none"; }, 250);
    }
  });
  window.addEventListener("drop", e => {
    e.preventDefault();
    dragCounter = 0;
    dragOverlay.classList.remove("active");
    dragOverlay.style.display = "none";
    Array.from(e.dataTransfer.files).forEach(file => {
      const ext = file.name.includes(".") ? file.name.substring(file.name.lastIndexOf(".")).toLowerCase() : "";
      let targetSystem = extensionToSystem[ext] || activeSystem;
      // Large ISOs (> 2GB) are typically Xbox 360, not PSP
      if (ext === ".iso" && file.size > 2 * 1024 * 1024 * 1024) {
        targetSystem = "xbox360";
      }
      uploadFile(file, targetSystem);
    });
  });

  function createUploadProgressCard(id, filename) {
    const noDownloads = downloadsContainer.querySelector(".no-downloads");
    if (noDownloads) noDownloads.remove();
    const card = document.createElement("div");
    card.className = "download-progress-card";
    card.id = `progress-${id}`;
    const niceTitle = cleanGameTitle(filename);
    card.innerHTML = `
      <div class="progress-header">
        <span class="progress-title" title="${filename}">[Import] ${niceTitle}</span>
        <span class="progress-pct" id="pct-${id}">0%</span>
      </div>
      <div class="progress-bar-bg">
        <div class="progress-bar-fill" id="fill-${id}"></div>
      </div>
      <div class="progress-footer">
        <span class="status-label" id="status-label-${id}">Uploading...</span>
        <span id="bytes-label-${id}">0 / 0 KB</span>
      </div>
    `;
    downloadsContainer.appendChild(card);
    goToSlide(3);
  }

  function uploadFile(file, system) {
    const uploadId = "upload-" + Math.random().toString(36).substring(2, 9);
    createUploadProgressCard(uploadId, file.name);

    const fill        = document.getElementById(`fill-${uploadId}`);
    const pctText     = document.getElementById(`pct-${uploadId}`);
    const statusLabel = document.getElementById(`status-label-${uploadId}`);
    const bytesLabel  = document.getElementById(`bytes-label-${uploadId}`);
    const emuInfo     = getEmulatorInfo(system);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/upload?system=${system}&filename=${encodeURIComponent(file.name)}`, true);

    xhr.upload.onprogress = e => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        fill.style.width = `${pct}%`;
        pctText.textContent = `${pct}%`;
        bytesLabel.textContent = `${formatBytes(e.loaded, 1)} / ${formatBytes(e.total, 1)}`;
      }
    };

    xhr.onload = () => {
      if (xhr.status === 200) {
        fill.style.width = "100%";
        pctText.textContent = "100%";
        statusLabel.textContent = "Importing...";
        statusLabel.className = "status-label completed";

        if (!downloadedRoms.includes(file.name)) {
          downloadedRoms.push(file.name);
          localStorage.setItem("downloaded-roms", JSON.stringify(downloadedRoms));
        }

        fetch(`/api/import-game?filename=${encodeURIComponent(file.name)}&system=${encodeURIComponent(system)}`)
          .then(res => res.json())
          .then(resData => {
            if (resData.error) {
              handleDownloadError(uploadId, resData.error);
            } else {
              statusLabel.textContent = "Launched!";
              showToast(`Launched in ${emuInfo.app}!`, "success");
              setRecentGame(file.name, system);
              loadLibrary();
            }
          })
          .catch(err => handleDownloadError(uploadId, err.message || "Failed"));
      } else {
        let errMsg = "Upload failed";
        try { errMsg = JSON.parse(xhr.responseText).error || errMsg; } catch(e) {}
        handleDownloadError(uploadId, errMsg);
      }
    };

    xhr.onerror = () => handleDownloadError(uploadId, "Connection error");
    xhr.send(file);
  }

  // ── Emulator Installers ───────────────────────────────────────────────────
  function checkEmulators() {
    fetch("/api/check-emulators")
      .then(res => res.json())
      .then(status => {
        // NDS (melonDS)
        const ndsContainer = document.getElementById("melonds-install-container");
        if (ndsContainer) {
          if (status.nds) ndsContainer.innerHTML = "";
          else checkEmuInstallStatus("melonds", ndsContainer);
        }

        // PSP (PPSSPP)
        const pspContainer = document.getElementById("ppsspp-install-container");
        if (pspContainer) {
          if (status.psp) pspContainer.innerHTML = "";
          else checkEmuInstallStatus("ppsspp", pspContainer);
        }

        // Xbox 360 (XeniOS/Xenia)
        const xboxContainer = document.getElementById("xenia-install-container");
        if (xboxContainer) {
          if (status.xbox360) xboxContainer.innerHTML = "";
          else checkEmuInstallStatus("xenia", xboxContainer);
        }
      })
      .catch(err => console.error("Error checking emulators:", err));
  }

  function checkEmuInstallStatus(emuKey, container) {
    const installId = `${emuKey}-install`;
    fetch(`/api/progress?id=${installId}`)
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          renderEmuInstallButton(emuKey, container);
        } else if (data.status && data.status !== "completed") {
          renderEmuInstallingState(emuKey, container);
          pollEmuInstallationProgress(emuKey, container);
        } else if (data.status === "completed") {
          container.innerHTML = "";
        } else {
          renderEmuInstallButton(emuKey, container);
        }
      })
      .catch(() => {
        renderEmuInstallButton(emuKey, container);
      });
  }

  function renderEmuInstallButton(emuKey, container) {
    const emuName = emuKey === "xenia" ? "XeniOS" : emuKey === "melonds" ? "melonDS" : "PPSSPP";
    container.innerHTML = `
      <button class="install-emu-btn">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
        Download & Install ${emuName}
      </button>
    `;
    
    const btn = container.querySelector(".install-emu-btn");
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      startEmuInstallation(emuKey, container);
    });
  }

  function renderEmuInstallingState(emuKey, container) {
    const emuName = emuKey === "xenia" ? "XeniOS" : emuKey === "melonds" ? "melonDS" : "PPSSPP";
    container.innerHTML = `
      <div class="install-emu-progress">
        <div class="install-emu-progress-header">
          <span>${emuName} Installer</span>
          <span id="${emuKey}-install-pct">0%</span>
        </div>
        <div class="install-emu-progress-bar-bg">
          <div class="install-emu-progress-bar-fill" id="${emuKey}-install-fill"></div>
        </div>
        <div class="install-emu-progress-footer">
          <span id="${emuKey}-install-status">Downloading...</span>
          <span id="${emuKey}-install-bytes">0 / 0 MB</span>
        </div>
      </div>
    `;
  }

  function startEmuInstallation(emuKey, container) {
    const emuName = emuKey === "xenia" ? "XeniOS" : emuKey === "melonds" ? "melonDS" : "PPSSPP";
    showToast(`Starting ${emuName} installation...`, "info");
    renderEmuInstallingState(emuKey, container);
    
    fetch(`/api/install-${emuKey}`)
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          pollEmuInstallationProgress(emuKey, container);
        } else {
          showToast(`Failed to start installation: ${data.error || "unknown"}`, "error");
          checkEmuInstallStatus(emuKey, container);
        }
      })
      .catch(err => {
        console.error(`Error starting ${emuName} install:`, err);
        showToast("Error initiating installation", "error");
        checkEmuInstallStatus(emuKey, container);
      });
  }

  function pollEmuInstallationProgress(emuKey, container) {
    const fill = document.getElementById(`${emuKey}-install-fill`);
    if (!fill) {
      renderEmuInstallingState(emuKey, container);
    }
    
    const installId = `${emuKey}-install`;
    const emuName = emuKey === "xenia" ? "XeniOS" : emuKey === "melonds" ? "melonDS" : "PPSSPP";
    const archiveType = emuKey === "melonds" ? "ZIP" : "DMG";

    const intervalId = setInterval(() => {
      fetch(`/api/progress?id=${installId}`)
        .then(res => res.json())
        .then(data => {
          if (data.error) {
            clearInterval(intervalId);
            if (data.error === "Invalid download ID") {
              checkEmuInstallStatus(emuKey, container);
            } else {
              handleEmuInstallError(emuKey, container, data.error);
            }
            return;
          }
          
          const { status, bytes_written: written, total_size: total } = data;
          
          const curFill = document.getElementById(`${emuKey}-install-fill`);
          const curPctText = document.getElementById(`${emuKey}-install-pct`);
          const curStatusText = document.getElementById(`${emuKey}-install-status`);
          const curBytesText = document.getElementById(`${emuKey}-install-bytes`);
          
          if (status === "downloading") {
            const pct = total > 0 ? Math.round((written / total) * 100) : 0;
            if (curFill) curFill.style.width = `${pct}%`;
            if (curPctText) curPctText.textContent = `${pct}%`;
            if (curStatusText) curStatusText.textContent = `Downloading ${archiveType}...`;
            if (curBytesText) curBytesText.textContent = `${formatBytes(written, 1)} / ${formatBytes(total, 1)}`;
          } else if (status === "mounting") {
            if (curFill) curFill.style.width = "100%";
            if (curPctText) curPctText.textContent = "90%";
            if (curStatusText) curStatusText.textContent = "Mounting DMG...";
            if (curBytesText) curBytesText.textContent = "hdiutil attach";
          } else if (status === "extracting") {
            if (curFill) curFill.style.width = "100%";
            if (curPctText) curPctText.textContent = "95%";
            if (curStatusText) curStatusText.textContent = "Extracting app...";
            if (curBytesText) curBytesText.textContent = "Unzipping files";
          } else if (status === "copying") {
            if (curFill) curFill.style.width = "100%";
            if (curPctText) curPctText.textContent = "95%";
            if (curStatusText) curStatusText.textContent = `Copying ${emuName}.app...`;
            if (curBytesText) curBytesText.textContent = "Writing to workspace";
          } else if (status === "unmounting") {
            if (curFill) curFill.style.width = "100%";
            if (curPctText) curPctText.textContent = "98%";
            if (curStatusText) curStatusText.textContent = "Cleaning up...";
            if (curBytesText) curBytesText.textContent = "hdiutil detach";
          } else if (status === "completed") {
            clearInterval(intervalId);
            showToast(`${emuName} installed successfully!`, "success");
            if (container) {
              container.innerHTML = "";
            }
            checkEmulators();
          } else if (status === "error") {
            clearInterval(intervalId);
            handleEmuInstallError(emuKey, container, data.error || "Installation failed");
          }
        })
        .catch(err => {
          console.error(`${emuName} install progress polling failed:`, err);
        });
    }, 1000);
  }
  
  function handleEmuInstallError(emuKey, container, errorMsg) {
    const emuName = emuKey === "xenia" ? "XeniOS" : emuKey === "melonds" ? "melonDS" : "PPSSPP";
    showToast(`${emuName} Installation failed: ${errorMsg}`, "error");
    if (container) {
      container.innerHTML = `
        <div style="color: var(--color-error); font-size: 11px; margin-top: 8px; text-align: center;">
          Installation failed: ${errorMsg}
          <button class="install-emu-btn" style="background: rgba(239, 68, 68, 0.1); border-color: var(--color-error); color: var(--color-error);">
            Retry Installation
          </button>
        </div>
      `;
      const retryBtn = container.querySelector(".install-emu-btn");
      if (retryBtn) {
        retryBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          startEmuInstallation(emuKey, container);
        });
      }
    }
  }

  // ── Boot ───────────────────────────────────────────────────────────────────
  updateRecentGameTile();
  performSearch();
  loadLibrary();
  checkEmulators();
  initCompatLab();
});

/* ==========================================================================
   COMPAT LAB MODULE
   ========================================================================== */

(function initCompatLab() {
  // ── State ──────────────────────────────────────────────────────────────────
  let compatDB = { version: "1.0.0", games: {}, known_flags: {} };
  let selectedGameKey = null;  // currently selected game in the list
  let currentFlags = {};       // working copy of flags in the editor

  // ── Elements ───────────────────────────────────────────────────────────────
  const gameListEl    = document.getElementById("compat-game-list");
  const emptyEl       = document.getElementById("compat-empty");
  const editorEl      = document.getElementById("compat-editor");
  const editorEmptyEl = document.getElementById("compat-editor-empty");
  const searchEl      = document.getElementById("compat-search");
  const titleEl       = document.getElementById("compat-edit-title");
  const systemEl      = document.getElementById("compat-edit-system");
  const statusEl      = document.getElementById("compat-edit-status");
  const flagsListEl   = document.getElementById("compat-flags-list");
  const notesEl       = document.getElementById("compat-edit-notes");
  const knownListEl   = document.getElementById("compat-known-flags-list");
  const countBadge    = document.getElementById("compat-count-badge");

  // ── Load DB from server ────────────────────────────────────────────────────
  async function loadCompatDB() {
    try {
      const res = await fetch("/api/compat-db");
      compatDB = await res.json();
    } catch(e) {
      compatDB = { version: "1.0.0", games: {}, known_flags: {} };
    }
    updateCountBadge();
    renderCompatList();
    renderKnownFlags();
  }

  function updateCountBadge() {
    const count = Object.keys(compatDB.games || {}).length;
    if (count > 0) {
      countBadge.textContent = count;
      countBadge.style.display = "inline";
    } else {
      countBadge.style.display = "none";
    }
  }

  // ── Render game list (left column) ────────────────────────────────────────
  window.renderCompatList = function() {
    const query = searchEl ? searchEl.value.toLowerCase() : "";
    const games = compatDB.games || {};
    const keys = Object.keys(games).filter(k =>
      !query || k.toLowerCase().includes(query) ||
      (games[k].title||k).toLowerCase().includes(query)
    );

    // Remove old cards (keep empty state div)
    gameListEl.querySelectorAll(".compat-game-card").forEach(el => el.remove());

    if (keys.length === 0) {
      emptyEl.style.display = "flex";
      return;
    }
    emptyEl.style.display = "none";

    keys.sort().forEach(key => {
      const entry = games[key];
      const status = entry.status || "untested";
      const flagCount = Object.keys(entry.flags || {}).length;
      const card = document.createElement("div");
      card.className = "compat-game-card" + (key === selectedGameKey ? " selected" : "");
      card.dataset.key = key;
      card.innerHTML = `
        <div class="compat-status-dot ${status}"></div>
        <div class="compat-card-info">
          <div class="compat-card-name">${entry.title || key}</div>
          <div class="compat-card-sys">${entry.system || ""}</div>
        </div>
        ${flagCount > 0 ? `<div class="compat-card-flags">${flagCount} flag${flagCount !== 1 ? 's' : ''}</div>` : ""}
      `;
      card.addEventListener("click", () => selectGame(key));
      gameListEl.appendChild(card);
    });
  };

  // ── Select a game → open editor ───────────────────────────────────────────
  function selectGame(key) {
    selectedGameKey = key;
    const entry = (compatDB.games || {})[key] || {};
    currentFlags = JSON.parse(JSON.stringify(entry.flags || {}));

    titleEl.value  = entry.title || key;
    systemEl.value = entry.system || "xbox360";
    statusEl.value = entry.status || "untested";
    notesEl.value  = entry.notes || "";

    editorEmptyEl.style.display = "none";
    editorEl.style.display = "flex";

    renderFlagRows();
    renderCompatList(); // re-highlight selected
    updateKnownFlagsVisibility();
  }

  // ── Flag rows renderer ────────────────────────────────────────────────────
  function renderFlagRows() {
    flagsListEl.innerHTML = "";
    Object.entries(currentFlags).forEach(([flag, val]) => {
      addFlagRow(flag, val);
    });
  }

  function addFlagRow(flag = "", val = true) {
    const row = document.createElement("div");
    row.className = "compat-flag-row";

    const isBool = (val === true || val === false);
    const displayVal = isBool ? (val ? "true" : "false") : String(val);
    const typeLabel = isBool ? "bool" : (Number.isInteger(val) ? "int" : "str");

    row.innerHTML = `
      <input class="compat-flag-key" type="text" placeholder="--flag" value="${flag}">
      <input class="compat-flag-val" type="text" placeholder="true" value="${displayVal}">
      <span class="compat-flag-type">${typeLabel}</span>
      <button class="compat-flag-remove" title="Remove flag">✕</button>
    `;

    const keyIn = row.querySelector(".compat-flag-key");
    const valIn = row.querySelector(".compat-flag-val");
    const removeBtn = row.querySelector(".compat-flag-remove");

    // Update currentFlags on edit
    const syncFlags = () => {
      const oldKey = flag;
      const newKey = keyIn.value.trim();
      const rawVal = valIn.value.trim();
      let parsed;
      if (rawVal === "true")  parsed = true;
      else if (rawVal === "false") parsed = false;
      else if (!isNaN(rawVal) && rawVal !== "") parsed = Number(rawVal);
      else parsed = rawVal;
      delete currentFlags[oldKey];
      if (newKey) currentFlags[newKey] = parsed;
      flag = newKey;
      // update type label
      row.querySelector(".compat-flag-type").textContent =
        (parsed === true || parsed === false) ? "bool" :
        Number.isInteger(parsed) ? "int" : "str";
    };
    keyIn.addEventListener("blur", syncFlags);
    valIn.addEventListener("blur", syncFlags);

    removeBtn.addEventListener("click", () => {
      delete currentFlags[flag];
      row.remove();
    });

    flagsListEl.appendChild(row);
  }

  // ── Known flags picker ────────────────────────────────────────────────────
  function renderKnownFlags() {
    if (!knownListEl) return;
    const flags = (compatDB.known_flags || {}).xbox360 || [];
    knownListEl.innerHTML = "";
    flags.forEach(f => {
      const chip = document.createElement("button");
      chip.className = "compat-known-chip";
      chip.innerHTML = `${f.flag}<span class="chip-desc">${f.description}</span>`;
      chip.addEventListener("click", () => {
        // Don't add duplicate keys
        if (currentFlags.hasOwnProperty(f.flag)) {
          showToast(`${f.flag} is already in the list`);
          return;
        }
        const defaultVal = f.default !== undefined ? f.default :
          (f.type === "boolean" ? true : f.type === "integer" ? 0 : "");
        currentFlags[f.flag] = defaultVal;
        addFlagRow(f.flag, defaultVal);
        showToast(`Added ${f.flag}`);
      });
      knownListEl.appendChild(chip);
    });
  }

  function updateKnownFlagsVisibility() {
    const wrap = document.getElementById("compat-known-flags-wrap");
    if (wrap) wrap.style.display = systemEl.value === "xbox360" ? "flex" : "none";
  }
  if (systemEl) systemEl.addEventListener("change", updateKnownFlagsVisibility);

  // ── Save ─────────────────────────────────────────────────────────────────
  document.getElementById("btn-compat-save")?.addEventListener("click", async () => {
    // Sync any still-dirty flag rows before saving
    flagsListEl.querySelectorAll(".compat-flag-row").forEach(row => {
      const k = row.querySelector(".compat-flag-key").value.trim();
      const rv = row.querySelector(".compat-flag-val").value.trim();
      if (!k) return;
      let parsed;
      if (rv === "true")  parsed = true;
      else if (rv === "false") parsed = false;
      else if (!isNaN(rv) && rv !== "") parsed = Number(rv);
      else parsed = rv;
      currentFlags[k] = parsed;
    });

    const newKey = titleEl.value.trim();
    if (!newKey) { showToast("Please enter a game title"); return; }

    const body = {
      game_key: newKey,
      title:    newKey,
      system:   systemEl.value,
      status:   statusEl.value,
      flags:    currentFlags,
      notes:    notesEl.value.trim(),
    };

    try {
      const res = await fetch("/api/compat-patch", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        // Update local DB
        if (selectedGameKey && selectedGameKey !== newKey) {
          delete compatDB.games[selectedGameKey];
        }
        compatDB.games[newKey] = body;
        selectedGameKey = newKey;
        updateCountBadge();
        renderCompatList();
        showToast("✅ Patch saved!");
      } else {
        showToast("❌ Save failed: " + (data.error || "unknown"));
      }
    } catch(e) {
      showToast("❌ Network error");
    }
  });

  // ── Delete ───────────────────────────────────────────────────────────────
  document.getElementById("btn-compat-delete")?.addEventListener("click", async () => {
    if (!selectedGameKey) return;
    if (!confirm(`Delete patch for "${selectedGameKey}"?`)) return;
    try {
      const res = await fetch("/api/compat-delete", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ game_key: selectedGameKey }),
      });
      const data = await res.json();
      if (data.success) {
        delete compatDB.games[selectedGameKey];
        selectedGameKey = null;
        editorEl.style.display = "none";
        editorEmptyEl.style.display = "flex";
        updateCountBadge();
        renderCompatList();
        showToast("🗑 Patch deleted");
      }
    } catch(e) { showToast("❌ Network error"); }
  });

  // ── New Patch ─────────────────────────────────────────────────────────────
  document.getElementById("btn-compat-new")?.addEventListener("click", () => {
    selectedGameKey = null;
    currentFlags = {};
    titleEl.value  = "";
    systemEl.value = "xbox360";
    statusEl.value = "untested";
    notesEl.value  = "";
    flagsListEl.innerHTML = "";
    editorEmptyEl.style.display = "none";
    editorEl.style.display = "flex";
    titleEl.focus();
    updateKnownFlagsVisibility();
  });

  // ── Add Flag button ───────────────────────────────────────────────────────
  document.getElementById("btn-add-flag")?.addEventListener("click", () => {
    addFlagRow("", true);
    const last = flagsListEl.lastElementChild;
    if (last) last.querySelector(".compat-flag-key")?.focus();
  });

  // ── Copy JSON ─────────────────────────────────────────────────────────────
  document.getElementById("btn-compat-copy")?.addEventListener("click", () => {
    if (!selectedGameKey) return;
    const entry = compatDB.games[selectedGameKey];
    const text = JSON.stringify({ [selectedGameKey]: entry }, null, 2);
    navigator.clipboard.writeText(text).then(() => showToast("📋 Copied to clipboard!"));
  });

  // ── Export DB ─────────────────────────────────────────────────────────────
  document.getElementById("btn-compat-export")?.addEventListener("click", async () => {
    try {
      const res  = await fetch("/api/compat-export");
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = "compat_db.json";
      a.click();
      URL.revokeObjectURL(url);
      showToast("⬇ Export started");
    } catch(e) { showToast("❌ Export failed"); }
  });

  // ── Import DB ─────────────────────────────────────────────────────────────
  document.getElementById("compat-import-file")?.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const incoming = JSON.parse(text);
      const res = await fetch("/api/compat-import", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    text,
      });
      const data = await res.json();
      if (data.success) {
        showToast(`⬆ Imported ${data.merged} new patch${data.merged !== 1 ? 'es' : ''}`);
        await loadCompatDB();
      } else {
        showToast("❌ Import failed: " + (data.error || "unknown"));
      }
    } catch(e) { showToast("❌ Invalid JSON file"); }
    e.target.value = "";
  });

  // ── Search filter ─────────────────────────────────────────────────────────
  if (searchEl) searchEl.addEventListener("input", renderCompatList);

  // ── Toast helper ─────────────────────────────────────────────────────────
  function showToast(msg) {
    const existing = document.querySelector(".compat-toast");
    if (existing) existing.remove();
    const toast = document.createElement("div");
    toast.className = "compat-toast";
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  // ── Aura AI Agent Logic ───────────────────────────────────────────────────
  let aiPollingInterval = null;
  let lastLogCount = 0;

  function initAiAgentTab() {
    const providerSelect = document.getElementById("ai-provider");
    const keyGroup = document.getElementById("ai-group-key");
    const portGroup = document.getElementById("ai-group-ollama-port");
    const modelInput = document.getElementById("ai-model");
    const modelHelp = document.getElementById("ai-model-help");

    function updateFields() {
      const provider = providerSelect.value;
      if (provider === "ollama") {
        keyGroup.style.display = "none";
        portGroup.style.display = "flex";
        modelInput.value = "qwen2.5:7b";
        modelHelp.textContent = "For local Ollama, ensure this model is downloaded (e.g. run `ollama run qwen2.5:7b` in terminal first).";
      } else {
        keyGroup.style.display = "flex";
        portGroup.style.display = "none";
        if (provider === "openai") {
          modelInput.value = "gpt-4o";
          modelHelp.textContent = "Recommended: gpt-4o, gpt-4-turbo, or gpt-3.5-turbo.";
        } else if (provider === "gemini") {
          modelInput.value = "gemini-1.5-flash";
          modelHelp.textContent = "Recommended: gemini-1.5-flash or gemini-1.5-pro.";
        } else if (provider === "anthropic") {
          modelInput.value = "claude-3-5-sonnet-20241022";
          modelHelp.textContent = "Recommended: claude-3-5-sonnet-20241022.";
        }
      }
    }

    if (providerSelect) {
      providerSelect.removeEventListener("change", updateFields);
      providerSelect.addEventListener("change", updateFields);
      updateFields();
    }

    const runBtn = document.getElementById("btn-ai-run");
    if (runBtn) {
      runBtn.onclick = runAiAgentTask;
    }

    const cancelBtn = document.getElementById("btn-ai-cancel");
    if (cancelBtn) {
      cancelBtn.onclick = cancelAiAgentTask;
    }

    fetchAgentStatus();
    startAiAgentPolling();
  }

  function startAiAgentPolling() {
    stopAiAgentPolling();
    aiPollingInterval = setInterval(fetchAgentStatus, 1500);
  }

  function stopAiAgentPolling() {
    if (aiPollingInterval) {
      clearInterval(aiPollingInterval);
      aiPollingInterval = null;
    }
  }

  async function fetchAgentStatus() {
    try {
      const res = await fetch("/api/agent-status");
      const data = await res.json();
      updateAgentUI(data);
    } catch (e) {
      console.error("Error fetching agent status:", e);
    }
  }

  function updateAgentUI(data) {
    const statusPill = document.getElementById("ai-status-indicator");
    const headerTitle = document.getElementById("ai-header-title");
    const runBtn = document.getElementById("btn-ai-run");
    const cancelBtn = document.getElementById("btn-ai-cancel");
    const logsContainer = document.getElementById("ai-console-logs-container");

    if (!statusPill || !headerTitle || !runBtn || !cancelBtn || !logsContainer) return;

    statusPill.className = `ai-status-pill ${data.status}`;
    statusPill.textContent = data.status;

    if (data.status === "running") {
      headerTitle.textContent = `Running task: "${data.current_task}"`;
      runBtn.disabled = true;
      runBtn.textContent = "Working...";
      cancelBtn.style.display = "inline-block";
    } else {
      headerTitle.textContent = data.current_task ? `Last task: "${data.current_task}"` : "Ready for instructions";
      runBtn.disabled = false;
      runBtn.textContent = "Run Agent";
      cancelBtn.style.display = "none";
    }

    if (data.logs.length !== lastLogCount || logsContainer.children.length <= 1) {
      lastLogCount = data.logs.length;
      
      const welcomeEntry = logsContainer.children[0];
      logsContainer.innerHTML = "";
      logsContainer.appendChild(welcomeEntry);

      data.logs.forEach(log => {
        const entry = document.createElement("div");
        entry.className = "ai-log-entry";
        if (log.startsWith("[System]")) {
          entry.classList.add("system");
        } else if (log.startsWith("[Agent]")) {
          entry.classList.add("agent");
        } else if (log.startsWith("[Error]") || log.startsWith("[System Error]")) {
          entry.classList.add("error");
        } else {
          entry.classList.add("system");
        }
        entry.textContent = log;
        logsContainer.appendChild(entry);
      });

      logsContainer.scrollTop = logsContainer.scrollHeight;
    }
  }

  async function runAiAgentTask() {
    const promptInput = document.getElementById("ai-prompt-input");
    const providerSelect = document.getElementById("ai-provider");
    const keyInput = document.getElementById("ai-key");
    const modelInput = document.getElementById("ai-model");

    if (!promptInput || !promptInput.value.trim()) {
      showToast("❌ Please enter a task instruction.");
      return;
    }

    const provider = providerSelect.value;
    const key = keyInput ? keyInput.value.trim() : "";
    let model = modelInput ? modelInput.value.trim() : "";

    if (provider !== "ollama" && !key) {
      showToast("❌ API Key is required for cloud providers.");
      return;
    }

    const payload = {
      provider: provider,
      api_key: key,
      model: model,
      instruction: promptInput.value.trim()
    };

    try {
      const res = await fetch("/api/agent-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        showToast("🤖 Aura Agent started running!");
        promptInput.value = "";
        lastLogCount = 0;
        fetchAgentStatus();
      } else {
        showToast("❌ Failed to start agent: " + (data.error || "unknown"));
      }
    } catch (e) {
      showToast("❌ Communication error with backend server.");
    }
  }

  async function cancelAiAgentTask() {
    try {
      const res = await fetch("/api/agent-cancel", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        showToast("🤖 Agent task cancelled.");
        fetchAgentStatus();
      }
    } catch (e) {
      showToast("❌ Failed to send cancel request.");
    }
  }

  // ── Boot ─────────────────────────────────────────────────────────────────
  loadCompatDB();
})();

