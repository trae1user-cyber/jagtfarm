# Farm Rule Engine

The farm's rules live in the Google Sheet, not in the code. Entries are saved, matched
against the active rules, and turned into reminders, calculations and alerts — so changing
`90 days` to `120 days`, disabling a vaccine rule or adding a vet override never needs a
code change.

```
ENTRY (app / Sheets)
   ↓
ACTIVE RULES matched against the animal + its own records
   ↓
RULE_PARAMETERS + per-animal RULE_OVERRIDES resolve the real value
   ↓
CALCULATION / REMINDER / ALERT produced (labelled: FACT vs CALCULATION)
   ↓
Dashboard + Reminders + animal timeline + data-quality panel
```

## The three sheets

| Sheet | Purpose |
|---|---|
| **Rules** | One row per rule: what triggers it, how long after, how early to remind, what to do, how important. |
| **Rule_Parameters** | The biological / farm-protocol numbers rules read (`PARAM-001` … `PARAM-042`). Change once, all rules using it follow. |
| **Rule_Overrides** | Per-animal exceptions (e.g. vet says deworm this cow every 60 days). |

### Rules columns

`RuleID · Active · Category · RuleName · AppliesTo · TriggerEvent · Condition · StartAfter ·
EndAfter · Interval · ReminderBefore · ActionType · Action · Priority · DataRequired ·
DefaultValue · Unit · ParamID · SourceType · Source · Configurable · VetOverride · Notes`

Notes on the two columns worth explaining:

- **ParamID** links a rule to the parameter that overrides its `DefaultValue`
  (`Rule default < Rule_Parameters < Rule_Overrides`).
- **EndAfter** closes a rule's window. Newborn tasks (colostrum, navel care) are only
  actionable for a couple of days — without `EndAfter` every older calf would show them
  as permanently overdue.
- **Condition** accepts `FemaleOnly`, `Chronic`, `Vaccine~FMD` (name matching).

### Action types — who carries them out

| ActionType | Handled by | Result |
|---|---|---|
| `REMINDER` | Rule engine | A reminder row (with `RuleID` + provenance) |
| `ALERT` | Rule engine | A reminder at High/Critical priority |
| `CALCULATION` | Rule engine | An informational row labelled `CALCULATION` (e.g. expected calving) |
| `CHECK` | Rule engine | A finding in **Rules → Data Quality** |
| `STATUS` | Lifecycle + cascade layer | Status changes (calving → Lactating, sale → Sold …) |
| `CREATE_EVENT` | Lifecycle + cascade layer | Calf creation, accounting entries |

Rows of type `STATUS` / `CREATE_EVENT` are listed in the sheet for documentation and are
executed by the lifecycle layer, so nothing is applied twice.

## Rule groups installed by default

`AN-` animal master · `CF-` calf/newborn · `DH-` disbudding · `VAC-` vaccination ·
`DW-` deworming · `HE-` heat/estrus · `AI-` insemination · `PG-` pregnancy · `CL-` calving ·
`DR-` dry period · `PC-` post-calving · `HF-` heifer · `HL-` health/treatment ·
`MD-` medicine/withdrawal · `PU-` purchase/quarantine · `SL-` sale · `DT-` death ·
`RM-` reminder lifecycle · `DQ-` data quality. 85 rules, 42 parameters.

Biological values included as **configurable defaults**, not fixed truths: estrous cycle
18/21/24 days, gestation 283 days, dry period 40/50/60 days, disbudding before 8 weeks,
NDDB vaccination ages (FMD from 4 months + booster + 6-monthly, HS/BQ from 6 months,
brucellosis 4–8 months once). Every row carries `SourceType` / `Source` / `VetOverride`, and
wording stays a **review** ("Deworming review due"), never a drug instruction. Withdrawal
periods are only read from what the entry records — the engine never invents them.

## Where rules persist (they survive refreshes)

The Google Sheet is the **home** of the rule configuration. The flow is two-directional:

- **App → Sheet (write-through).** Every edit made in the website — toggling a rule,
  changing a lead time, editing a parameter value, adding or deleting a vet override — is
  written into the `Rules` / `Rule_Parameters` / `Rule_Overrides` tabs **at the moment you
  save it**. There is no separate save step.
- **Sheet → App (sheet-first load).** On boot, and whenever you come back to the tab, the
  app re-reads those tabs. A change typed directly into the sheet, or made on your phone,
  shows up on the PC automatically. Your GitHub-hosted site therefore behaves the same
  after a refresh: it loads its rules from your sheet, not from a fresh copy of the code.
- **First setup.** The first time the app sees empty rule tabs it installs the built-in
  rulebook (85 rules + 42 parameters) into the sheet automatically — one time, after which
  the sheet is authoritative.
- **Install default rulebook** only ever **adds rows that are missing**; your edits are
  never overwritten by an install.
- **Push rules to Google Sheet** (Rules → Rule Engine) explicitly updates the sheet's rows
  from this device — useful after editing while offline, or after loading a newer rulebook.
  It updates field-by-field and keeps any column it does not carry.
- **Offline/local mode.** Without Google connected, the same edits persist in the device's
  local store, and a local mirror keeps the configuration ready to be pushed to the sheet
  the day you connect.

## Reminder lifecycle guarantees

- **Unique**: keyed `RMN-<RuleID>-<AnimalID>`; re-evaluating can never duplicate.
- **Rule disabled** (`Active = FALSE`): stops generating, keeps its history.
- **Rule/parameter changed**: due dates are recomputed on the next evaluation.
- **Entry recorded**: the matching reminder is completed (dewormer entry completes the
  deworming review, FMD dose completes the FMD rule, AI completes heat-without-AI …).
- **Animal sold or deceased**: every open reminder is closed.
- **Deterministic**: the same entries always produce the same reminders.

## In the app

**Rules** (sidebar → Operations → Rules)

- **Install default rulebook** — writes the 85 rules + 42 parameters into the sheets.
  Only adds what is missing; your edits are never overwritten.
- **Reload from Sheets** — re-read the configuration.
- **Push rules to Google Sheet** — update the sheet's rows from this device (update mode;
  nothing is deleted, columns not carried are kept).
- **Re-evaluate all animals** — recompute without deleting anything.
- **Rebuild reminders from entries** — deletes every reminder (manual ones included) and
  regenerates them from the entries on file. Atomic: nothing can interleave.
- **Rules / Parameters / Overrides / Data Quality** tabs — toggle a rule, change a lead
  time, edit a biological value or add a vet override straight from the phone.

**Reminders** — `🔄 Rebuild From Entries` and `🗑 Delete All Reminders` do the same job from
the reminders screen, where it is needed most.

Every reminder explains itself: the rule id, the value used and which layer supplied it
(rule default / farm parameter / animal override).

## Audit

Every engine action (evaluate, rebuild, clear, rule edit, parameter edit, override) is
written to the **Audit** sheet: `AuditID · Timestamp · Actor · Action · Entity · RecordID ·
Details`, so you can always see why the system did something.
