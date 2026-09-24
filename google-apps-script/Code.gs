/**
 * JAGT FARM - CATTLE FARM MANAGEMENT SYSTEM
 * Google Apps Script (GAS) backend: Google Sheets database + Google Drive storage.
 *
 * Deploy: Extensions are not needed - create a standalone Apps Script project,
 * paste this file, then Deploy > New deployment > Web app
 *   Execute as: Me     Who has access: Anyone
 * Paste the /exec URL into the app (Settings > Google Drive & Sheets).
 *
 * The script works WITHOUT being bound to a spreadsheet: it creates (or reuses)
 * a spreadsheet named CONFIG.SPREADSHEET_NAME and remembers its id in Script
 * Properties. Files are stored inside CONFIG.DRIVE_ROOT_FOLDER_ID (the farm's
 * shared Drive folder) under Animal Photos / Documents / Backups.
 */

const CONFIG = {
  SPREADSHEET_NAME: "Jagt Farm Database",
  // The farm's shared Google Drive folder (root for all uploads).
  DRIVE_ROOT_FOLDER_ID: "1fwov4WjZcVICFEhtUZUUeq9SqXYYqvmB",
  DRIVE_ROOT_FOLDER_NAME: "Jagt Farm",
  PHOTO_FOLDER: "Animal Photos",
  DOC_FOLDER: "Documents",
  BACKUP_FOLDER: "Backups",
  API_TOKEN: "", // optional: set to require a token from the client
  MAX_UPLOAD_BYTES: 8 * 1024 * 1024, // Drive payload guard (base64 ~= 4/3 size)
  MAX_CELL_CHARS: 45000, // Sheets hard limit is 50,000 chars per cell
  LOCK_WAIT_MS: 20000,   // multi-device write guard
};

const ENTITY_SHEETS = [
  "Animals", "Heat", "Insemination", "Pregnancy", "Calving", "Health",
  "Deworming", "Vaccination", "Death", "Purchases", "Sales", "MilkSales", "Expenses",
  "Journal", "Reminders", "Files", "DryOff", "Rules", "Rule_Parameters",
  "Rule_Overrides", "Audit", "Settings", "Groups"
];

// Client entity names -> sheet names (the rule sheets use underscores).
const ENTITY_ALIASES = {
  ruleparameters: "Rule_Parameters",
  ruleoverrides: "Rule_Overrides",
  dryoff: "DryOff",
};

