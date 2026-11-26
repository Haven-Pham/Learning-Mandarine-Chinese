// js/sync.js
// Synchronization between devices (Mobile & Desktop) via GitHub Gist or Fast Sync Code.

const Sync = (() => {
  const GIST_FILENAME = "so-hoc-tieng-hoa-sync.json";
  const DEVICE_FILE = /^progress-[0-9a-f-]{36}\.json$/i;
  let syncPromise = null;
  let lastStatus = null;
  let listeners = [];
  let debounceTimer = null;
  let hasPendingLocalChanges = false;

  function onStatusChange(fn) {
    if (typeof fn === "function") listeners.push(fn);
  }

  function notify(status, detail) {
    lastStatus = { status, detail };
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

    // Find the existing progress before creating a new Gist.
    if (!gistId) {
      for (let page = 1; page <= 10; page++) {
        const listRes = await fetch(`https://api.github.com/gists?per_page=100&page=${page}`, { headers });
        if (!listRes.ok) {
          if (listRes.status === 401 || listRes.status === 403) throw new Error("Token không hợp lệ, thiếu quyền hoặc GitHub đang giới hạn yêu cầu.");
          throw new Error(`Không kiểm tra được Gist cũ (${listRes.status}). Chưa tạo kho mới.`);
        }
        const gists = await listRes.json();
        const found = gists.find((g) => g.files && g.files[GIST_FILENAME]);
        if (found) { gistId = found.id; break; }
        if (gists.length < 100) break;
        if (page === 10) throw new Error("Có quá nhiều Gist để kiểm tra. Hãy nhập Gist ID cũ.");
      }
    }

    // 2. If still no gist, create a new secret gist with current progress
    if (!gistId) {
      const localData = await Store.exportAll();
      localData.kv = Object.assign(localData.kv || {}, { settings: Store.publicSettings(S.settings) });
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

    // Validate access before changing the working connection on this device.
    const checkRes = await fetch(`https://api.github.com/gists/${encodeURIComponent(gistId)}`, { headers, cache: "no-store" });
    if (!checkRes.ok) throw new Error(`Token không truy cập được Gist cũ (${checkRes.status}).`);
    const checkGist = await checkRes.json();
    if (!checkGist.files || !checkGist.files[GIST_FILENAME]) throw new Error("Gist này không chứa tiến độ học.");
    if (checkGist.public) throw new Error("Hãy chọn Gist bí mật để lưu tiến độ.");
    await saveConfig({ token, gistId, autoSync: true });

    // 4. Run two-way sync
    await syncNow();

    return gistId;
  }

  async function disconnect() {
    await saveConfig({ token: "", gistId: "", lastSync: null });
    notify("unconfigured", "Đã ngắt kết nối đồng bộ.");
  }

  // Each browser writes only its own file. Old clients still use the original file.
  function syncNow() {
    if (syncPromise) return syncPromise;
    if (!isConfigured()) {
      notify("unconfigured", "Chưa cấu hình đồng bộ.");
      return Promise.resolve();
    }
    const run = () => performSync();
    syncPromise = (navigator.locks ? navigator.locks.request("shth-gist-sync", run) : run())
      .finally(() => { syncPromise = null; });
    return syncPromise;
  }

  async function parseSnapshot(file) {
    let content = file.content;
    if (file.truncated) {
      const url = new URL(file.raw_url);
      if (url.origin !== "https://gist.githubusercontent.com") throw new Error("Đường dẫn tệp Gist không hợp lệ.");
      const raw = await fetch(url.href, { cache: "no-store", redirect: "error" });
      if (!raw.ok) throw new Error(`Không tải được tệp tiến độ đầy đủ (${raw.status}).`);
      content = await raw.text();
    }
    let data;
    try { data = JSON.parse(content); Store.validateBackup(data); }
    catch (err) { throw new Error("Có tệp tiến độ không hợp lệ trên Gist. Đã dừng đồng bộ."); }
    return data;
  }

  function snapshotContent(data) {
    const { exportedAt, ...state } = data;
    return JSON.stringify(state, (key, value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return value;
      return Object.fromEntries(Object.keys(value).sort().map((name) => [name, value[name]]));
    });
  }

  async function performSync() {
    const cfg = getConfig();
    const sameConnection = () => cfg.token === getConfig().token && cfg.gistId === getConfig().gistId;
    if (!cfg.token || !cfg.gistId) return;
    notify("syncing", "Đang đồng bộ dữ liệu...");
    try {
      const headers = {
        Authorization: `token ${cfg.token}`,
        Accept: "application/vnd.github.v3+json",
      };
      const endpoint = `https://api.github.com/gists/${encodeURIComponent(cfg.gistId)}`;
      const res = await fetch(endpoint, { headers, cache: "no-store" });
      if (!res.ok) {
        if (res.status === 404) throw new Error("Không tìm thấy Gist trên GitHub.");
        if (res.status === 401 || res.status === 403) throw new Error("Token hết hạn, thiếu quyền hoặc đã vượt giới hạn GitHub. Hãy kiểm tra Token trong Cài đặt.");
        throw new Error(`Không tải được Gist (${res.status}).`);
      }
      const gist = await res.json();
      if (gist.public) throw new Error("Hãy chọn Gist bí mật để lưu tiến độ.");
      if (gist.truncated) throw new Error("GitHub không trả đủ các tệp của Gist. Đã dừng đồng bộ.");
      const file = gist.files && gist.files[GIST_FILENAME];
      if (!file) throw new Error("Gist không có tệp tiến độ học.");
      const deviceFile = `progress-${await Store.deviceId()}.json`;
      const entries = Object.entries(gist.files).filter(([name]) => DEVICE_FILE.test(name));
      const [legacy, ...snapshots] = await Promise.all([
        parseSnapshot(file),
        ...entries.map(async ([name, value]) => ({ name, data: await parseSnapshot(value) }))
      ]);
      if (!sameConnection()) return;
      const own = snapshots.find((snapshot) => snapshot.name === deviceFile);
      snapshots.sort((a, b) => String(a.data.exportedAt || "").localeCompare(String(b.data.exportedAt || "")) || a.name.localeCompare(b.name));
      await Store.importAll(legacy, "merge");
      for (const { data } of snapshots) {
        if (!sameConnection()) return;
        await Store.importAll(data, "merge");
      }
      if (!sameConnection()) return;
      if (typeof loadProgress === "function") await loadProgress();
      if (typeof syncAllInboxNotes === "function") syncAllInboxNotes();
      // A grade during network upload must schedule another pass.
      hasPendingLocalChanges = false;
      const mergedData = await Store.exportAll();
      mergedData.kv = Object.assign(mergedData.kv || {}, { settings: Store.publicSettings(S.settings) });
      if (!sameConnection()) return;
      if (!own || snapshotContent(own.data) !== snapshotContent(mergedData)) {
        const patchRes = await fetch(endpoint, {
          method: "PATCH",
          headers: Object.assign({}, headers, { "Content-Type": "application/json" }),
          body: JSON.stringify({ files: { [deviceFile]: { content: JSON.stringify(mergedData) } } }),
        });
        if (!patchRes.ok) throw new Error(`Không cập nhật được Gist (${patchRes.status}).`);
      }

      if (!sameConnection()) return;
      const nowIso = new Date().toISOString();
      await Store.update("kv", "settings", (current) => {
        if (!sameConnection()) return current || {};
        return { ...(current || S.settings), lastSyncTime: nowIso };
      });
      if (!sameConnection()) return;
      S.settings.lastSyncTime = nowIso;
      if (hasPendingLocalChanges && cfg.autoSync) scheduleSync();
      const timeText = new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
      notify("success", `Đã đồng bộ thành công lúc ${timeText}`);
      if (typeof updateBadge === "function") updateBadge();
    } catch (err) {
      hasPendingLocalChanges = true;
      console.error("Sync error:", err);
      notify("error", err.message || String(err));
      throw err;
    }
  }

  // Hook triggered when cards are reviewed or updated
  function onCardGraded() {
    hasPendingLocalChanges = true;
    const cfg = getConfig();
    if (!cfg.token || !cfg.gistId || !cfg.autoSync) return;
    scheduleSync();
  }

  function scheduleSync() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      syncNow().catch((e) => console.warn("Auto-sync background failed:", e));
    }, 4000); // sync 4 seconds after user pauses reviewing
  }

  window.addEventListener("online", () => {
    if (isConfigured() && getConfig().autoSync) scheduleSync();
  });

  // Fast code: Encode full progress into a portable Base64 string
  async function generateFastCode() {
    const data = await Store.exportAll();
    data.kv = Object.assign(data.kv || {}, { settings: Store.publicSettings(S.settings) });
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
    if (typeof syncAllInboxNotes === "function") syncAllInboxNotes();
    if (typeof updateBadge === "function") updateBadge();
    onCardGraded();
    return Object.keys(data.srs || {}).length;
  }

  // Listen to visibility change (when switching back to app on phone or PC)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      if (hasPendingLocalChanges && isConfigured() && getConfig().autoSync) {
        syncNow().catch(() => {});
      }
    } else if (document.visibilityState === "visible") {
      if (isConfigured() && getConfig().autoSync) {
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
    onStatusChange,
    getStatus: () => lastStatus,
  };
})();

// app.js checks window.Sync: a top-level const is not a window property, so expose it explicitly.
window.Sync = Sync;
