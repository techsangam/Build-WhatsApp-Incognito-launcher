# WhatsApp Web Secure Launcher

Minimal Electron launcher that opens `https://web.whatsapp.com` in Google Chrome with:

- `--incognito`
- `--new-window`
- a brand-new temporary `--user-data-dir`

Every launch uses a disposable Chrome profile, so closing the Chrome window removes the temporary profile folder and forces a fresh QR login next time.

## Requirements

- Windows
- Node.js 18+ (Node 24 works)
- Google Chrome installed

## Setup

1. Open a terminal in this folder:

   ```powershell
   cd "C:\Users\ANURAG MISHRA\OneDrive\Documents\New project\whatsapp-web-launcher"
   ```

2. Install Electron:

   ```powershell
   npm install
   ```

## Run

```powershell
npm start
```

## Build EXE

```powershell
npm run build:win
```

The portable Windows executable will be created in:

```text
dist\WhatsApp-Web-Secure-Launcher-1.0.0.exe
```

## Chrome Path Configuration

The launcher tries these locations automatically:

- `%CHROME_PATH%`
- `%ProgramFiles%\Google\Chrome\Application\chrome.exe`
- `%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe`
- `%LocalAppData%\Google\Chrome\Application\chrome.exe`
- anything returned by `where chrome`

If Chrome is not detected:

- enter the full path to `chrome.exe` in the launcher UI, or
- set an environment variable before launching:

  ```powershell
  $env:CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
  npm start
  ```

## Behavior

- The app opens WhatsApp Web automatically on startup.
- Chrome is launched in a dedicated Incognito window.
- A temporary Chrome profile folder is created for the session.
- Closing the Chrome window deletes that temporary profile folder.
- The Electron launcher also uses temporary app data and clears its own storage on exit.

## Project Files

- `main.js`: Chrome launch, temp-profile handling, cleanup
- `preload.js`: safe IPC bridge for the UI
- `renderer.js`: button actions and live status updates
- `index.html` / `styles.css`: minimal launcher UI