// Column A is always the record id; the rest match the app's field names.
const HEADERS = {
  Animals: ["AnimalID", "TagNumber", "Name", "Species", "Breed", "Gender", "Category", "DateOfBirth", "Color", "IdentificationMarks", "MotherID", "FatherID", "PurchaseDate", "PurchasePrice", "CurrentStatus", "CurrentGroup", "CurrentLocation", "PhotoURL", "LactationStart", "CalvingCount", "LastCalvingDate", "DryOffDate", "PreviousStatus", "Notes", "CreatedAt", "UpdatedAt"],
  Heat: ["HeatRecordID", "AnimalID", "HeatDate", "HeatTime", "DetectionMethod", "HeatIntensity", "Symptoms", "PhotoURL", "Notes", "CreatedAt"],
  Insemination: ["InseminationID", "AnimalID", "HeatRecordID", "Date", "Time", "Method", "SemenID", "SemenBullID", "Technician", "Cost", "Notes", "CreatedAt"],
  Pregnancy: ["PregnancyCheckID", "AnimalID", "InseminationID", "Date", "Method", "Result", "Veterinarian", "Notes", "CreatedAt"],
  Calving: ["CalvingID", "AnimalID", "Date", "Time", "CalvingType", "AssistanceRequired", "Complications", "CalfID", "CalfName", "CalfGender", "CalfWeight", "CalfHealth", "Veterinarian", "PhotoURL", "DocumentURL", "Notes", "CreatedAt"],
  Health: ["HealthRecordID", "AnimalID", "Date", "Problem", "Symptoms", "Diagnosis", "Treatment", "Medicine", "Dose", "Medicines", "Veterinarian", "TreatmentCost", "FollowUpDate", "RecoveryStatus", "Photo", "Prescription", "Notes", "CreatedAt"],
  DryOff: ["DryOffID", "AnimalID", "Date", "ExpectedCalvingDate", "DaysInMilkAtDry", "Reason", "Notes", "CreatedAt"],
  Deworming: ["DewormingID", "AnimalID", "Date", "Medicine", "Dose", "Weight", "Veterinarian", "Cost", "NextDueDate", "Notes", "CreatedAt"],
  Vaccination: ["VaccinationID", "AnimalID", "Vaccine", "DateGiven", "NextDueDate", "BatchNumber", "Veterinarian", "Cost", "Notes", "CreatedAt"],
  Death: ["DeathID", "AnimalID", "Date", "Time", "Cause", "Veterinarian", "EstimatedValue", "Photo", "Document", "Notes", "CreatedAt"],
  Purchases: ["PurchaseID", "Date", "Seller", "AnimalID", "Breed", "Species", "Gender", "Age", "Weight", "PurchasePrice", "TransportationCost", "VeterinaryCheckCost", "OtherCost", "TotalCost", "PaymentMethod", "Document", "Photo", "Notes", "CreatedAt"],
  Sales: ["SaleID", "Date", "AnimalID", "Buyer", "SalePrice", "Transportation", "Commission", "OtherCost", "NetSale", "PaymentMethod", "Reason", "Document", "Photo", "Notes", "CreatedAt"],
  MilkSales: ["MilkSaleID", "Date", "Time", "Shift", "Buyer", "QuantityLitres", "FatPercent", "RatePerLitre", "Amount", "PaymentMethod", "PaymentStatus", "AnimalNotes", "Document", "Notes", "CreatedAt"],
  Expenses: ["ExpenseID", "Date", "Category", "Description", "Amount", "PaymentMethod", "Vendor", "AnimalID", "Reference", "Document", "Notes", "CreatedAt"],
  Journal: ["JournalID", "Date", "ReferenceID", "TransactionType", "Description", "DebitAccount", "CreditAccount", "Amount", "AnimalID", "PaymentMethod", "CreatedBy", "CreatedAt"],
  Reminders: ["ReminderID", "AnimalID", "ReminderType", "ReferenceID", "DueDate", "Time", "ReminderDate", "Priority", "Status", "Source", "RuleID", "Kind", "Group", "ValueSource", "CompletedAt", "Notes", "CreatedAt"],
  Files: ["FileID", "DriveURL", "PageURL", "LocalURL", "AnimalID", "RecordID", "RecordType", "FileName", "Category", "FileType", "UploadDate", "Notes"],
  Audit: ["AuditID", "Timestamp", "Actor", "Action", "Entity", "RecordID", "Details"],
  // ---- Rule engine configuration (edit these rows in the sheet, not the code) ----
  Rules: ["RuleID", "Active", "Category", "RuleName", "AppliesTo", "TriggerEvent", "Condition", "StartAfter", "EndAfter", "Interval", "ReminderBefore", "ActionType", "Action", "Priority", "DataRequired", "DefaultValue", "Unit", "ParamID", "SourceType", "Source", "Configurable", "VetOverride", "Notes"],
  Rule_Parameters: ["ParameterID", "Parameter", "Value", "Unit", "Active", "Notes"],
  Rule_Overrides: ["OverrideID", "RuleID", "AnimalID", "Value", "Unit", "StartDate", "EndDate", "Reason", "ApprovedBy", "Active"],
  Settings: ["id", "key", "value", "UpdatedAt"],
  Groups: ["id", "name", "description", "CreatedAt"]
};

/* ------------------------------------------------------------------ */
/* Storage roots                                                       */
/* ------------------------------------------------------------------ */

function getSpreadsheet() {
  let ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { ss = null; }
  if (ss) return ss;

  const props = PropertiesService.getScriptProperties();
  const savedId = props.getProperty("SPREADSHEET_ID");
  if (savedId) {
    try { return SpreadsheetApp.openById(savedId); } catch (e) { /* fall through and recreate */ }
  }
  ss = SpreadsheetApp.create(CONFIG.SPREADSHEET_NAME);
  props.setProperty("SPREADSHEET_ID", ss.getId());
  return ss;
}

