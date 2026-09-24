JF.Views = JF.Views || {};
JF.Views.Settings = (function () {
  const $ = () => document.getElementById("view-container");
  const SUB = {
    general:    { label: "General & Backend", icon: "settings" },
    repro:      { label: "Reproduction",      icon: "heart" },
    health:     { label: "Health Protocols",  icon: "health" },
    accounting: { label: "Accounting",        icon: "finance" },
  };

  const subNav = (active = "general") => {
    const row = JF.Utils.el("div", { class: "tabs", style: { marginBottom: "var(--space-5)" } });
    Object.entries(SUB).forEach(([k, v]) => {
      const a = JF.Utils.el("a", {
        class: `tab ${active === k ? "is-active" : ""}`,
        href: `#settings/${k}`,
        html: `<span style="display:inline-flex;align-items:center;gap:6px;">${JF.Utils.svgIcon(v.icon, 14, 14)} ${v.label}</span>`,
      });
      row.appendChild(a);
    });
    return row;
  };

  const fieldGroup = (eyebrow, title, fields) => JF.Utils.el("div", { class: "card", style: { marginBottom: "var(--space-5)" } }, [
    JF.Utils.el("div", { class: "card__header" }, [
      JF.Utils.el("div", {}, [
        JF.Utils.el("div", { class: "card__eyebrow" }, eyebrow),
        JF.Utils.el("h3", { class: "section__title", style: { margin: 0 } }, title),
      ]),
    ]),
    JF.Utils.el("div", { class: "divider" }),
    JF.Utils.el("div", { class: "form-stack", style: { padding: "var(--space-4)" } }, fields),
  ]);

  /* ---------- Semen / technician availability editor ---------- */
  // Stored in the data store (Google Sheets when connected) via the settings
  // entity, so the Heat Detective reads the same log on every device.
  const availabilityEditor = () => {
    const readAll = async () => { try { return JSON.parse(await JF.Store.settings.get("availability_log")?.value || "[]"); } catch (e) { return []; } };
    const writeAll = async (rows) => { await JF.Store.settings.set("availability_log", JSON.stringify(rows)); };
    const wrap = JF.Utils.el("div", { class: "avail-editor" });
    const redraw = async () => {
      JF.Utils.clear(wrap);
      const rows = await readAll();
      rows.forEach((r, i) => {
        wrap.appendChild(JF.Utils.el("div", { class: "avail-row" }, [
          JF.Utils.el("span", { class: `badge ${r.available ? "badge--success" : "badge--warning"}` }, r.type === "semen" ? "SEMEN" : "TECH"),
          JF.Utils.el("span", {}, `${r.available ? "Available" : "Unavailable"} · ${r.from || "?"} → ${r.to || "?"}`),
          JF.Utils.el("span", { class: "table__cell--muted", style: { flex: 1 } }, r.note || ""),
          JF.Utils.el("button", { class: "btn btn--ghost btn--sm", onclick: async () => { rows.splice(i, 1); await writeAll(rows); redraw(); } }, "Remove"),
        ]));
      });
      if (!rows.length) wrap.appendChild(JF.Utils.el("div", { class: "field__hint" }, "No availability gaps logged yet."));
    };
    const add = async () => {
      const type = document.getElementById("avail-type")?.value || "semen";
      const from = document.getElementById("avail-from")?.value;
      const to = document.getElementById("avail-to")?.value;
      const note = document.getElementById("avail-note")?.value?.trim() || "";
      if (!from || !to) { JF.Toast.show("Pick from and to dates first.", "warning"); return; }
      const rows = await readAll();
      rows.push({ type, available: document.getElementById("avail-state")?.value !== "no", from, to, note });
      await writeAll(rows); await redraw(); JF.Toast.show("Availability window logged.", "success");
    };
    const row = JF.Utils.el("div", { class: "avail-add" }, [
      JF.Utils.el("select", { class: "select", id: "avail-type" }, [
        JF.Utils.el("option", { value: "semen" }, "Semen stock"),
        JF.Utils.el("option", { value: "technician" }, "AI technician"),
      ]),
      JF.Utils.el("select", { class: "select", id: "avail-state" }, [
        JF.Utils.el("option", { value: "no" }, "Unavailable"),
        JF.Utils.el("option", { value: "yes" }, "Available"),
      ]),
      JF.Utils.el("input", { class: "input", type: "date", id: "avail-from" }),
      JF.Utils.el("input", { class: "input", type: "date", id: "avail-to" }),
      JF.Utils.el("input", { class: "input", id: "avail-note", placeholder: "Note (e.g. liquid N2 cylinder empty)" }),
      JF.Utils.el("button", { class: "btn btn--primary btn--sm", onclick: add }, "Add"),
    ]);
    redraw();
    return JF.Utils.el("div", {}, [row, wrap]);
  };

  const renderGeneral = (settingsMap) => {
    const defaultUrl = "";
    const currentBackend = JF.Store.getConfig("backend") || "mock";
    const currentEndpoint = JF.Store.getConfig("gas_endpoint") || defaultUrl;

    const backendSelect = JF.Utils.el("select", { class: "input", id: "cfg-backend" }, [
      JF.Utils.el("option", { value: "mock", selected: currentBackend === "mock" }, "Mock Store (LocalStorage - Local Demo Mode)"),
      JF.Utils.el("option", { value: "gas", selected: currentBackend === "gas" }, "Google Sheets (Google Apps Script Backend)"),
    ]);

    const endpointInput = JF.Utils.el("input", {
      class: "input",
      id: "cfg-gas-endpoint",
      type: "url",
      placeholder: "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec",
      value: currentEndpoint
    });

    // Drive folder that holds photos, documents and backups.
    const defaultFolder = (JF.Data.GasAdapter && JF.Data.GasAdapter.DEFAULT_FOLDER_ID) || "";
    // The input accepts either a raw folder id or a whole pasted Drive link.
    const folderIdOf = (v) => { const m = String(v || "").trim().match(/[-\w]{25,}/); return m ? m[0] : String(v || "").trim(); };
    const currentFolder = folderIdOf(JF.Store.getConfig("drive_folder_id") || defaultFolder);
    const folderInput = JF.Utils.el("input", {
      class: "input",
      id: "cfg-drive-folder",
      placeholder: "Paste your Drive folder link or its ID",
      value: currentFolder,
    });
    const folderLink = JF.Utils.el("a", {
      class: "btn btn--ghost btn--sm",
      href: currentFolder ? `https://drive.google.com/drive/folders/${currentFolder}` : "https://drive.google.com/drive/my-drive",
      target: "_blank", rel: "noopener",
    }, "📂 Open Drive Folder");
    const refreshFolderLink = () => {
      const id = folderIdOf(folderInput.value) || defaultFolder;
      folderLink.href = id ? `https://drive.google.com/drive/folders/${id}` : "https://drive.google.com/drive/my-drive";
    };
    folderInput.addEventListener("change", () => {
      folderInput.value = folderIdOf(folderInput.value);
      refreshFolderLink();
    });

    const livePill = JF.PhotoUpload.backendLive()
      ? JF.Utils.el("span", { class: "badge badge--success", style: "margin-left:8px" }, "LIVE - photos upload to Drive")
      : JF.Utils.el("span", { class: "badge badge--info", style: "margin-left:8px" }, "Offline mode - photos stay on device");

    const statusBadge = JF.Utils.el("div", { id: "gas-status", style: "margin-top:8px;font-size:var(--fs-sm);color:var(--color-ink-500)" });

    const testBtn = JF.Utils.el("button", {
      class: "btn btn--ghost btn--sm",
      type: "button",
      onclick: async () => {
        statusBadge.textContent = "⏳ Testing connection...";
        statusBadge.style.color = "var(--color-ink-500)";
        const url = endpointInput.value.trim();
        if (!url) {
          statusBadge.textContent = "❌ Please enter a valid Google Apps Script Web App URL first.";
          statusBadge.style.color = "var(--color-oxblood-700)";
          return;
        }
        try {
          const adapter = new JF.Data.GasAdapter();
          adapter.configure({ endpoint: url });
          const ping = await adapter.testConnection();
          statusBadge.textContent = `✅ Connection Successful! Server status: ${ping?.status || "online"}`;
          statusBadge.style.color = "var(--color-success-700)";
          JF.Toast?.show("Connected to Google Sheets backend!", "success");
        } catch (err) {
          statusBadge.textContent = `❌ Connection failed: ${err.message}`;
          statusBadge.style.color = "var(--color-oxblood-700)";
          JF.Toast?.show("Could not connect to Google Apps Script URL.", "danger");
        }
      }
    }, "⚡ Test Connection");

    // Uploads THIS device's real records (never demo data) into Google Sheets.
    const uploadLocalBtn = JF.Utils.el("button", {
      class: "btn btn--accent btn--sm",
      type: "button",
      onclick: async () => {
        const url = endpointInput.value.trim();
        if (!url) {
          JF.Toast?.show("Paste your Apps Script Web App URL first.", "danger");
          return;
        }
        if (!confirm("Copy every record stored on this device into Google Sheets?\n\nExisting rows with the same id are kept as-is; nothing is deleted.")) return;
        statusBadge.textContent = "⏳ Reading this device's records...";
        statusBadge.style.color = "var(--color-ink-500)";
        try {
          const local = new JF.Data.MockAdapter();
          const dump = {};
          let total = 0;
          for (const entity of JF.Data.DataAdapter.entities) {
            const rows = await local.list(entity);
            if (rows.length) { dump[entity] = rows; total += rows.length; }
          }
          if (!total) { statusBadge.textContent = "This device has no records to upload yet."; return; }
          statusBadge.textContent = `⏳ Uploading ${total} records across ${Object.keys(dump).length} sheets...`;
          const adapter = new JF.Data.GasAdapter();
          adapter.configure({ endpoint: url, folderId: folderIdOf(folderInput.value) });
          const res = await adapter.seed(dump);
          statusBadge.textContent = `✅ Uploaded ${res?.imported ?? total} records to Google Sheets.`;
          statusBadge.style.color = "var(--color-success-700)";
          JF.Toast?.show("Farm data uploaded to Google Sheets.", "success");
        } catch (err) {
          statusBadge.textContent = `❌ Upload failed: ${err.message}`;
          statusBadge.style.color = "var(--color-oxblood-700)";
        }
      }
    }, "📤 Upload This Device's Data to Sheets");

    const verifyBtn = JF.Utils.el("button", {
      class: "btn btn--primary btn--sm",
      type: "button",
      onclick: async () => {
        const url = endpointInput.value.trim();
        if (!url) { JF.Toast?.show("Paste your Apps Script Web App URL first.", "danger"); return; }
        statusBadge.textContent = "⏳ Checking Sheets tabs, a real row write, and a Drive upload...";
        statusBadge.style.color = "var(--color-ink-500)";
        try {
          const adapter = new JF.Data.GasAdapter();
          adapter.configure({ endpoint: url, folderId: folderIdOf(folderInput.value) });
          const r = await adapter.verify();
          const lines = (r.checks || []).map((c) => `${c.ok ? "✅" : "❌"} <b>${c.check}</b> — ${c.detail}`);
          statusBadge.innerHTML = `${r.ok ? "✅ Everything is wired up" : "⚠️ Some checks failed"} (${r.elapsedMs} ms)<br>${lines.join("<br>")}` +
            (r.spreadsheet ? `<br>Sheet: <a href="${r.spreadsheet.url}" target="_blank" rel="noopener">${r.spreadsheet.name}</a>` : "") +
            (r.folder ? ` · Drive: <a href="${r.folder.url}" target="_blank" rel="noopener">${r.folder.name}</a>` : "");
          statusBadge.style.color = r.ok ? "var(--color-success-700)" : "var(--color-oxblood-700)";
          JF.Toast?.show(r.ok ? "Sheets & Drive verified." : "Verification found problems - see details.", r.ok ? "success" : "warning");
        } catch (err) {
          statusBadge.textContent = `❌ Verification failed: ${err.message}`;
          statusBadge.style.color = "var(--color-oxblood-700)";
        }
      }
    }, "🩺 Verify Sheets & Drive");

    const setupBtn = JF.Utils.el("button", {
      class: "btn btn--accent btn--sm",
      type: "button",
      onclick: async () => {
        const url = endpointInput.value.trim();
        if (!url) { statusBadge.textContent = "❌ Paste your Apps Script Web App URL first (see the setup guide)."; statusBadge.style.color = "var(--color-oxblood-700)"; return; }
        statusBadge.textContent = "⏳ Creating sheets and Drive folders...";
        statusBadge.style.color = "var(--color-ink-500)";
        try {
          const adapter = new JF.Data.GasAdapter();
          adapter.configure({ endpoint: url, folderId: folderInput.value.trim() });
          const st = await adapter.setup();
          JF.Store.setConfig("gas_endpoint", url);
          statusBadge.innerHTML = `✅ Ready — spreadsheet <a href="${st.spreadsheet.url}" target="_blank" rel="noopener">${st.spreadsheet.name}</a>, Drive folder <b>${(st.drive && st.drive.root && st.drive.root.name) || "-"}</b> with Animal Photos / Documents / Backups.`;
          statusBadge.style.color = "var(--color-success-700)";
          JF.Toast?.show("Google Sheets & Drive are set up.", "success");
        } catch (err) {
          statusBadge.textContent = `❌ Setup failed: ${err.message}`;
          statusBadge.style.color = "var(--color-oxblood-700)";
        }
      }
    }, "🧩 Set Up Sheets & Drive");

    const backupBtn = JF.Utils.el("button", {
      class: "btn btn--ghost btn--sm",
      type: "button",
      onclick: async () => {
        const url = endpointInput.value.trim();
        if (!url) { JF.Toast?.show("Connect Google before making a Drive backup.", "warning"); return; }
        statusBadge.textContent = "⏳ Writing a backup of every sheet into Drive...";
        try {
          const adapter = new JF.Data.GasAdapter();
          adapter.configure({ endpoint: url, folderId: folderInput.value.trim() });
          const b = await adapter.exportBackup();
          statusBadge.innerHTML = `✅ Backup saved: <a href="${b.url}" target="_blank" rel="noopener">${b.fileName}</a> (${b.records} records) in Drive/${b.folder}.`;
          statusBadge.style.color = "var(--color-success-700)";
        } catch (err) {
          statusBadge.textContent = `❌ Backup failed: ${err.message}`;
          statusBadge.style.color = "var(--color-oxblood-700)";
        }
      }
    }, "💾 Backup All Sheets to Drive");

    // Data safety: the old one-click "Start Fresh - Erase All Farm Data" button was
    // REMOVED on purpose - your farm's records live in Google Sheets and must never
    // be wipeable from a single mis-tap. If you ever truly need a wipe, do it from
    // the Google Sheet itself (File > Settings > delete rows), where Google's own
    // version history can bring it back.

    const demoBtn = JF.Utils.el("button", {
      class: "btn btn--ghost btn--sm",
      type: "button",
      onclick: async () => {
        if (!confirm("Replace current data with the full demo farm (23 animals with sample history)?")) return;
        JF.Store.setConfig("demo_data", "1");
        JF.Store.forceReseed();
        setTimeout(() => location.reload(), 100);
      }
    }, "Load Demo Farm Data");

    return [
      fieldGroup("📊 ACTIVE BACKEND & GOOGLE SHEETS INTEGRATION", "Database & Storage Configuration", [
        JF.Utils.el("div", { class: "field" }, [
          JF.Utils.el("label", { class: "field__label" }, "Active Data Store"),
          backendSelect,
          JF.Utils.el("div", { class: "field__hint" }, "Choose whether the app runs entirely offline with local storage or syncs live to Google Sheets via Google Apps Script."),
        ]),
        JF.Utils.el("div", { class: "field" }, [
          JF.Utils.el("label", { class: "field__label" }, "Google Apps Script Web App Deployment URL"),
          endpointInput,
          livePill,
          JF.Utils.el("div", { class: "field__hint" }, "Deploy Code.gs in your Google Apps Script project as a Web App (Execute as: Me, Access: Anyone) and paste the URL here. When live, animal photos upload straight to your Google Drive farm folder."),
          statusBadge
        ]),
        JF.Utils.el("div", { class: "field" }, [
          JF.Utils.el("label", { class: "field__label" }, "Google Drive Folder (photos, documents, backups)"),
          folderInput,
          JF.Utils.el("div", { class: "field__hint" },
            "Paste your Drive folder link (or just its ID) - the app extracts the id automatically. Photos land in Animal Photos/<AnimalID>/, documents in Documents/<Category>/, backups in Backups/ - all inside this folder."),
        ]),
        JF.Utils.el("div", { style: "display:flex;gap:12px;flex-wrap:wrap;margin-top:12px;" }, [
          testBtn,
          setupBtn,
          verifyBtn,
          folderLink,
          backupBtn,
        ]),
        JF.Utils.el("div", { style: "display:flex;gap:12px;flex-wrap:wrap;margin-top:8px;" }, [
          uploadLocalBtn,
          demoBtn
        ]),
        JF.Utils.el("div", { class: "field__hint", style: "margin-top:10px" },
          "🔒 Data safety: there is no one-click erase in the app by design - your records belong in Google Sheets, where Google's version history protects them. Load Demo Farm replaces this device's data with the sample farm (it asks first)."),
        JF.Utils.el("div", { class: "field__hint", style: "margin-top:10px;color:var(--color-success-700)" },
          "💡 Your rules persist in Google Sheets: rule toggles, lead times, parameters and vet overrides are written to the Rules / Rule_Parameters / Rule_Overrides tabs the moment you change them in the app. After a refresh or on another device they load from the sheet, so phone and PC always agree. On first setup the default rulebook is installed into the sheet automatically; 'Install default rulebook' only ever adds rows that are missing.")
      ]),
      fieldGroup("🏠 FARM INFORMATION", "Farm & System Defaults", [
        JF.Utils.el("div", { class: "grid grid--cols-2" }, [
          JF.Utils.el("div", { class: "field" }, [
            JF.Utils.el("label", { class: "field__label" }, "Farm Name"),
            JF.Utils.el("input", { class: "input", id: "cfg-farm-name", value: settingsMap["farm_name"] || "Jagt Farm" }),
          ]),
          JF.Utils.el("div", { class: "field" }, [
            JF.Utils.el("label", { class: "field__label" }, "Currency Symbol"),
            JF.Utils.el("input", { class: "input", id: "cfg-currency", value: settingsMap["currency"] || "₹" }),
          ]),
        ])
      ])
    ];
  };

  const renderRepro = (settingsMap) => [
    fieldGroup("🕵 LOGISTICS AVAILABILITY", "Semen & Technician Availability Log", [
      JF.Utils.el("div", { class: "field__hint", style: { marginBottom: "var(--space-3)" } },
        "Log when semen or the AI technician was unavailable. The Heat Detective overlays these gaps on the biology timeline so you can see which heats were missed for farm reasons, not biology."),
      availabilityEditor(),
    ]),
    fieldGroup("🔄 HEAT CYCLE PARAMETERS", "Smart Heat & Gestation Intervals", [
      JF.Utils.el("div", { class: "grid grid--cols-3" }, [
        JF.Utils.el("div", { class: "field" }, [
          JF.Utils.el("label", { class: "field__label" }, "Expected Cycle Length (Days)"),
          JF.Utils.el("input", { class: "input", type: "number", id: "cfg-expected-cycle", value: settingsMap["ExpectedCycleLength"] || "21" }),
          JF.Utils.el("div", { class: "field__hint" }, "Standard cattle heat cycle (default 21 days)"),
        ]),
        JF.Utils.el("div", { class: "field" }, [
          JF.Utils.el("label", { class: "field__label" }, "Minimum Cycle Length (Days)"),
          JF.Utils.el("input", { class: "input", type: "number", id: "cfg-min-cycle", value: settingsMap["MinimumCycleLength"] || "18" }),
        ]),
        JF.Utils.el("div", { class: "field" }, [
          JF.Utils.el("label", { class: "field__label" }, "Maximum Cycle Length (Days)"),
          JF.Utils.el("input", { class: "input", type: "number", id: "cfg-max-cycle", value: settingsMap["MaximumCycleLength"] || "24" }),
        ]),
      ]),
      JF.Utils.el("div", { class: "grid grid--cols-2" }, [
        JF.Utils.el("div", { class: "field" }, [
          JF.Utils.el("label", { class: "field__label" }, "Heat Reminder Lead Time (Days Before)"),
          JF.Utils.el("input", { class: "input", type: "number", id: "cfg-heat-lead", value: settingsMap["ReminderDaysBefore"] || "3" }),
        ]),
        JF.Utils.el("div", { class: "field" }, [
          JF.Utils.el("label", { class: "field__label" }, "Gestation Period (Days)"),
          JF.Utils.el("input", { class: "input", type: "number", id: "cfg-gestation", value: settingsMap["GestationDays"] || "283" }),
        ]),
      ])
    ])
  ];

  const renderHealth = (settingsMap) => [
    fieldGroup("🩺 PREVENTATIVE PROTOCOLS", "Deworming & Vaccination Intervals", [
      JF.Utils.el("div", { class: "grid grid--cols-2" }, [
        JF.Utils.el("div", { class: "field" }, [
          JF.Utils.el("label", { class: "field__label" }, "Standard Deworming Interval (Days)"),
          JF.Utils.el("input", { class: "input", type: "number", id: "cfg-deworm-int", value: settingsMap["DewormingIntervalDays"] || "90" }),
          JF.Utils.el("div", { class: "field__hint" }, "Default interval between routine dewormings (default 90 days)"),
        ]),
        JF.Utils.el("div", { class: "field" }, [
          JF.Utils.el("label", { class: "field__label" }, "Deworming Reminder Lead (Days Before)"),
          JF.Utils.el("input", { class: "input", type: "number", id: "cfg-deworm-lead", value: settingsMap["DewormingReminderBefore"] || "7" }),
        ]),
        JF.Utils.el("div", { class: "field" }, [
          JF.Utils.el("label", { class: "field__label" }, "Vaccination Reminder Lead (Days Before)"),
          JF.Utils.el("input", { class: "input", type: "number", id: "cfg-vax-lead", value: settingsMap["VaccinationReminderBefore"] || "7" }),
        ]),
      ]),
    ]),
    fieldGroup("BABY CALF CARE PLAN", "Automatic Reminders for Young Calves", [
      JF.Utils.el("div", { class: "field__hint", style: { marginBottom: "var(--space-3)" } },
        "When a calf is born (or you record its birth), these reminders are created automatically and tick themselves off as you record each dewormer or vaccine."),
      JF.Utils.el("div", { class: "grid grid--cols-3" }, [
        JF.Utils.el("div", { class: "field" }, [
          JF.Utils.el("label", { class: "field__label" }, "First dewormer (age in days)"),
          JF.Utils.el("input", { class: "input", type: "number", id: "cfg-calf-deworm1", value: settingsMap["CalfFirstDewormAgeDays"] || "14" }),
        ]),
        JF.Utils.el("div", { class: "field" }, [
          JF.Utils.el("label", { class: "field__label" }, "Second dewormer (age in days)"),
          JF.Utils.el("input", { class: "input", type: "number", id: "cfg-calf-deworm2", value: settingsMap["CalfSecondDewormAgeDays"] || "45" }),
        ]),
        JF.Utils.el("div", { class: "field" }, [
          JF.Utils.el("label", { class: "field__label" }, "Remind me before (days)"),
          JF.Utils.el("input", { class: "input", type: "number", id: "cfg-calf-lead", value: settingsMap["CalfCareRemindLeadDays"] || "7" }),
        ]),
        JF.Utils.el("div", { class: "field" }, [
          JF.Utils.el("label", { class: "field__label" }, "FMD vaccine (age in days)"),
          JF.Utils.el("input", { class: "input", type: "number", id: "cfg-calf-fmd", value: settingsMap["CalfFMDAgeDays"] || "90" }),
        ]),
        JF.Utils.el("div", { class: "field" }, [
          JF.Utils.el("label", { class: "field__label" }, "Brucellosis - females (age in days)"),
          JF.Utils.el("input", { class: "input", type: "number", id: "cfg-calf-bruc", value: settingsMap["CalfBrucellaAgeDays"] || "150" }),
        ]),
        JF.Utils.el("div", { class: "field" }, [
          JF.Utils.el("label", { class: "field__label" }, "BQ & HS vaccines (age in days)"),
          JF.Utils.el("input", { class: "input", type: "number", id: "cfg-calf-bq", value: settingsMap["CalfBQAgeDays"] || "180" }),
        ]),
      ]),
    ])
  ];

  const renderAccounting = (settingsMap) => [
    fieldGroup("💰 FINANCIAL CONFIGURATION", "Accounting Preferences", [
      JF.Utils.el("div", { class: "grid grid--cols-2" }, [
        JF.Utils.el("div", { class: "field" }, [
          JF.Utils.el("label", { class: "field__label" }, "Financial Year Start Month"),
          JF.Utils.el("select", { class: "input", id: "cfg-fy-start" }, [
            JF.Utils.el("option", { value: "April", selected: (settingsMap["fy_start"] || "April") === "April" }, "April (FY Apr-Mar)"),
            JF.Utils.el("option", { value: "January", selected: settingsMap["fy_start"] === "January" }, "January (Calendar Year)"),
          ]),
        ]),
        JF.Utils.el("div", { class: "field" }, [
          JF.Utils.el("label", { class: "field__label" }, "Default Payment Account"),
          JF.Utils.el("select", { class: "input", id: "cfg-default-pay" }, [
            JF.Utils.el("option", { value: "Cash" }, "Cash Account"),
            JF.Utils.el("option", { value: "Bank" }, "Bank Account"),
          ]),
        ]),
      ])
    ])
  ];

  const saveSettings = async () => {
    try {
      const bSel = document.getElementById("cfg-backend");
      const urlIn = document.getElementById("cfg-gas-endpoint");
      if (bSel) {
        const backendVal = bSel.value;
        JF.Store.setConfig("backend", backendVal);
        JF.Store.setBackend(backendVal);
      }
      const folderIn = document.getElementById("cfg-drive-folder");
      const folderVal = folderIn ? folderIn.value.trim() : null;
      if (urlIn || folderVal !== null) {
        const urlVal = urlIn ? urlIn.value.trim() : (JF.Store.getConfig("gas_endpoint") || "");
        if (urlIn) JF.Store.setConfig("gas_endpoint", urlVal);
        const folderId = folderVal ? (String(folderVal).match(/[-\w]{25,}/) || [folderVal])[0] : "";
        if (folderVal !== null) JF.Store.setConfig("drive_folder_id", folderId);
        JF.Store.setGasEndpoint({ endpoint: urlVal, folderId: folderId || undefined });
      }

      const pairs = [
        ["farm_name", document.getElementById("cfg-farm-name")?.value],
        ["currency", document.getElementById("cfg-currency")?.value],
        ["ExpectedCycleLength", document.getElementById("cfg-expected-cycle")?.value],
        ["MinimumCycleLength", document.getElementById("cfg-min-cycle")?.value],
        ["MaximumCycleLength", document.getElementById("cfg-max-cycle")?.value],
        ["ReminderDaysBefore", document.getElementById("cfg-heat-lead")?.value],
        ["GestationDays", document.getElementById("cfg-gestation")?.value],
        ["DewormingIntervalDays", document.getElementById("cfg-deworm-int")?.value],
        ["DewormingReminderBefore", document.getElementById("cfg-deworm-lead")?.value],
        ["VaccinationReminderBefore", document.getElementById("cfg-vax-lead")?.value],
        ["CalfFirstDewormAgeDays", document.getElementById("cfg-calf-deworm1")?.value],
        ["CalfSecondDewormAgeDays", document.getElementById("cfg-calf-deworm2")?.value],
        ["CalfCareRemindLeadDays", document.getElementById("cfg-calf-lead")?.value],
        ["CalfFMDAgeDays", document.getElementById("cfg-calf-fmd")?.value],
        ["CalfBrucellaAgeDays", document.getElementById("cfg-calf-bruc")?.value],
        ["CalfBQAgeDays", document.getElementById("cfg-calf-bq")?.value],
      ];

      for (const [k, v] of pairs) {
        if (v !== undefined && v !== null) {
          await JF.Store.settings.set(k, v);
        }
      }

      JF.Toast?.show("Settings saved successfully!", "success");
    } catch (e) {
      console.error(e);
      JF.Toast?.show("Error saving settings", "danger");
    }
  };

  const render = async (path = "") => {
    const root = $();
    const sub = path?.[1] || "general";
    JF.Utils.clear(root);

    let settingsMap = {};
    try {
      settingsMap = await JF.Store.settings.allMap();
    } catch (e) { console.warn(e); }

    const page = JF.Utils.el("div", { class: "page" });
    page.appendChild(JF.Utils.el("div", { class: "page__head-row" }, [
      JF.Utils.el("div", {}, [
        JF.Utils.el("div", { class: "eyebrow" }, "⚙️ System Configuration"),
        JF.Utils.el("h1", { class: "page__title", style: { marginTop: "8px" } }, SUB[sub]?.label || "General"),
        JF.Utils.el("p", { class: "page__sub", style: { marginTop: "var(--space-2)" } },
          "Configure heat cycle parameters, health protocols, accounting settings, and backend database connections."),
      ]),
      JF.Utils.el("div", { class: "page__actions" }, [
        JF.Utils.el("button", {
          class: "btn btn--primary btn--sm",
          onclick: saveSettings
        }, "Save Settings"),
      ]),
    ]));

    page.appendChild(subNav(sub));

    let content = [];
    if (sub === "repro") content = renderRepro(settingsMap);
    else if (sub === "health") content = renderHealth(settingsMap);
    else if (sub === "accounting") content = renderAccounting(settingsMap);
    else content = renderGeneral(settingsMap);

    content.forEach(el => page.appendChild(el));
    root.appendChild(page);
  };

  return { render };
})();
