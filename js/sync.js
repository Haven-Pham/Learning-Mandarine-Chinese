// js/sync.js
// Synchronization between devices (Mobile & Desktop) via GitHub Gist or Fast Sync Code.

const Sync = (() => {
  const GIST_FILENAME = "so-hoc-tieng-hoa-sync.json";
  let isSyncing = false;
  let listeners = [];
  let debounceTimer = null;
  let hasPendingLocalChanges = false;

  function onStatusChange(fn) {
    if (typeof fn === "function") listeners.push(fn);
  }

  function notify(status, detail) {
    listeners.forEach((fn) => {
      try { fn(status, detail); } catch (e) { console.error(e); }
    });
  }

  function isConfigured() {
    const s = (typeof S !== "undefined" && S.settings) || {};
    return !!(s.syncToken && s.syncGistId);
  }

  function getConfig() {
    const s = (typeof S !== "undefined" && S.settings) || {};
    return {
      token: s.syncToken || "",
      gistId: s.syncGistId || "",
      autoSync: s.autoSync !== false,
      lastSync: s.lastSyncTime || null,
    };
  }

  async function saveConfig(cfg) {
    if (typeof S === "undefined" || !S.settings) return;
    if (typeof cfg.token !== "undefined") S.settings.syncToken = (cfg.token || "").trim();
    if (typeof cfg.gistId !== "undefined") S.settings.syncGistId = (cfg.gistId || "").trim();
    if (typeof cfg.autoSync === "boolean") S.settings.autoSync = cfg.autoSync;
    if (typeof cfg.lastSync !== "undefined") S.settings.lastSyncTime = cfg.lastSync;
    await Store.put("kv", "settings", JSON.parse(JSON.stringify(S.settings)));
    notify(isConfigured() ? "configured" : "unconfigured", getConfig());
  }

  // Connect using a GitHub Personal Access Token (classic or fine-grained with 'gist' scope)
  async function connectWithToken(token, existingGistId = "") {
    token = (token || "").trim();
    if (!token) throw new Error("Vui lòng nhập GitHub Token.");

    notify("syncing", "Đang kết nối tới GitHub...");

    const headers = {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    };

    let gistId = (existingGistId || "").trim();

    // 1. If no gistId provided, search user's gists for one created previously
    if (!gistId) {
      try {
        const listRes = await fetch("https://api.github.com/gists?per_page=50", { headers });
        if (!listRes.ok) {
          if (listRes.status === 401) throw new Error("Token không hợp lệ hoặc đã hết hạn. Hãy kiểm tra lại token.");
          throw new Error(`Lỗi kết nối GitHub (Mã ${listRes.status}).`);
        }
        const gists = await listRes.json();
        const found = gists.find((g) => g.files && g.files[GIST_FILENAME]);
        if (found) gistId = found.id;
      } catch (e) {
        if (!e.message.includes("Token không hợp lệ")) {
          console.warn("Không tìm kiếm được danh sách gist:", e);
        } else {
          throw e;
        }
      }
    }

    // 2. If still no gist, create a new secret gist with current progress
    if (!gistId) {
      const localData = await Store.exportAll();
      localData.kv = Object.assign(localData.kv || {}, { settings: S.settings });
      const createRes = await fetch("https://api.github.com/gists", {
        method: "POST",
        headers,
        body: JSON.stringify({
          description: "Sổ học tiếng Hoa - Dữ liệu đồng bộ tiến độ học tập",
          public: false,
          files: {
            [GIST_FILENAME]: {
              content: JSON.stringify(localData),
            },
          },
        }),
      });

      if (!createRes.ok) {
        const errJson = await createRes.json().catch(() => ({}));
        throw new Error(errJson.message || `Không tạo được Gist (Mã ${createRes.status}). Hãy đảm bảo Token có quyền 'gist'.`);
      }

      const created = await createRes.json();
      gistId = created.id;
    }

    // 3. Save configuration
    await saveConfig({ token, gistId, autoSync: true, lastSync: new Date().toISOString() });

    // 4. Run two-way sync
    await syncNow();

    return gistId;
  }

  async function disconnect() {
    await saveConfig({ token: "", gistId: "", lastSync: null });
    notify("unconfigured", "Đã ngắt kết nối đồng bộ.");
  }

  // Core Sync Function: Pull remote, merge locally, push merged back to remote
  async function syncNow() {
    if (isSyncing) return;
    const cfg = getConfig();
    if (!cfg.token || !cfg.gistId) {
      notify("unconfigured", "Chưa cấu hình đồng bộ.");
      return;
    }

    isSyncing = true;
    notify("syncing", "Đang đồng bộ dữ liệu...");

    try {
      const headers = {
        Authorization: `token ${cfg.token}`,
        Accept: "application/vnd.github.v3+json",
      };

      // 1. Fetch remote Gist
      const res = await fetch(`https://api.github.com/gists/${cfg.gistId}`, { headers });
      if (!res.ok) {
        if (res.status === 404) throw new Error("Không tìm thấy Gist trên GitHub (có thể đã bị xóa).");
        if (res.status === 401) throw new Error("Token đã hết hạn hoặc không có quyền truy cập Gist.");
        throw new Error(`Lỗi tải dữ liệu từ GitHub (${res.status}).`);
      }

      const gist = await res.json();
      const file = gist.files && gist.files[GIST_FILENAME];
      if (file && file.content) {
        try {
          const remoteData = JSON.parse(file.content);
          // Merge remote progress into local database (newer cards win)
          await Store.importAll(remoteData, "merge");
          if (typeof loadProgress === "function") await loadProgress();
        } catch (parseErr) {
          console.warn("Không parse được nội dung Gist:", parseErr);
        }
      }

      // 2. Export full merged state from local
      const mergedData = await Store.exportAll();
      mergedData.kv = Object.assign(mergedData.kv || {}, { settings: S.settings });

      // 3. Update remote Gist with merged state
      const nowStr = new Date().toLocaleString("vi-VN");
      const patchRes = await fetch(`https://api.github.com/gists/${cfg.gistId}`, {
        method: "PATCH",
        headers: Object.assign({}, headers, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          description: `Sổ học tiếng Hoa - Tiến độ học (${nowStr})`,
          files: {
            [GIST_FILENAME]: {
              content: JSON.stringify(mergedData),
            },
          },
        }),
      });

      if (!patchRes.ok) {
        throw new Error(`Không cập nhật được Gist (${patchRes.status}).`);
      }

      const nowIso = new Date().toISOString();
      S.settings.lastSyncTime = nowIso;
      await Store.put("kv", "settings", JSON.parse(JSON.stringify(S.settings)));
      hasPendingLocalChanges = false;

      const timeText = new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
      notify("success", `Đã đồng bộ thành công lúc ${timeText}`);
      if (typeof updateBadge === "function") updateBadge();
    } catch (err) {
      console.error("Sync error:", err);
      notify("error", err.message || String(err));
      throw err;
    } finally {
      isSyncing = false;
    }
  }

  // Hook triggered when cards are reviewed or updated
  function onCardGraded() {
    hasPendingLocalChanges = true;
    const cfg = getConfig();
    if (!cfg.token || !cfg.gistId || !cfg.autoSync) return;

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      syncNow().catch((e) => console.warn("Auto-sync background failed:", e));
    }, 4000); // sync 4 seconds after user pauses reviewing
  }

  // Fast code: Encode full progress into a portable Base64 string
  async function generateFastCode() {
    const data = await Store.exportAll();
    data.kv = Object.assign(data.kv || {}, { settings: S.settings });
    const json = JSON.stringify(data);
    return btoa(encodeURIComponent(json).replace(/%([0-9A-F]{2})/g, (match, p1) => String.fromCharCode('0x' + p1)));
  }

  // Fast code: Decode and merge into local progress
  async function applyFastCode(codeStr) {
    if (!codeStr || !codeStr.trim()) throw new Error("Chưa nhập mã tiến độ.");
    const trimmed = codeStr.trim();
    let json = "";
    try {
      json = decodeURIComponent(Array.prototype.map.call(atob(trimmed), (c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
    } catch (e) {
      throw new Error("Mã tiến độ không hợp lệ hoặc bị thiếu ký tự.");
    }
    const data = JSON.parse(json);
    await Store.importAll(data, "merge");
    if (typeof loadProgress === "function") await loadProgress();
    if (typeof updateBadge === "function") updateBadge();
    return Object.keys(data.srs || {}).length;
  }

  // Generate 1-click connection link for phone
  function getSetupUrl() {
    const cfg = getConfig();
    if (!cfg.token || !cfg.gistId) return "";
    let origin = location.origin;
    let pathname = location.pathname;
    // Normalize path
    if (origin === "file://") {
      origin = "https://haven-pham.github.io";
      pathname = "/Learning-Mandarine-Chinese/";
    }
    return `${origin}${pathname}#sync-setup?t=${encodeURIComponent(cfg.token)}&g=${encodeURIComponent(cfg.gistId)}`;
  }

  // Listen to visibility change (when switching back to app on phone or PC)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      if (hasPendingLocalChanges && isConfigured() && getConfig().autoSync) {
        syncNow().catch(() => {});
      }
    } else if (document.visibilityState === "visible") {
      if (isConfigured() && getConfig().autoSync && !isSyncing) {
        // Subtle background pull when returning to tab
        syncNow().catch(() => {});
      }
    }
  });

  return {
    isConfigured,
    getConfig,
    saveConfig,
    connectWithToken,
    disconnect,
    syncNow,
    onCardGraded,
    generateFastCode,
    applyFastCode,
    getSetupUrl,
    onStatusChange,
  };
})();