/**
 * Root Drive folder. The client may send its own folder id (Settings > Drive
 * folder); that always wins, so pointing the app at a different farm folder
 * works without redeploying the script.
 */
function getRootFolder(folderId) {
  const id = String(folderId === undefined || folderId === null ? "" : folderId).trim() || CONFIG.DRIVE_ROOT_FOLDER_ID;
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* fall back to name search */ }
  }
  return getOrCreateFolder(CONFIG.DRIVE_ROOT_FOLDER_NAME, null);
}

/** Extract a Drive folder id from either a raw id or a full Drive URL. */
function folderIdFrom(value) {
  const s = String(value || "").trim();
  if (!s) return "";
  const m = s.match(/[-\w]{25,}/);
  return m ? m[0] : s;
}

function scriptTimeZone() {
  try { return Session.getScriptTimeZone(); } catch (e) { return "UTC"; }
}

function getOrCreateFolder(name, parent) {
  const iter = parent ? parent.getFoldersByName(name) : DriveApp.getFoldersByName(name);
  return iter.hasNext() ? iter.next() : (parent ? parent.createFolder(name) : DriveApp.createFolder(name));
}

/** Folder layout: root/Animal Photos/<AnimalID>/ and root/Documents/<Category>/. */
function resolveUploadFolder(payload) {
  const root = getRootFolder(folderIdFrom(payload.folderId));
  const kind = String(payload.kind || "Profile");
  const isDoc = /document|certificate|invoice|purchase|sale|veterinary/i.test(kind);

  if (isDoc) {
    const docs = getOrCreateFolder(CONFIG.DOC_FOLDER, root);
    return getOrCreateFolder(payload.category || kind || "General", docs);
  }
  const photos = getOrCreateFolder(CONFIG.PHOTO_FOLDER, root);
  return getOrCreateFolder(payload.animalId || "General", photos);
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function getSheetName(entity) {
  const key = String(entity || "").toLowerCase();
  const found = ENTITY_SHEETS.find((name) => name.toLowerCase() === key);
  if (found) return found;
  if (ENTITY_ALIASES[key]) return ENTITY_ALIASES[key];
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * Arrays/objects are stored as JSON strings so nothing is silently dropped,
 * and a value too long for a Sheets cell (50,000 chars - a base64 photo would
 * blow the row write up entirely) is truncated instead of failing the write.
 */
function serializeValue(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if (v instanceof Date) return v.toISOString();
    try { return clampCell(JSON.stringify(v)); } catch (e) { return String(v); }
  }
  return clampCell(v);
}

function clampCell(v) {
  // Numbers, booleans and dates must keep their type or every cost, weight and
  // day count in the sheet would become text.
  if (typeof v !== "string") return v;
  if (v.length <= CONFIG.MAX_CELL_CHARS) return v;
  return v.slice(0, 200) + " ...[" + v.length + " chars too long for a cell - the file itself lives in Google Drive]";
}

function deserializeValue(v) {
  if (typeof v === "string" && v.length > 1 && (v.charAt(0) === "[" || v.charAt(0) === "{")) {
    try { return JSON.parse(v); } catch (e) { return v; }
  }
  return v;
}

/**
 * Sheets silently converts "2026-09-01" into a real date value, which would come
 * back to the app as "2026-09-01T00:00:00.000Z" and break every YYYY-MM-DD
 * comparison. Normalise on read so the app always sees the shape it wrote.
 */
function normalizeCellValue(val) {
  if (val instanceof Date) {
    const midnight = val.getHours() === 0 && val.getMinutes() === 0 && val.getSeconds() === 0 && val.getMilliseconds() === 0;
    if (midnight) return Utilities.formatDate(val, scriptTimeZone(), "yyyy-MM-dd");
    return val.toISOString();
  }
  return deserializeValue(val);
}

function responseJSON(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function driveUrls(fileId) {
  return {
    fileId: fileId,
    // Embed-safe URLs for <img src> (anyone-with-link files).
    url: "https://lh3.googleusercontent.com/d/" + fileId + "=w1200",
    thumbUrl: "https://drive.google.com/thumbnail?id=" + fileId + "&sz=w1200",
    pageUrl: "https://drive.google.com/file/d/" + fileId + "/view",
  };
}

/* ------------------------------------------------------------------ */
/* Setup                                                               */
/* ------------------------------------------------------------------ */

function setupSheets() {
  const ss = getSpreadsheet();
  const created = [];
  ENTITY_SHEETS.forEach((sheetName) => {
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) { sheet = ss.insertSheet(sheetName); created.push(sheetName); }
    const cols = HEADERS[sheetName] || ["id", "data", "CreatedAt"];
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight("bold").setBackground("#f0f7f2");
      sheet.setFrozenRows(1);
    } else {
      ensureColumns(sheet, sheetName, {});
    }
  });
  const def = ss.getSheetByName("Sheet1");
  if (def && ss.getSheets().length > 1) { try { ss.deleteSheet(def); } catch (e) {} }
  return created;
}

