# Injects an integration harness into build/preview.html:
#   - fakes the Google APIs (SpreadsheetApp, DriveApp, Utilities, ContentService,
#     PropertiesService, LockService, Session)
#   - loads the REAL google-apps-script/Code.gs with those fakes
#   - stubs fetch so the REAL JF.Data.GasAdapter talks to that server
#   - asserts the sheet/Drive coordination contract end to end
# Results land in window.__JF_IT. Rebuild preview.html to remove the injection.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/check-integration.ps1
# NOTE: keep this file ASCII-only (PowerShell 5.1 reads it with the ANSI codepage).
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root "google-apps-script\Code.gs"
$bundle = Join-Path $root "build\preview.html"

$code = [IO.File]::ReadAllText($src)
$json = ConvertTo-Json $code -Compress

$harness = @'
<!--JF-IT-START-->
<script>
(function () {
  var out = { asserts: [], failures: [] };
  function ok(name, cond, detail) {
    out.asserts.push({ name: name, ok: !!cond, detail: detail === undefined ? "" : String(detail) });
    if (!cond) out.failures.push(name + (detail ? " -> " + detail : ""));
  }

  /* ---------------- fake Google APIs ---------------- */
  var NOW = new Date();
  var G = { files: {}, props: {}, seq: 0 };

  function FakeRange(sheet, row, col, nr, nc) {
    this.sheet = sheet; this.row = row; this.col = col; this.nr = nr || 1; this.nc = nc || 1;
  }
  // Sheets turns "2026-09-01" style strings into real date values - the harness
  // reproduces that so the server's date normalisation is genuinely exercised.
  function coerce(v) {
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(v + "T00:00:00");
    return v;
  }
  FakeRange.prototype.setValues = function (vals) {
    for (var r = 0; r < vals.length; r++) {
      for (var c = 0; c < vals[r].length; c++) this.sheet._set(this.row - 1 + r, this.col - 1 + c, coerce(vals[r][c]));
    }
    return this;
  };
  FakeRange.prototype.getValues = function () {
    var rows = [];
    for (var r = 0; r < this.nr; r++) {
      var line = [];
      for (var c = 0; c < this.nc; c++) line.push(this.sheet._get(this.row - 1 + r, this.col - 1 + c));
      rows.push(line);
    }
    return rows;
  };
  FakeRange.prototype.setValue = function (v) { this.sheet._set(this.row - 1, this.col - 1, coerce(v)); return this; };
  FakeRange.prototype.getValue = function () { return this.sheet._get(this.row - 1, this.col - 1); };
  FakeRange.prototype.clearContent = function () {
    for (var r = 0; r < this.nr; r++) for (var c = 0; c < this.nc; c++) this.sheet._set(this.row - 1 + r, this.col - 1 + c, "");
    return this;
  };
  FakeRange.prototype.setFontWeight = function () { return this; };
  FakeRange.prototype.setBackground = function () { return this; };
  FakeRange.prototype.setNumberFormat = function () { return this; };

  function FakeSheet(name) { this.name = name; this.rows = []; }
  FakeSheet.prototype.getName = function () { return this.name; };
  FakeSheet.prototype._set = function (r, c, v) {
    while (this.rows.length <= r) this.rows.push([]);
    while (this.rows[r].length <= c) this.rows[r].push("");
    this.rows[r][c] = v;
  };
  FakeSheet.prototype._get = function (r, c) { return (this.rows[r] || [])[c] === undefined ? "" : (this.rows[r] || [])[c]; };
  FakeSheet.prototype.getLastRow = function () {
    var last = 0;
    this.rows.forEach(function (row, i) {
      if (row.some(function (v) { return v !== "" && v !== null && v !== undefined; })) last = i + 1;
    });
    return last;
  };
  FakeSheet.prototype.getLastColumn = function () {
    var last = 0;
    this.rows.forEach(function (row) {
      for (var c = row.length - 1; c >= 0; c--) {
        if (row[c] !== "" && row[c] !== null && row[c] !== undefined) { if (c + 1 > last) last = c + 1; break; }
      }
    });
    return last;
  };
  FakeSheet.prototype.getRange = function (row, col, nr, nc) { return new FakeRange(this, row, col, nr, nc); };
  FakeSheet.prototype.appendRow = function (row) {
    var idx = this.getLastRow();
    this._set(idx, 0, null);
    row.forEach(function (v, c) { this._set(idx, c, coerce(v)); }, this);
    return this;
  };
  FakeSheet.prototype.deleteRow = function (n) { this.rows.splice(n - 1, 1); };
  FakeSheet.prototype.setFrozenRows = function () { return this; };
  FakeSheet.prototype.getDataRange = function () {
    var maxCols = 0;
    this.rows.forEach(function (r) { if (r.length > maxCols) maxCols = r.length; });
    return new FakeRange(this, 1, 1, this.getLastRow(), maxCols || 1);
  };

  function FakeSpreadsheet(name) { this.name = name; this.id = "SS-" + (++G.seq); this.sheets = []; }
  FakeSpreadsheet.prototype.getName = function () { return this.name; };
  FakeSpreadsheet.prototype.getId = function () { return this.id; };
  FakeSpreadsheet.prototype.getUrl = function () { return "https://docs.google.com/spreadsheets/d/" + this.id; };
  FakeSpreadsheet.prototype.getSheetByName = function (n) {
    var found = null;
    this.sheets.forEach(function (s) { if (s.getName() === n) found = s; });
    return found;
  };
  FakeSpreadsheet.prototype.insertSheet = function (n) { var s = new FakeSheet(n); this.sheets.push(s); return s; };
  FakeSpreadsheet.prototype.getSheets = function () { return this.sheets.slice(); };
  FakeSpreadsheet.prototype.deleteSheet = function (s) { this.sheets = this.sheets.filter(function (x) { return x !== s; }); };

  var SPREADSHEETS = {};
  var SpreadsheetApp = {
    getActiveSpreadsheet: function () { return null; },   // standalone-script path
    create: function (name) { var ss = new FakeSpreadsheet(name); SPREADSHEETS[ss.getId()] = ss; return ss; },
    openById: function (id) { if (!SPREADSHEETS[id]) throw new Error("no spreadsheet " + id); return SPREADSHEETS[id]; },
  };

  function FakeFile(folder, blob) {
    this.id = "DRIVE-" + (++G.seq) + Date.now();
    this.name = blob.name; this.mimeType = blob.mime;
    this.folder = folder; this.shared = null; this.trashed = false;
    this.size = blob.data ? String(blob.data).length : 0;
    G.files[this.id] = this;
  }
  FakeFile.prototype.getId = function () { return this.id; };
  FakeFile.prototype.getName = function () { return this.name; };
  FakeFile.prototype.getSize = function () { return this.size; };
  FakeFile.prototype.getUrl = function () { return "https://drive.google.com/file/d/" + this.id + "/view"; };
  FakeFile.prototype.getLastUpdated = function () { return NOW; };
  FakeFile.prototype.setSharing = function (a, p) { this.shared = { access: a, permission: p }; return this; };
  FakeFile.prototype.setTrashed = function (v) { this.trashed = !!v; return this; };

  function FakeFolder(name, id) { this.name = name; this.id = id || "FLD-" + (++G.seq); this.children = []; this.files = []; }
  FakeFolder.prototype.getName = function () { return this.name; };
  FakeFolder.prototype.getId = function () { return this.id; };
  FakeFolder.prototype.getUrl = function () { return "https://drive.google.com/drive/folders/" + this.id; };
  FakeFolder.prototype.getFoldersByName = function (n) {
    var list = this.children.filter(function (f) { return f.name === n; });
    var i = 0;
    return { hasNext: function () { return i < list.length; }, next: function () { return list[i++]; } };
  };
  FakeFolder.prototype.createFolder = function (n) { var f = new FakeFolder(n); this.children.push(f); return f; };
  FakeFolder.prototype.createFile = function (blob) { var f = new FakeFile(this, blob); this.files.push(f); return f; };
  FakeFolder.prototype.getFiles = function () {
    var list = this.files, i = 0;
    return { hasNext: function () { return i < list.length; }, next: function () { return list[i++]; } };
  };

  var FARM_FOLDER = new FakeFolder("Jagt Farm (shared)", "1fwov4WjZcVICFEhtUZUUeq9SqXYYqvmB");
  var DriveApp = {
    Access: { ANYONE_WITH_LINK: "ANYONE_WITH_LINK" },
    Permission: { VIEW: "VIEW" },
    getFolderById: function (id) {
      if (id === FARM_FOLDER.id) return FARM_FOLDER;
      throw new Error("folder not found: " + id);
    },
    getFoldersByName: function (n) {
      var list = n === FARM_FOLDER.name ? [FARM_FOLDER] : [];
      var i = 0;
      return { hasNext: function () { return i < list.length; }, next: function () { return list[i++]; } };
    },
    createFolder: function (n) { var f = new FakeFolder(n); return f; },
  };

  var Utilities = {
    newBlob: function (data, mime, name) { return { data: data, mime: mime, name: name }; },
    base64Decode: function (s) { return { b64: s, length: Math.round(s.length * 3 / 4) }; },
    formatDate: function (d, tz, fmt) {
      function p(n) { return (n < 10 ? "0" : "") + n; }
      return fmt.replace("yyyy", d.getFullYear()).replace("MM", p(d.getMonth() + 1)).replace("dd", p(d.getDate()))
        .replace("HHmm", p(d.getHours()) + p(d.getMinutes()));
    },
  };
  var ContentService = {
    MimeType: { JSON: "application/json" },
    createTextOutput: function (s) { return { _s: s, setMimeType: function () { return this; }, getContent: function () { return this._s; } }; },
  };
  var PropertiesService = { getScriptProperties: function () { return { getProperty: function (k) { return G.props[k] || null; }, setProperty: function (k, v) { G.props[k] = v; } }; } };
  var LockService = { getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () {} }; } };
  var Session = { getScriptTimeZone: function () { return "Asia/Kolkata"; } };

  /* ---------------- load the real Code.gs ---------------- */
  var serverSrc = __JSON__;
  var server = null;
  try {
    var factory = new Function("SpreadsheetApp", "DriveApp", "Utilities", "ContentService", "PropertiesService", "LockService", "Session",
      serverSrc + "\n;return { doPost: doPost, doGet: doGet, verifySystem: verifySystem, getEntityList: getEntityList };");
    server = factory(SpreadsheetApp, DriveApp, Utilities, ContentService, PropertiesService, LockService, Session);
    ok("Code.gs loads with fake Google APIs", true);
  } catch (e) {
    ok("Code.gs loads with fake Google APIs", false, e.message);
    window.__JF_IT = out;
    return;
  }

  /* ---------------- stub fetch: adapter -> real doPost ---------------- */
  var requests = [];
  window.fetch = function (url, opts) {
    var body = JSON.parse(opts.body);
    requests.push({ url: url, contentType: opts.headers && opts.headers["Content-Type"], body: body });
    var res = server.doPost({ postData: { contents: opts.body } });
    var text = res.getContent();
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(JSON.parse(text)); }, text: function () { return Promise.resolve(text); } });
  };

  var FOLDER = "1fwov4WjZcVICFEhtUZUUeq9SqXYYqvmB";
  var adapter = new JF.Data.GasAdapter();
  adapter.configure({ endpoint: "https://script.google.com/macros/s/TESTDEPLOYMENT/exec", folderId: FOLDER, token: "" });

  var PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AF+7uEHAAAAAElFTkSuQmCC";

  (async function run() {
    try {
      /* 1. ping */
      var ping = await adapter.testConnection();
      ok("ping: online", ping.status === "online", ping.status);
      ok("ping: echoes the farm Drive folder", ping.rootFolderId === FOLDER, ping.rootFolderId);
      ok("ping: opens the real folder by name", ping.drive && ping.drive.rootFolder && ping.drive.rootFolder.name === "Jagt Farm (shared)", ping.drive && ping.drive.rootFolder && ping.drive.rootFolder.name);

      /* 2. setup creates tabs + folders */
      var st = await adapter.setup();
      ok("setup: all 23 sheet tabs ready", st.spreadsheet.ready === true, JSON.stringify(st.spreadsheet.missingSheets));

      /* milk sales: new entity round-trips into its own MilkSales sheet */
      await adapter.create("milkSales", { MilkSaleID: "MILK-900", Date: "2026-09-24", Shift: "Morning", Buyer: "Verka Dairy", QuantityLitres: 24.5, FatPercent: 6.2, RatePerLitre: 42, Amount: 1029, PaymentMethod: "UPI", PaymentStatus: "Received" });
      var milk = await adapter.list("milkSales");
      ok("milkSales: row round-trips with numbers intact", milk.length === 1 && milk[0].QuantityLitres === 24.5 && milk[0].Amount === 1029 && milk[0].Date === "2026-09-24", JSON.stringify(milk[0] || {}));
      ok("setup: creates Animal Photos / Documents / Backups",
        ["Animal Photos", "Documents", "Backups"].every(function (n) { return FARM_FOLDER.children.some(function (c) { return c.name === n; }); }),
        FARM_FOLDER.children.map(function (c) { return c.name; }).join(","));

      /* 3. create + list + date round trip + dryOff entity */
      await adapter.create("animals", { AnimalID: "COW-900", TagNumber: "900", Name: "Test Cow", Gender: "Female", CurrentStatus: "Lactating", Category: "Cow", DateOfBirth: "2023-04-02", CalvingCount: 2 });
      var animals = await adapter.list("animals");
      var cow = animals.filter(function (a) { return a.AnimalID === "COW-900"; })[0];
      ok("create+list: the animal comes back", !!cow, animals.length + " rows");
      ok("dates survive the Sheets round trip as YYYY-MM-DD", cow && cow.DateOfBirth === "2023-04-02", cow && cow.DateOfBirth);
      ok("numbers survive as numbers", cow && cow.CalvingCount === 2, cow && cow.CalvingCount);
      ok("list rows carry a usable id", cow && cow.id === "COW-900", cow && cow.id);

      /* 4. update propagates */
      await adapter.update("animals", "COW-900", { CurrentStatus: "Dry", DryOffDate: "2026-09-20" });
      cow = (await adapter.list("animals")).filter(function (a) { return a.AnimalID === "COW-900"; })[0];
      ok("update: status and dry-off fields persist", cow.CurrentStatus === "Dry" && cow.DryOffDate === "2026-09-20", cow.CurrentStatus + "/" + cow.DryOffDate);

      /* 5. dryOff entity (was missing from the client entity list) */
      await adapter.create("dryOff", { DryOffID: "DRY-1", AnimalID: "COW-900", Date: "2026-09-20", DaysInMilkAtDry: 202, Reason: "Pre-calving rest" });
      var dry = await adapter.list("dryOff");
      ok("dry-off records sync to the DryOff sheet", dry.length === 1 && dry[0].AnimalID === "COW-900", JSON.stringify(dry[0] || {}));

      /* 6. reminders with time + source */
      await adapter.create("reminders", { ReminderID: "RMN-1", AnimalID: "COW-900", ReminderType: "Custom", DueDate: "2026-10-05", Time: "07:30", Priority: "High", Status: "Upcoming", Source: "Custom", Notes: "Vet visit" });
      var rem = await adapter.list("reminders");
      ok("reminders keep custom time + source", rem[0] && rem[0].Time === "07:30" && rem[0].Source === "Custom", JSON.stringify(rem[0] || {}));

      /* 7. photo upload -> Drive + Files index */
      var up = await adapter.uploadFile({ dataUrl: PNG, animalId: "COW-900", kind: "Profile", fileName: "cow-900.jpg", folderId: FOLDER });
      ok("upload: returns an embed-safe image URL", /^https:\/\/lh3\.googleusercontent\.com\/d\/.+=w1200$/.test(up.url), up.url);
      ok("upload: returns a Drive page URL", /drive\.google\.com\/file\/d\/[^/]+\/view/.test(up.pageUrl), up.pageUrl);
      ok("upload: reports the animal sub-folder", up.folder === "COW-900", up.folder);
      var photoFolder = FARM_FOLDER.children.filter(function (c) { return c.name === "Animal Photos"; })[0];
      var animalFolder = photoFolder && photoFolder.children.filter(function (c) { return c.name === "COW-900"; })[0];
      ok("upload: file really lands in Drive under Animal Photos/COW-900",
        !!(animalFolder && animalFolder.files.length === 1), animalFolder ? animalFolder.files.map(function (f) { return f.name; }).join(",") : "no folder");
      ok("upload: file is shared anyone-with-link", !!(animalFolder && animalFolder.files[0] && animalFolder.files[0].shared && animalFolder.files[0].shared.access === "ANYONE_WITH_LINK"));
      var files = await adapter.list("files");
      ok("upload: is indexed in the Files sheet for this animal", files.length === 1 && files[0].AnimalID === "COW-900", JSON.stringify(files[0] || {}));

      /* 8. a base64 photo can never be pushed into a sheet cell */
      var hugeDataUrl = "data:image/jpeg;base64," + new Array(60000).join("A");
      await adapter.create("animals", { AnimalID: "COW-901", PhotoURL: hugeDataUrl });
      var cow2 = (await adapter.list("animals")).filter(function (a) { return a.AnimalID === "COW-901"; })[0];
      ok("oversized value is clamped, write still succeeds", cow2 && String(cow2.PhotoURL).length < 50000, cow2 ? String(cow2.PhotoURL).slice(0, 60) : "missing");

      /* 9. PhotoUpload never persists a raw data URL into the sheet while live */
      var liveBefore = localStorage.getItem("jf_gas_endpoint");
      localStorage.setItem("jf_gas_endpoint", "https://script.google.com/macros/s/TESTDEPLOYMENT/exec");
      localStorage.setItem("jf_drive_folder_id", FOLDER);
      JF.Store.setBackend("gas");
      await adapter.create("animals", { AnimalID: "COW-903", Name: "Photo Test", Gender: "Female", CurrentStatus: "Open", Category: "Cow" });
      var filesBefore = (await JF.Store.files.list()).length;
      await JF.PhotoUpload.attachToAnimal({ animalId: "COW-903", url: hugeDataUrl, kind: "Profile", fileName: "local-only.jpg", category: "Animal" });
      var filesAfter = await JF.Store.files.list();
      var newRow = filesAfter.filter(function (f) { return f.FileName === "local-only.jpg"; })[0];
      ok("PhotoUpload: registers the failed-upload file", filesAfter.length === filesBefore + 1 && !!newRow, filesAfter.length + " files");
      ok("PhotoUpload: never stores raw base64 in the sheet while live", !!newRow && !newRow.LocalURL, newRow ? String(newRow.LocalURL).slice(0, 40) : "no row");
      var cow903 = (await adapter.list("animals")).filter(function (a) { return a.AnimalID === "COW-903"; })[0];
      ok("PhotoUpload: does not set a base64 PhotoURL on the animal", !!cow903 && !cow903.PhotoURL, cow903 ? String(cow903.PhotoURL).slice(0, 40) : "no animal");
      JF.Store.setBackend("mock");
      localStorage.setItem("jf_gas_endpoint", liveBefore === null ? "" : liveBefore);

      /* 10. seed dump (device -> Sheets) */
      var seeded = await adapter.seed({ animals: [{ AnimalID: "COW-902", Name: "Seeded", DateOfBirth: "2025-01-05", CurrentStatus: "Calf", Category: "Calf" }] });
      var cow3 = (await adapter.list("animals")).filter(function (a) { return a.AnimalID === "COW-902"; })[0];
      ok("device -> Sheets upload imports rows", seeded.imported === 1 && !!cow3, JSON.stringify(seeded));
      ok("imported row keeps its date shape", cow3 && cow3.DateOfBirth === "2025-01-05", cow3 && cow3.DateOfBirth);

      /* 11. backup */
      var backup = await adapter.exportBackup();
      ok("backup: writes a JSON snapshot into Drive/Backups", !!backup.fileId && backup.folder === "Backups", JSON.stringify(backup));
      var backupFolder = FARM_FOLDER.children.filter(function (c) { return c.name === "Backups"; })[0];
      ok("backup: file exists in the Backups folder", !!(backupFolder && backupFolder.files.length === 1), backupFolder ? String(backupFolder.files.length) : "0");
      ok("backup: counts records", backup.records >= 4, backup.records);

      /* 12. install the rulebook into the sheets (the real setup order), then verify */
      var seededRules = await adapter.seedRules(JF.RuleBook.seedPayload());
      ok("seedRules: installs the whole rulebook", seededRules.rules.added === 85 && seededRules.parameters.added >= 40,
        JSON.stringify(seededRules.rules) + " / " + JSON.stringify(seededRules.parameters));
      var sheetRules = await adapter.list("rules");
      var sheetParams = await adapter.list("ruleParameters");
      ok("rules sheet: rows round-trip with their columns", sheetRules.length === 85 && sheetParams.length >= 40, sheetRules.length + " rules / " + sheetParams.length + " params");
      var dwRow = sheetRules.filter(function (x) { return x.RuleID === "DW-001"; })[0];
      ok("rules sheet: a rule keeps ParamID / Interval / ReminderBefore", !!dwRow && dwRow.ParamID === "PARAM-008" && String(dwRow.ReminderBefore) === "7", JSON.stringify(dwRow || {}));
      ok("seedRules: second install adds nothing (idempotent)", (await adapter.seedRules(JF.RuleBook.seedPayload())).rules.added === 0);

      /* 12b. upsert mode: pushing a changed rulebook UPDATES the sheet rows */
      var changed = JF.RuleBook.seedPayload();
      var dwChanged = changed.rules.filter(function (r) { return r.RuleID === "DW-001"; })[0];
      dwChanged.ReminderBefore = 13;
      dwChanged.Interval = 120;
      var up1 = await adapter.syncRules(changed);
      ok("syncRules (upsert): reports the rule row as updated", up1.rules.updated === 1, JSON.stringify(up1.rules));
      var dwAfter = (await adapter.list("rules")).filter(function (x) { return x.RuleID === "DW-001"; })[0];
      ok("upsert: sheet row carries the new lead time", dwAfter && String(dwAfter.ReminderBefore) === "13", dwAfter && dwAfter.ReminderBefore);
      ok("upsert: sheet row carries the new interval", dwAfter && String(dwAfter.Interval) === "120", dwAfter && dwAfter.Interval);
      ok("upsert: untouched columns are preserved", dwAfter && dwAfter.ParamID === "PARAM-008" && dwAfter.Category === "Deworming", dwAfter && dwAfter.ParamID);
      ok("upsert: nothing was duplicated", (await adapter.list("rules")).length === 85, (await adapter.list("rules")).length);
      var up2 = await adapter.syncRules(changed);
      ok("upsert: re-push with no changes updates nothing", up2.rules.updated === 0 && up2.rules.added === 0, JSON.stringify(up2.rules));

      /* 12c. sheet-first load: switch the Store to Google mode and re-read */
      localStorage.setItem("jf_gas_endpoint", "https://script.google.com/macros/s/TESTDEPLOYMENT/exec");
      localStorage.setItem("jf_drive_folder_id", FOLDER);
      JF.Store.setBackend("gas");
      await JF.RuleEngine.load();
      var dwRule = JF.RuleEngine.listRules().filter(function (r) { return r.RuleID === "DW-001"; })[0];
      ok("sheet-first load: rule row comes from the sheet (Interval 120)", dwRule && Number(dwRule.Interval) === 120, dwRule && dwRule.Interval);
      await adapter.update("rules", "DW-001", { Active: false });
      await JF.RuleEngine.load();
      var dwRule2 = JF.RuleEngine.listRules().filter(function (r) { return r.RuleID === "DW-001"; })[0];
      ok("sheet-first load: a sheet edit made elsewhere is picked up", dwRule2 && dwRule2.Active === false, dwRule2 && dwRule2.Active);
      await adapter.update("rules", "DW-001", { Active: true });

      /* 12d. write-through: an app-side edit lands in the sheet (Store in gas mode) */
      await JF.RuleEngine.setRuleField("DW-001", "ReminderBefore", 9);
      var dwAfterEdit = (await adapter.list("rules")).filter(function (x) { return x.RuleID === "DW-001"; })[0];
      ok("write-through: app edit reaches the sheet", dwAfterEdit && String(dwAfterEdit.ReminderBefore) === "9", dwAfterEdit && dwAfterEdit.ReminderBefore);
      await JF.RuleEngine.setParamValue("PARAM-008", 120);
      var pAfterEdit = (await adapter.list("ruleParameters")).filter(function (x) { return x.ParameterID === "PARAM-008"; })[0];
      ok("write-through: parameter edit reaches the sheet", pAfterEdit && Number(pAfterEdit.Value) === 120, pAfterEdit && pAfterEdit.Value);
      await JF.RuleEngine.setParamValue("PARAM-008", 90);
      JF.Store.setBackend("mock");
      localStorage.setItem("jf_gas_endpoint", "");

      /* 13. verify endpoint */
      var v = await adapter.verify();
      ok("verify: reports ok", v.ok === true, JSON.stringify(v.checks.filter(function (c) { return !c.ok; })));
      ok("verify: every required check passes", v.checks.filter(function (c) { return c.required !== false; }).every(function (c) { return c.ok; }), JSON.stringify(v.checks));
      ok("verify: sees the installed rule engine", v.checks.some(function (c) { return /rule/i.test(c.check) && c.ok; }), JSON.stringify(v.checks));
      ok("verify: leaves no probe rows behind", (await adapter.list("settings")).filter(function (s) { return s.key === "__healthcheck__"; }).length === 0);

      /* 13. delete + clear */
      await adapter.delete("animals", "COW-901");
      ok("delete removes the row", (await adapter.list("animals")).filter(function (a) { return a.AnimalID === "COW-901"; }).length === 0);
      await adapter.clear();
      ok("clear empties every tab", (await adapter.list("animals")).length === 0 && (await adapter.list("reminders")).length === 0);

      /* 14. wire protocol checks */
      var badFolder = requests.filter(function (r) { return r.body.payload.folderId !== FOLDER; });
      ok("every request carries the configured Drive folder", badFolder.length === 0, badFolder.length + " without folderId");
      var badCt = requests.filter(function (r) { return !/text\/plain/.test(r.contentType || ""); });
      ok("every request uses text/plain (no CORS preflight)", badCt.length === 0, badCt.length + " with another content type");
      // COW-901 is the deliberate oversized-value probe, so exclude that one row.
      var leaks = requests.filter(function (r) {
        if (r.body.action === "uploadFile" || r.body.action === "uploadPhoto") return false;
        var s = JSON.stringify(r.body.payload);
        return /base64,/.test(s) && s.indexOf("COW-901") < 0;
      });
      ok("no base64 photo leaks into non-upload actions", leaks.length === 0, leaks.map(function (r) { return r.body.action; }).join(","));
      ok("unknown actions are rejected cleanly", (function () {
        var res = server.doPost({ postData: { contents: JSON.stringify({ action: "nope", payload: {} }) } });
        var parsed = JSON.parse(res.getContent());
        return parsed.success === false && /Unknown action/.test(parsed.error);
      })());
      out.requestCount = requests.length;
      out.serverFiles = Object.keys(G.files).length;
    } catch (e) {
      out.error = e.message + "\n" + (e.stack || "");
    }
    out.passed = out.asserts.filter(function (a) { return a.ok; }).length;
    out.total = out.asserts.length;
    window.__JF_IT = out;
  })();
})();
</script>
<!--JF-IT-END-->
'@

$harness = $harness.Replace("__JSON__", $json)

$html = [IO.File]::ReadAllText($bundle)
$start = $html.IndexOf("<!--JF-IT-START-->")
if ($start -ge 0) {
  $end = $html.IndexOf("<!--JF-IT-END-->", $start) + "<!--JF-IT-END-->".Length
  $html = $html.Remove($start, $end - $start)
}
$html = $html.Replace("</body>", $harness + "</body>")
[System.IO.File]::WriteAllText($bundle, $html, (New-Object System.Text.UTF8Encoding $false))
Write-Host ("Injected integration harness (" + $harness.Length + " chars) into build/preview.html")
