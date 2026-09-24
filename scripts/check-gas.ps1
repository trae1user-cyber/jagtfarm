# Injects a self-test into build/preview.html that compiles google-apps-script/Code.gs
# inside the browser and runs structural checks. Read window.__GAS_CHECK afterwards.
# Rebuilding preview.html removes the injection.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/check-gas.ps1
# NOTE: keep this file ASCII-only (PowerShell 5.1 reads it with the ANSI codepage).
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root "google-apps-script\Code.gs"
$bundle = Join-Path $root "build\preview.html"

$code = [IO.File]::ReadAllText($src)
$json = ConvertTo-Json $code -Compress

$probe = @'
<script>
(function () {
  window.__GAS_SRC = __JSON__;
  var src = window.__GAS_SRC;
  var out = { bytes: src.length, lines: src.split("\n").length };
  try { new Function(src); out.syntax = "OK"; }
  catch (e) { out.syntax = "SYNTAX ERROR: " + e.message; }
  function has(s) { return src.indexOf(s) !== -1; }
  out.checks = {
    rootFolderIdPresent: /DRIVE_ROOT_FOLDER_ID: "[-\w]{20,}"/.test(src),
    rootFolderIsFarmFolder: has("1fwov4WjZcVICFEhtUZUUeq9SqXYYqvmB"),
    ping: has('case "ping"'), setup: has('case "setup"'), list: has('case "list"'),
    get: has('case "get"'), create: has('case "create"'), update: has('case "update"'),
    del: has('case "delete"'), seed: has('case "seed"'), clear: has('case "clear"'),
    uploadFile: has('case "uploadFile"'), listFiles: has('case "listFiles"'),
    exportBackup: has('case "exportBackup"'),
    embedSafeUrl: has("lh3.googleusercontent.com/d/"),
    anyoneWithLink: has("ANYONE_WITH_LINK"),
    standaloneSpreadsheet: has("SpreadsheetApp.create") && has("PropertiesService"),
    jsonRoundTrip: has("serializeValue") && has("deserializeValue"),
    dryOffSheet: has('"DryOff"'),
    guardAgainstUnknownAction: has("Unknown action") || has("unknown action")
  };
  var wanted = ["LactationStart","CalvingCount","LastCalvingDate","DryOffDate","PreviousStatus","Category",
                "PhotoURL","DriveURL","Time","Source","PageURL","DueDate","ReminderDate","ReferenceID",
                "DaysInMilkAtDry","LocalURL","RecordType"];
  out.missingFields = wanted.filter(function (f) { return !has('"' + f + '"'); });
  // Duplicate columns inside one HEADERS entry would silently drop data.
  var dupes = [];
  var block = src.split("HEADERS")[1] || "";
  block.split("\n").forEach(function (line) {
    var m = line.match(/^\s{2}([A-Za-z]+):\s*\[(.*)\]/);
    if (!m) return;
    var seen = {};
    m[2].split(",").forEach(function (c) {
      var col = c.trim().replace(/"/g, "");
      if (!col) return;
      if (seen[col]) dupes.push(m[1] + "." + col);
      seen[col] = 1;
    });
  });
  out.duplicateHeaderColumns = dupes;
  // Every sheet the router can touch must have a HEADERS entry.
  var sheets = [];
  var sre = /ENTITY_SHEETS = \[([^\]]*)\]/.exec(src);
  if (sre) {
    sre[1].split(",").forEach(function (s) {
      var name = s.trim().replace(/["']/g, "");
      if (!name) return;
      sheets.push({ title: name, hasHeaders: new RegExp("\\n  " + name + ":\\s*\\[").test(block) });
    });
  }
  out.sheets = sheets.map(function (s) { return s.title; });
  out.sheetsMissingHeaders = sheets.filter(function (s) { return !s.hasHeaders; }).map(function (s) { return s.title; });
  window.__GAS_CHECK = out;
  return "ok";
})();
</script>
</body>
'@

$probe = $probe.Replace("__JSON__", $json)

# Strip a previous injection so re-runs stay idempotent.
$html = [IO.File]::ReadAllText($bundle)
$marker = '<script>' + [char]10 + '(function () {' + [char]10 + '  window.__GAS_SRC = '
if ($html.Contains($marker)) {
  $start = $html.IndexOf($marker)
  $end = $html.IndexOf("</script>", $start) + "</script>".Length
  $html = $html.Remove($start, $end - $start)
}
$html = $html.Replace("</body>", $probe)
[System.IO.File]::WriteAllText($bundle, $html, (New-Object System.Text.UTF8Encoding $false))
Write-Host ("Injected " + $code.Length + " chars of Code.gs into build/preview.html")