/** Extend the header row if a record carries fields the sheet does not know yet. */
function ensureColumns(sheet, sheetName, data) {
  const headers = HEADERS[sheetName] || [];
  const extraKeys = Object.keys(data || {}).filter((k) => headers.indexOf(k) === -1 && !/^id$/.test(k));
  let allHeaders = headers;
  if (extraKeys.length) {
    allKeysAppend(headers, extraKeys);
    allHeaders = headers;
  }
  const lastCol = Math.max(sheet.getLastColumn(), 0);
  if (lastCol === 0) {
    sheet.getRange(1, 1, 1, allHeaders.length).setValues([allHeaders]).setFontWeight("bold");
    sheet.setFrozenRows(1);
  } else if (lastCol < allHeaders.length) {
    sheet.getRange(1, lastCol + 1, 1, allHeaders.length - lastCol).setValues([allHeaders.slice(lastCol)]);
  }
  return allHeaders;
}

function allKeysAppend(headers, extraKeys) {
  extraKeys.forEach((k) => headers.push(k));
}

function ensureFolders(folderId) {
  const root = getRootFolder(folderIdFrom(folderId));
  const photos = getOrCreateFolder(CONFIG.PHOTO_FOLDER, root);
  const docs = getOrCreateFolder(CONFIG.DOC_FOLDER, root);
  const backups = getOrCreateFolder(CONFIG.BACKUP_FOLDER, root);
  return {
    root: { name: root.getName(), id: root.getId(), url: root.getUrl() },
    photos: { name: photos.getName(), url: photos.getUrl() },
    documents: { name: docs.getName(), url: docs.getUrl() },
    backups: { name: backups.getName(), url: backups.getUrl() },
  };
}

function statusReport(folderId) {
  let ss, sheetsOk = false, missing = [];
  try {
    ss = getSpreadsheet();
    missing = ENTITY_SHEETS.filter((n) => !ss.getSheetByName(n));
    sheetsOk = missing.length === 0;
  } catch (e) { ss = null; }
  let folder = null;
  const requested = folderIdFrom(folderId) || CONFIG.DRIVE_ROOT_FOLDER_ID;
  try {
    const f = DriveApp.getFolderById(requested);
    folder = { name: f.getName(), id: f.getId(), url: f.getUrl() };
  } catch (e) { folder = { error: "Cannot open Drive folder " + requested, id: requested }; }
  let children = [];
  try {
    const kids = DriveApp.getFolderById(requested).getFolders();
    while (kids.hasNext()) children.push(kids.next().getName());
  } catch (e) { children = []; }
  return {
    status: "online",
    time: new Date().toISOString(),
    timeZone: scriptTimeZone(),
    spreadsheet: ss ? { name: ss.getName(), id: ss.getId(), url: ss.getUrl(), ready: sheetsOk, missingSheets: missing } : { error: "No spreadsheet available" },
    drive: { rootFolder: folder, existingFolders: children },
    rootFolderId: requested,
    entitySheets: ENTITY_SHEETS.length,
    version: "2.2.0",
  };
}

