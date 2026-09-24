# Jagt Farm - Google Sheets + Google Drive setup

The app runs fully offline, but when you connect it, **every record lives in one Google
Spreadsheet and every photo/file lives in one Google Drive folder**. Do this once
(~10 minutes) and both your phone and your PC see the same farm.

- Drive folder used by the app: <https://drive.google.com/drive/folders/1fwov4WjZcVICFEhtUZUUeq9SqXYYqvmB>
- Folder id (already pre-filled in the app): `1fwov4WjZcVICFEhtUZUUeq9SqXYYqvmB`

---

## 1. Create the Apps Script project

1. Open <https://script.google.com> -> **New project**.
2. Delete the sample `myFunction`, then paste the whole contents of
   `google-apps-script/Code.gs` from this repo.
3. Rename the project to `Jagt Farm Backend`.

## 2. Deploy it as a Web App

1. **Deploy** -> **New deployment** -> **Web app**.
2. **Execute as: Me** - **Who has access: Anyone**.
3. **Deploy**, approve the permission prompts (Sheets + Drive), and copy the `/exec` URL.

> Anyone-with-access is required because the app has no login: it posts JSON to that URL.
> Optional hardening: set `CONFIG.API_TOKEN` in Code.gs to a secret string, then put the
> same string in `localStorage` as `jf_gas_token`. Without a token the URL is open, so
> keep it private.

## 3. Connect the app (Settings -> General)

1. **Active Data Store**: choose `Google Sheets (Google Apps Script Backend)`.
2. **Apps Script URL**: paste the `/exec` URL.
3. **Google Drive Folder**: paste the folder link (or just its id) - a full
   `https://drive.google.com/drive/folders/...` link is accepted and reduced to the id
   automatically. Your farm folder is pre-filled.
4. **🧩 Set Up Sheets & Drive** - creates the spreadsheet, all 23 tabs and the Drive
   folders. Shows the spreadsheet link when it is ready.
5. **🩺 Verify Sheets & Drive** - the real proof: it writes a probe row and reads it back,
   then creates and removes a file in your Drive folder. Every check shows ✅ or ❌ with a
   reason.
6. **Save Settings**.

### Getting existing records into Sheets

- **📤 Upload This Device's Data to Sheets** copies the records currently on this device
  into the sheet (nothing is deleted, existing rows are kept).
- **💾 Backup All Sheets to Drive** writes `Backups/jagtfarm-backup-<stamp>.json`.
- **Rules persist automatically.** The first **Set Up** installs the default rulebook into
  the `Rules` / `Rule_Parameters` / `Rule_Overrides` tabs. From then on every edit made in
  the website (rule on/off, lead times, parameters, vet overrides) is written back into
  those tabs at the moment you save it, and the app re-reads them on load and whenever you
  return to the tab — so your rules survive refreshes and are shared by phone and PC.
  **Rules → Rule Engine → ⬆️ Push rules to Google Sheet** updates the sheet's rows from the
  current device explicitly (field-by-field, nothing deleted).

> The spreadsheet is created automatically by the script - you do not need to make one by
> hand, and the script works whether or not it is bound to a spreadsheet. Its id is stored
> in the script's Properties, so re-deploying does not lose your data.

## 4. Where things are stored

```
Google Drive  ->  1fwov4WjZcVICFEhtUZUUeq9SqXYYqvmB  (your farm folder)
├─ Animal Photos/<AnimalID>/<file>     animal photos (profile, ID, event shots)
├─ Documents/<Category>/<file>          bills, certificates, vet papers
└─ Backups/jagtfarm-backup-<stamp>.json full JSON snapshot of every tab

Google Sheets  ->  "Jagt Farm Database" (created automatically)
├─ Animals, Heat, Insemination, Pregnancy, Calving, Health, Deworming,
│  Vaccination, Death, Purchases, Sales, Expenses, Journal, Reminders,
│  Files, DryOff, Settings, Groups
```

Every upload is shared **anyone-with-link (view)** and indexed in the **Files** tab, so the
Document Center and animal profiles show the real image on every device.

## 5. How the app talks to the backend

- `POST` with `Content-Type: text/plain` (avoids the CORS preflight Apps Script cannot
  answer) and body `{ action, payload, token }`.
- Actions: `ping | setup | verify | list | get | create | update | delete | seed | clear |
  uploadFile | uploadPhoto | listFiles | exportBackup`.
- Response is always `{ success: true, data }` or `{ success: false, error }`.
- Every request carries `payload.folderId`, so changing the Drive folder in Settings takes
  effect immediately with no redeploy.
- Writes are wrapped in `LockService`, so two devices saving at the same moment cannot
  clobber each other. If the sheet is busy the app reports it and you retry.
- Sheets converts `2026-09-01` into a real date value; the backend converts it back to
  `YYYY-MM-DD` on read so the app's date logic keeps working.

## 6. Photos and the 50,000 character cell limit

A base64 photo is far too big for a Sheets cell (the hard limit is 50,000 characters per
cell), so:

- when the backend is live, only real Drive links are ever written (`DriveURL` = page link,
  `LocalURL` = embed link, `PhotoURL` = embed link). A raw base64 image is never persisted;
- the backend clamps any oversized value as a last-resort guard instead of failing the row
  write;
- if a Drive upload fails, the app tells you and keeps the copy on the device instead of
  corrupting the sheet.

Embed-safe image URL: `https://lh3.googleusercontent.com/d/<fileId>=w1200`
Friendly link: `https://drive.google.com/file/d/<fileId>/view`

## 7. Troubleshooting

| Symptom | Fix |
| --- | --- |
| `No Apps Script URL configured yet` | Paste the `/exec` URL and Save. |
| `Authorization is required` on first call | In the Apps Script editor run `setupSheets` once manually and approve permissions. |
| `Cannot open Drive folder <id>` | The folder id is wrong, or the script account has no access to it. Open the folder as that account and re-copy the link. |
| Uploads fail with `File too large` | Images are compressed to 1024px before upload; keep documents under 8 MB. |
| Sheet looks empty after switching backend | Press **🧩 Set Up Sheets & Drive**, then **🩺 Verify Sheets & Drive** to see which step fails. |
| `The farm sheet is busy with another device` | A concurrent write; try again in a second. |
