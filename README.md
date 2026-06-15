# AIPaper Sync

AIPaper Sync is a small Windows program that automatically retrieves the contents of your **Viewood AIPaper** tablet and copies them to your computer — entirely over your local network, without using the Internet.

---

## What it does

- It sits quietly in the **system tray** (bottom-right corner of your screen, near the clock) and runs in the background.
- It connects to your tablet **over your local Wi-Fi network** — no data ever leaves your home or office network.
- It copies all your notebooks (Paper, Daily, Meeting, Learning, Picking, Memo) into a folder of your choice on your PC.
- If a file already exists, it is **replaced with the latest version** from the tablet.
- **Incremental sync** — unchanged files are detected using the tablet's own timestamps. If nothing has changed in a notebook since the last sync, the download is skipped entirely, saving time and bandwidth.
- If you manually delete local files, the next sync automatically re-downloads them even if the tablet reports no changes.
- It keeps a history of every file copied or replaced.

---

## Installation

### For regular users — installer (recommended)

1. Download the file **`AIPaper Sync Setup 1.x.x.exe`** from whoever shared this program with you.
2. Double-click it and follow the on-screen steps.
3. Once installed, AIPaper Sync will appear in your Start menu and will start automatically with Windows.

That's all — no technical knowledge required.

> The installer is generated from the source code using the instructions in the [For developers](#for-developers) section below.

---

### For developers — running from source

If you want to modify the program or build the installer yourself, you will need:

- **Node.js version 18 or newer** — download from [nodejs.org](https://nodejs.org) (LTS version)
- **Git** (optional, to clone the repository)

**Run in development mode:**

```
npm install
npm start
```

**Build the Windows installer:**

```
npm run dist
```

The installer is created in the `dist\` folder as `AIPaper Sync Setup 1.0.0.exe`. You can share that single file with anyone — they do not need Node.js to install or run the program.

---

## Requirements

- Windows 10 or Windows 11 (64-bit)
- Your AIPaper tablet connected to the **same Wi-Fi network** as your PC
- The **IP address of your tablet** — the default is `192.168.0.69`. You can find it in the Wi-Fi settings of the tablet itself.

---

## Opening the interface

**Double-click** the AIPaper Sync icon in the system tray (bottom-right corner, near the clock).

Right-clicking the icon shows a quick menu:
- **Open** — opens the main window
- **Sync Now** — starts a sync immediately without opening the window
- **Quit** — closes the program completely

Clicking the **X** to close the window keeps the program running in the tray by default. You can change this behaviour in Settings → Close button behavior.

---

## The three tabs

### Status tab — live overview

| Item | Description |
|---|---|
| **Last sync** | Date and time of the most recent sync — persisted across restarts, even if you clear the history |
| **Result** | Files created/overwritten, or an error message |
| **Tablet** | Shows whether the tablet is reachable on the network |
| **Sync Now** | Starts an immediate sync |
| **Progress bars** | One bar per notebook, always visible — grey at rest, animated during sync |
| **Log** | Collapsible activity log — click the Log header to open/close it |

### History tab — sync record

Lists every file copied from the tablet, showing:
- the date and time
- which notebook it came from (Paper, Daily, etc.)
- the full path of the file on your PC
- whether the file was **created** for the first time or **overwritten** with a newer version

Long history lists are paginated (50 rows per page) with Prev / Next buttons.

The **Clear History** button wipes this list — it does not delete any files from your PC, and does not reset the "Last sync" display.

### Settings tab — configuration

Settings are saved automatically as soon as you change any field — no Save button needed.

| Setting | Default | Description |
|---|---|---|
| **Tablet URL** | `http://192.168.0.69:8090` | Network address of your tablet. Change this if your tablet has a different IP address. |
| **Output Folder** | `%USERPROFILE%\Downloads` | The folder on your PC where synced files will be saved. |
| **Note Format** | PDF | Export format: **PDF** (opens anywhere) or **Note** (tablet's native format). |
| **Sync on Startup** | On | Automatically runs a sync each time the program launches. |
| **Incremental Sync** | On | Skips notebooks that haven't changed since the last sync — faster and uses less bandwidth. Recommended. |
| **Start with Windows** | On | Launches the program automatically when you start your PC. Visible in Task Manager → Startup apps. |
| **Close button behavior** | Minimize to tray | What happens when you click ✕: keep running in the tray, or quit the app entirely. |

---

## Where files are stored

Files copied from your tablet are saved in whichever folder you set under Settings → Output Folder (your Windows Downloads folder by default).

The program also stores its own data in its installation folder:

```
data\
├── config.json      ← your saved settings
├── history.json     ← sync history records
├── syncstate.json   ← per-notebook sync timestamps and last-sync summary
└── app.log          ← activity and error log (see Troubleshooting)
```

---

## Troubleshooting

### The tablet shows as "Unreachable"

- Make sure the tablet and PC are on the same Wi-Fi network.
- Make sure the tablet is turned on and unlocked.
- Check Settings → Tablet URL: the IP address must match the one shown in the tablet's Wi-Fi settings.
- Note: the connectivity check may briefly show "Unreachable" while the tablet wakes up, even if a sync can still proceed.

### A notebook is always re-downloaded even though nothing changed

- This was a known issue with certain notebooks (Meeting, Picking) where the tablet reports folder timestamps as 0. It is now fixed — those notebooks are detected correctly using file-level timestamps.
- If you see this after updating, delete `data\syncstate.json` once to reset the stored timestamps, then run a sync. The correct values will be saved and skipping will work from the next sync onward.

### I deleted local files and the sync says "No changes"

This should no longer happen. The app now checks whether local files exist before deciding to skip a notebook. If the output folder for a notebook is missing or empty, the files are re-downloaded automatically.

### A sync fails or stops midway

- Open the log file `data\app.log` inside the program's installation folder — it contains a detailed record of what happened, including any error messages.
- To read it: right-click `app.log` → Open with → Notepad.
- If the problem keeps happening, send this file to whoever set up the program for you.

### The program won't start

- Try launching it from the Start menu.
- If it still won't open, send the `data\app.log` file to whoever set up the program for you.

### The log file gets large

No need to worry: the program automatically starts a fresh `app.log` once it reaches 2 MB, and keeps the last three archived files (`app.log.1`, `app.log.2`, `app.log.3`). Older ones are deleted automatically.

---

## Uninstalling

1. Right-click the icon in the system tray → **Quit** to close the program.
2. Open **Settings** (Windows) → **Apps** → search for **AIPaper Sync** → **Uninstall**.

The uninstaller removes the program and clears the startup entry automatically. Your synced files are not deleted.