/* ------------------------------------------------------------------ */
/* HTTP entry points                                                   */
/* ------------------------------------------------------------------ */function doGet(e) {
  const folderId = e && e.parameter ? e.parameter.folderId : "";
  return responseJSON({ success: true, data: statusReport(folderId) });
}

/** Serialises writes so two devices (phone + PC) can never clobber a row. */
function withLock(fn) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(CONFIG.LOCK_WAIT_MS); }
  catch (e) { throw new Error("The farm sheet is busy with another device. Please retry in a moment."); }
  try { return fn(); } finally { lock.releaseLock(); }
}

function doPost(e) {
  try {
    let requestData;
    if (e && e.postData && e.postData.contents) requestData = JSON.parse(e.postData.contents);
    else throw new Error("Empty payload");

    const action = requestData.action;
    const payload = requestData.payload || {};
    const token = requestData.token;

    if (CONFIG.API_TOKEN && token !== CONFIG.API_TOKEN) {
      return responseJSON({ success: false, error: "Unauthorized API token" });
    }

    const mutating = ["setup", "create", "update", "delete", "seed", "seedRules", "clear", "verify"];
    const run = () => {
      let result;
      switch (action) {
        case "ping":         result = statusReport(payload.folderId); break;
        case "setup":        setupSheets(); ensureFolders(payload.folderId); result = statusReport(payload.folderId); break;
        case "verify":       result = verifySystem(payload); break;
        case "list":         result = getEntityList(payload.entity); break;
        case "get":          result = getEntityItem(payload.entity, payload.id); break;
        case "create":       result = createEntityItem(payload.entity, payload.data); break;
        case "update":       result = updateEntityItem(payload.entity, payload.id, payload.patch); break;
        case "delete":       result = deleteEntityItem(payload.entity, payload.id); break;
        case "seed":         result = seedAllEntities(payload.data); break;
        case "seedRules":    result = seedRules(payload); break;
        case "clear":        result = clearAllEntities(); break;
        case "uploadFile":   result = uploadFile(payload); break;
        case "uploadPhoto":  result = uploadFile(payload); break;
        case "listFiles":    result = listDriveFiles(payload); break;
        case "exportBackup": result = exportBackup(payload); break;
        default: throw new Error("Unknown action: " + action);
      }
      return result;
    };
    const result = mutating.indexOf(action) >= 0 ? withLock(run) : run();
    return responseJSON({ success: true, data: result });

  } catch (err) {
    return responseJSON({ success: false, error: err.toString() });
  }
}

/* ------------------------------------------------------------------ */
/* Entity CRUD                                                         */
/* ------------------------------------------------------------------ */

function getSheet(entity) {
  const name = getSheetName(entity);
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) { setupSheets(); sheet = ss.getSheetByName(name); }
  return sheet;
}

function getEntityList(entity) {
  const sheet = getSheet(entity);
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];

  const headers = data[0];
  const idKey = headers[0] || "id";
  const items = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row.every((val) => val === "" || val === null)) continue;
    const item = {};
    headers.forEach((h, idx) => {
      if (!h) return;
      item[h] = normalizeCellValue(row[idx]);
    });
    if (item[idKey] !== undefined && item[idKey] !== "") item.id = item[idKey];
    items.push(item);
  }
  return items;
}

function getEntityItem(entity, id) {
  const list = getEntityList(entity);
  const idKey = (HEADERS[getSheetName(entity)] || [])[0] || "id";
  return list.find((item) => String(item[idKey]) === String(id) || String(item.id) === String(id)) || null;
}

function createEntityItem(entity, data) {
  const sheet = getSheet(entity);
  const sheetName = getSheetName(entity);
  const payload = Object.assign({}, data || {});
  const headers = ensureColumns(sheet, sheetName, payload);
  const idKey = headers[0] || "id";

  if (!payload[idKey] && !payload.id) {
    payload[idKey] = entity.toUpperCase().slice(0, 3) + "-" + Date.now();
  }
  if (!payload.id) payload.id = payload[idKey];
  if (!payload.CreatedAt) payload.CreatedAt = new Date().toISOString();

  const row = headers.map((h) => {
    const v = payload[h];
    return v === undefined || v === null ? "" : serializeValue(v);
  });
  sheet.appendRow(row);
  return payload;
}

