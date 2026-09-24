JF.Data = JF.Data || {};

/**
 * GasAdapter - Google Sheets + Google Drive backend (Apps Script Web App).
 *
 * Wire protocol: POST { action, payload, token } -> { success, data | error }
 * Actions: ping | setup | list | get | create | update | delete | seed | clear |
 *          uploadFile (alias uploadPhoto) | listFiles | exportBackup
 *
 * Storage layout in the farm's Drive folder (CONFIG.DRIVE_ROOT_FOLDER_ID in Code.gs):
 *   <root>/Animal Photos/<AnimalID>/<file>    profile, ID and event photos
 *   <root>/Documents/<Category>/<file>        bills, certificates, vet papers
 *   <root>/Backups/<farm>-backup-<stamp>.json full data snapshots
 *
 * Records live in one Google Sheet tab per entity; column A is the record id, and
 * uploadFile returns embed-safe image URLs so every device renders the photo.
 *
 * Offline stub mode: until a real deployment URL is configured (Settings >
 * Google Drive & Sheets), calls resolve with empty data instead of hitting the
 * network. The app never loses local data because of this.
 */

JF.Data.GasAdapter = (function () {
  const { Interface } = JF.Data.DataAdapter;

  // Placeholder deployment id shipped in the repo; replaced on real setup.
  const PLACEHOLDER_IDS = ["AKfycbxH2iLEYoiHo7wd74ykPRiXClvEUXeoqw8", "YOUR_DEPLOYMENT_ID"];
  const DEFAULT_FOLDER_ID = "1fwov4WjZcVICFEhtUZUUeq9SqXYYqvmB";

  class GasAdapter extends Interface {
    constructor() {
      super();
      const stored = (() => { try { return localStorage.getItem("jf_gas_endpoint"); } catch (e) { return null; } })();
      this.endpoint = stored || "";
      this.token = (() => { try { return localStorage.getItem("jf_gas_token") || ""; } catch (e) { return ""; } })();
      this.folderId = (() => { try { return localStorage.getItem("jf_drive_folder_id") || DEFAULT_FOLDER_ID; } catch (e) { return DEFAULT_FOLDER_ID; } })();
      this.listeners = new Map();
      this.lastStatus = null;
    }

    configure({ endpoint, token, folderId } = {}) {
      if (endpoint !== undefined) { this.endpoint = endpoint; try { localStorage.setItem("jf_gas_endpoint", endpoint); } catch (e) {} }
      if (token !== undefined) { this.token = token; try { localStorage.setItem("jf_gas_token", token); } catch (e) {} }
      if (folderId !== undefined) { this.folderId = folderId; try { localStorage.setItem("jf_drive_folder_id", folderId); } catch (e) {} }
    }

    /** True when no real deployment URL is configured yet (offline stub mode). */
    isPlaceholderEndpoint() {
      const ep = String(this.endpoint || "");
      return !ep || PLACEHOLDER_IDS.some((id) => ep.indexOf(id) !== -1);
    }

    async _call(action, payload = {}) {
      if (this.isPlaceholderEndpoint()) {
        console.warn(`[GasAdapter] Offline stub mode (${action}) - configure a real Apps Script URL in Settings to go live.`);
        return this._fallback(action, payload);
      }
      try {
        // Every call carries the farm's Drive folder so the backend never has to
        // be redeployed just because the folder changed.
        const withFolder = Object.assign({ folderId: this.folderId }, payload);
        const body = JSON.stringify({ action, payload: withFolder, token: this.token || "" });
        // text/plain avoids the CORS preflight that Apps Script cannot answer.
        const res = await fetch(this.endpoint, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body,
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error || "Apps Script call failed");
        return json.data;
      } catch (err) {
        console.error(`[GasAdapter:${action}]`, err);
        throw err;
      }
    }

    async _fallback(action, payload) {
      if (action === "list" || action === "listFiles") return [];
      if (action === "get") return null;
      if (action === "create") return { ...(payload?.data || {}), id: "gas_" + Date.now() };
      if (action === "update") return { ...(payload?.patch || {}) };
      if (action === "delete") return true;
      return null;
    }

    /** Ping the backend and remember the status report (spreadsheet + Drive info). */
    async testConnection() {
      if (this.isPlaceholderEndpoint()) {
        throw new Error("No Apps Script URL configured yet. Deploy Code.gs and paste the /exec URL first.");
      }
      const status = await this._call("ping");
      this.lastStatus = status;
      return status;
    }

    /** Create the spreadsheet tabs + Drive folder structure in one go. */
    async setup() {
      const status = await this._call("setup");
      this.lastStatus = status;
      return status;
    }

    async exportBackup() { return this._call("exportBackup"); }

    /**
     * End-to-end health check on the real Google account: tabs, a write/read/delete
     * round trip in the sheet, and a file created+removed in the farm Drive folder.
     */
    async verify() {
      const res = await this._call("verify");
      this.lastStatus = res;
      return res;
    }

    /**
     * Upload any file (photo or document) to the farm Drive folder.
     * Returns { url, thumbUrl, pageUrl, fileId, folder } - `url` is embed-safe.
     */
    async uploadFile({ dataUrl, animalId = "", kind = "Profile", category = "", fileName = "file", recordId = "" } = {}) {
      if (!dataUrl) throw new Error("No file data provided");
      const m = String(dataUrl).match(/^data:([\w.+-]+\/[\w.+-]+);base64,(.+)$/);
      if (!m) throw new Error("File must be a base64 data URL");
      return this._call("uploadFile", {
        mimeType: m[1],
        base64: m[2],
        animalId,
        kind,
        category,
        recordId,
        fileName: fileName || `file-${animalId || Date.now()}`,
        folderId: this.folderId,
      });
    }

    /** Backwards-compatible photo upload. */
    async uploadPhoto(opts = {}) { return this.uploadFile({ kind: "Profile", ...opts }); }

    on(evt, fn) {
      if (!this.listeners.has(evt)) this.listeners.set(evt, new Set());
      this.listeners.get(evt).add(fn);
    }

    emit(evt, p) { (this.listeners.get(evt) || []).forEach((fn) => fn(p)); }

    async list(entity) { return this._call("list", { entity }); }
    async get(entity, id) { return this._call("get", { entity, id }); }

    async create(entity, data) {
      const r = await this._call("create", { entity, data });
      this.emit(`${entity}:created`, r);
      this.emit("change", { entity, action: "create", record: r });
      return r;
    }

    async update(entity, id, patch) {
      const r = await this._call("update", { entity, id, patch });
      this.emit(`${entity}:updated`, r);
      this.emit("change", { entity, action: "update", id, record: r });
      return r;
    }

    async delete(entity, id) {
      const r = await this._call("delete", { entity, id });
      this.emit(`${entity}:deleted`, r);
      this.emit("change", { entity, action: "delete", id, record: r });
      return r;
    }

    async seed(data) { return this._call("seed", { data }); }

    /**
     * Install the farm's default rulebook (adds missing rows, never overwrites edits).
     * With { upsert: true }, changed rows are pushed as updates so a device's rule
     * edits reach the Sheet (add-only by default, per the farm's guarantee).
     */
    async seedRules(book, { upsert = false } = {}) {
      const src = book || (JF.RuleBook && JF.RuleBook.seedPayload()) || {};
      return this._call("seedRules", {
        rules: src.rules || [],
        params: src.ruleParameters || src.params || src.parameters || [],
        overrides: src.overrides || [],
        upsert,
      });
    }

    /** Push the app's full rule configuration into the Sheets (update mode). */
    async syncRules(book) { return this.seedRules(book, { upsert: true }); }
    async clear() { return this._call("clear", {}); }
  }

  GasAdapter.DEFAULT_FOLDER_ID = DEFAULT_FOLDER_ID;
  return GasAdapter;
})();