function updateEntityItem(entity, id, patch) {
  const sheet = getSheet(entity);
  const sheetName = getSheetName(entity);
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return null;

  const headers = ensureColumns(sheet, sheetName, patch || {});
  const rowHeaders = data[0];

  for (let i = 1; i < data.length; i++) {
    const rowId = data[i][0];
    const idIdx = rowHeaders.indexOf("id");
    const altId = idIdx >= 0 ? data[i][idIdx] : "";
    if (String(rowId) === String(id) || String(altId) === String(id)) {
      Object.keys(patch || {}).forEach((h) => {
        const colIdx = headers.indexOf(h);
        if (colIdx >= 0) sheet.getRange(i + 1, colIdx + 1).setValue(serializeValue(patch[h]));
      });
      if (headers.indexOf("UpdatedAt") >= 0) {
        sheet.getRange(i + 1, headers.indexOf("UpdatedAt") + 1).setValue(new Date().toISOString());
      }
      return Object.assign({ id: id }, patch);
    }
  }
  return null;
}

function deleteEntityItem(entity, id) {
  const sheet = getSheet(entity);
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return false;

  const rowHeaders = data[0];
  const idIdx = rowHeaders.indexOf("id");
  for (let i = 1; i < data.length; i++) {
    const rowId = data[i][0];
    const altId = idIdx >= 0 ? data[i][idIdx] : "";
    if (String(rowId) === String(id) || String(altId) === String(id)) {
      sheet.deleteRow(i + 1);
      return true;
    }
  }
  return false;
}

/**
 * Installs the farm's rulebook into the rule sheets.
 *
 * Default mode is add-only: rows that already exist are skipped, so a farm's own
 * edits (intervals, disabled rules, overrides) are never overwritten.
 *
 * payload.upsert = true switches to UPDATE mode: an incoming row that matches an
 * existing id overwrites the stored row field by field (missing fields are kept).
 * This is how a device that has edited its built-in rulebook (or loaded a newer
 * rulebook) pushes those changes into the Sheet, so every other device picks them
 * up on next load.
 */
function seedRules(payload) {
  setupSheets();
  const upsert = payload && payload.upsert === true;
  const install = (entity, list, idKey) => {
    if (!Array.isArray(list) || !list.length) return { added: 0, updated: 0, skipped: 0 };
    const existing = {};
    getEntityList(entity).forEach((row) => { existing[String(row[idKey])] = row; });
    let added = 0, updated = 0, skipped = 0;
    list.forEach((row) => {
      const id = String(row[idKey] === undefined ? "" : row[idKey]);
      if (!id) return;
      const current = existing[id];
      if (current) {
        if (upsert) {
          // Field-level update so columns the payload does not carry are preserved.
          const patch = {};
          Object.keys(row).forEach((k) => {
            if (k === "id" || k === "CreatedAt") return;
            const next = row[k] === undefined || row[k] === null ? "" : row[k];
            const prev = current[k] === undefined || current[k] === null ? "" : current[k];
            if (String(next) !== String(prev)) patch[k] = next;
          });
          if (Object.keys(patch).length) {
            updateEntityItem(entity, id, patch);
            updated++;
          } else {
            skipped++;
          }
        } else {
          skipped++;
        }
        return;
      }
      createEntityItem(entity, row);
      existing[id] = row;
      added++;
    });
    return { added: added, updated: updated, skipped: skipped };
  };
  const rules = install("Rules", payload.rules, "RuleID");
  const params = install("Rule_Parameters", payload.params || payload.parameters, "ParameterID");
  const overrides = install("Rule_Overrides", payload.overrides || [], "OverrideID");
  const active = getEntityList("Rules").filter((r) => String(r.Active).toUpperCase() === "TRUE" || r.Active === true).length;
  return {
    rules: rules, parameters: params, overrides: overrides,
    upsert: upsert,
    totalRules: getEntityList("Rules").length, activeRules: active,
    totalParameters: getEntityList("Rule_Parameters").length,
  };
}

function seedAllEntities(dataObj) {
  setupSheets();
  let count = 0;
  Object.keys(dataObj || {}).forEach((entity) => {
    const list = dataObj[entity];
    if (Array.isArray(list)) list.forEach((item) => { createEntityItem(entity, item); count++; });
  });
  return { imported: count };
}

function clearAllEntities() {
  ENTITY_SHEETS.forEach((sheetName) => {
    const sheet = getSheet(sheetName);
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
  });
  return true;
}

/* ------------------------------------------------------------------ */
/* Drive: uploads, listings, backups                                   */
/* ------------------------------------------------------------------ */

function uploadFile(payload) {
  if (!payload || !payload.base64 || !payload.mimeType) {
    throw new Error("uploadFile requires mimeType + base64");
  }
  const approxBytes = Math.round((payload.base64.length * 3) / 4);
  if (approxBytes > CONFIG.MAX_UPLOAD_BYTES) {
    throw new Error("File too large for Drive upload (" + Math.round(approxBytes / 1048576) + "MB). Please use an image under 8MB.");
  }

  const folder = resolveUploadFolder(payload);
  const name = payload.fileName || ("file-" + Date.now());
  const blob = Utilities.newBlob(Utilities.base64Decode(payload.base64), payload.mimeType, name);
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  const urls = driveUrls(file.getId());

  // Index in the Files sheet so the Document Center lists it.
  try {
    createEntityItem("Files", {
      FileID: "FILE-" + file.getId(),
      DriveURL: urls.pageUrl,
      PageURL: urls.pageUrl,
      LocalURL: urls.url,
      AnimalID: payload.animalId || "",
      RecordID: payload.recordId || payload.animalId || "",
      RecordType: payload.kind || "Profile",
      FileName: name,
      Category: payload.category || (payload.animalId ? "Animal" : "Other"),
      FileType: payload.mimeType,
      UploadDate: new Date().toISOString(),
      Notes: "Stored in Drive: " + folder.getName() + "/" + name,
    });
  } catch (e) { /* non-fatal: the file is saved even if indexing fails */ }

  return Object.assign({ folder: folder.getName() }, urls);
}

function listDriveFiles(payload) {
  const root = getRootFolder(folderIdFrom(payload && payload.folderId));
  const folderName = payload && payload.animalId
    ? getOrCreateFolder(payload.animalId, getOrCreateFolder(CONFIG.PHOTO_FOLDER, root))
    : root;
  const files = folderName.getFiles();
  const out = [];
  while (files.hasNext()) {
    const f = files.next();
    out.push(Object.assign({ name: f.getName(), updated: f.getLastUpdated().toISOString(), size: f.getSize() }, driveUrls(f.getId())));
  }
  return out;
}

/** Write a full JSON snapshot of every sheet into Drive/Backups. */
/* ------------------------------------------------------------------ */
/* Self test (Settings > Verify Sheets & Drive)                        */
/* ------------------------------------------------------------------ */

/**
 * Proves the whole wiring end to end on the real Google account:
 * tabs exist, a row can be written+read+deleted, and a file can be created in
 * the farm's Drive folder (then removed again). Returns per-check results.
 */
function verifySystem(payload) {
  const started = new Date().getTime();
  const checks = [];
  // required=false checks are advisory: they are reported, but they do not make
  // the whole verification fail (e.g. an optional rulebook not installed yet).
  const add = (name, ok, detail, required) => checks.push({ check: name, ok: !!ok, detail: detail || "", required: required !== false });

  let ss = null;
  try { ss = getSpreadsheet(); } catch (e) { ss = null; }
  if (!ss) {
    add("Spreadsheet", false, "Cannot open or create the farm spreadsheet");
  } else {
    let missing = ENTITY_SHEETS.filter((n) => !ss.getSheetByName(n));
    if (missing.length) setupSheets();
    missing = ENTITY_SHEETS.filter((n) => !ss.getSheetByName(n));
    add("Sheet tabs", missing.length === 0,
      (ENTITY_SHEETS.length - missing.length) + "/" + ENTITY_SHEETS.length + " tabs ready" +
      (missing.length ? " - missing: " + missing.join(", ") : ""));
  }

  // Write -> read -> delete, so a read-only or broken sheet is caught.
  let roundTrip = false, rtDetail = "";
  try {
    createEntityItem("settings", { key: "__healthcheck__", value: String(started) });
    const rows = getEntityList("settings").filter((s) => s.key === "__healthcheck__");
    roundTrip = rows.some((s) => String(s.value) === String(started));
    rtDetail = roundTrip ? "wrote a probe row, read it back, removed it" : "probe row could not be read back";
    rows.forEach((row) => { try { deleteEntityItem("settings", row.id); } catch (e) {} });
  } catch (e) { rtDetail = e.toString(); }
  add("Sheets read + write", roundTrip, rtDetail);

  // Rule engine configuration lives in the sheet, so check it exists.
  try {
    const ruleRows = getEntityList("Rules");
    const paramRows = getEntityList("Rule_Parameters");
    const activeRules = ruleRows.filter((r) => String(r.Active).toUpperCase() === "TRUE" || r.Active === true).length;
    add("Rule engine", ruleRows.length > 0 && paramRows.length > 0,
      ruleRows.length + " rules (" + activeRules + " active), " + paramRows.length + " parameters" +
      (ruleRows.length ? "" : " - press Install default rulebook in Settings > Rules"), false);
  } catch (e) { add("Rule engine", false, e.toString(), false); }

  // Drive: resolve the farm folder, create a probe file, share it, delete it.
  const folderId = folderIdFrom(payload && payload.folderId) || CONFIG.DRIVE_ROOT_FOLDER_ID;
  let folder = null, probe = null;
  try {
    folder = DriveApp.getFolderById(folderId);
    add("Drive folder", true, folder.getName() + " (" + folderId + ")");
  } catch (e) {
    add("Drive folder", false, "Cannot open folder " + folderId + " - check the id and that this script has Drive access");
  }
  if (folder) {
    try {
      const sub = getOrCreateFolder(CONFIG.PHOTO_FOLDER, folder);
      probe = sub.createFile(Utilities.newBlob("Jagt Farm health check " + new Date().toISOString(), "text/plain", "healthcheck-" + started + ".txt"));
      probe.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      add("Drive upload", true, "created and shared " + CONFIG.PHOTO_FOLDER + "/" + probe.getName());
    } catch (e) { add("Drive upload", false, e.toString()); }
    if (probe) { try { probe.setTrashed(true); } catch (e) {} }
  }

  return {
    ok: checks.filter((c) => c.required !== false).every((c) => c.ok),
    warnings: checks.filter((c) => c.required === false && !c.ok).map((c) => c.check),
    elapsedMs: new Date().getTime() - started,
    checks: checks,
    folder: folder ? { name: folder.getName(), id: folder.getId(), url: folder.getUrl() } : null,
    spreadsheet: ss ? { name: ss.getName(), url: ss.getUrl() } : null,
    version: "2.2.0",
  };
}

function exportBackup(payload) {
  const snapshot = { generatedAt: new Date().toISOString(), version: "2.2.0", spreadsheet: getSpreadsheet().getUrl(), data: {} };
  ENTITY_SHEETS.forEach((name) => { snapshot.data[name.toLowerCase()] = getEntityList(name); });

  const root = getRootFolder(folderIdFrom(payload && payload.folderId));
  const folder = getOrCreateFolder(CONFIG.BACKUP_FOLDER, root);
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd-HHmm");
  const fileName = "jagtfarm-backup-" + stamp + ".json";
  const blob = Utilities.newBlob(JSON.stringify(snapshot, null, 2), "application/json", fileName);
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return {
    fileName: fileName,
    fileId: file.getId(),
    url: "https://drive.google.com/file/d/" + file.getId() + "/view",
    folder: folder.getName(),
    records: Object.keys(snapshot.data).reduce((n, k) => n + snapshot.data[k].length, 0),
  };
}
