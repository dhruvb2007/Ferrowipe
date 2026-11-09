# Ferrowipe ⚡

<p align="center">
  <strong>Blazingly Fast, Safe & Modern Windows Disk Optimizer & Space Analyzer</strong><br>
  <em>Built with Rust & Tauri 2.0</em>
</p>

<p align="center">
  <img src="./app-icon.svg" alt="Ferrowipe Logo" width="128" height="128" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-v0.1.0-emerald.svg" alt="Version 0.1.0" />
  <img src="https://img.shields.io/badge/Rust-1.80+-orange.svg?logo=rust" alt="Rust" />
  <img src="https://img.shields.io/badge/Tauri-2.0-blue.svg?logo=tauri" alt="Tauri 2" />
  <img src="https://img.shields.io/badge/Platform-Windows%2010%20%7C%2011-0078d4.svg?logo=windows" alt="Windows" />
  <img src="https://img.shields.io/badge/License-MIT-green.svg" alt="License" />
</p>

---

## 🚀 Overview

**Ferrowipe** is an ultra-fast, lightweight Windows desktop application designed to uncover what is consuming your disk space and safely purge accumulated system junk, browser caches, and stale temporary files.

Unlike traditional, sluggish cleaners that rely on heavy Electron runtimes or slow WMI queries, Ferrowipe is built on **Rust systems programming** and **Tauri 2**, running natively on Windows with minimal memory footprint (~35MB RAM) and near-instantaneous startup.

---

## ✨ Features in V0.1 Core

### 1. 💽 Instant Drive Overview & Hardware Diagnostics
* **Volume Enumeration**: Accurately lists all connected partitions (`C:`, `D:`, external USB flash drives, network shares).
* **Zero-Lag Hardware Detection**: Queries Win32 `IOCTL_STORAGE_QUERY_PROPERTY` directly for disk seek-penalty to distinguish **SSD / NVMe** from mechanical **HDD** in **< 0.1 milliseconds** (bypassing slow WMI).
* **Real-Time Storage Metrics**: Displays partition capacity, used space, free space, and filesystem type (`NTFS`, `exFAT`, `FAT32`).
* **Low-Space Headroom Warnings**: Automatic visual warning badge and alert banner when a drive falls below **15%** or **15 GB** free capacity.

### 2. 🧹 Rule-Based Safe Junk Cleaner
Ferrowipe targets only verified, safe-to-clean junk locations without ever touching user documents, personal files, or core Windows binaries:
* **User Temp**: `%TEMP%` and `%LOCALAPPDATA%\Temp`
* **Windows System Temp**: `C:\Windows\Temp`
* **Recycle Bin**: Per-drive native querying and purging via `SHQueryRecycleBinW` and `SHEmptyRecycleBinW`
* **Browser Caches**:
  * Google Chrome (`Cache`, `Code Cache`, `GPUCache`)
  * Microsoft Edge (`Cache`, `Code Cache`, `GPUCache`)
  * Mozilla Firefox (`Profiles\*\cache2`)
  * Brave Browser (`Cache`, `Code Cache`)
* **Windows Update Cache**: `C:\Windows\SoftwareDistribution\Download`
* **Thumbnail & Icon Cache**: `%LOCALAPPDATA%\Microsoft\Windows\Explorer` (`thumbcache_*.db`)
* **Crash Dumps & WER**: `%LOCALAPPDATA%\CrashDumps`, `%PROGRAMDATA%\Microsoft\Windows\WER`, `C:\Windows\Minidump`, `MEMORY.DMP`
* **Prefetch & Old System Logs**: `C:\Windows\Prefetch`, `C:\Windows\Logs\CBS`, `DISM`

### 3. 🎯 Core Interactive Workflow
```
[Select Rules] ──▶ [Multithreaded Scan] ──▶ [Interactive Preview] ──▶ [Confirm Modal] ──▶ [Safe Clean] ──▶ [Detailed Report]
```
* **Real-Time Scan**: Live scanned path preview with an instantaneous **Cancel Scan** button.
* **Granular Control**: Both **per-category** and **per-item** checkboxes with expandable directory accordions.
* **Dynamic Reclaimable Calculation**: See exactly how much space will be freed in real time as you toggle checkboxes.
* **Safe Error Handling**: Files currently locked by active processes (open browsers or system services) are safely skipped without halting the cleanup pipeline.
* **Comprehensive Post-Clean Report**: Detailed summary of freed bytes, files purged, and a filterable log of skipped items with exact reasons (e.g. `ERROR_SHARING_VIOLATION`), with one-click clipboard copying.

---

## ⚡ Performance Architecture

| Optimization | Traditional Cleaners | Ferrowipe (Rust + Tauri 2) |
|---|---|---|
| **Drive Detection** | WMI queries (1,500ms – 3,000ms) | Direct Win32 seek-penalty syscalls (< 0.1ms) |
| **Directory Traversal** | Single-threaded synchronous I/O | `jwalk` parallel work-stealing threadpool |
| **Recycle Bin** | Manual folder recursion (ACL permission failures) | Native Windows Shell API (`SHQueryRecycleBinW`) |
| **UI Event Overhead** | Emitting IPC events for every file (freezes UI) | Throttled 60ms batch updates (~16 FPS) |
| **Memory Consumption** | ~150MB – 400MB (Electron / Chromium) | ~30MB – 50MB (System WebView2) |

---

## 🛠️ Build & Installation

### Prerequisites
1. **Rust Stable**: `rustup default stable-x86_64-pc-windows-msvc`
2. **Microsoft C++ Build Tools**: Visual Studio 2019/2022/2026 Build Tools with the C++ workload.
3. **Node.js**: Node 18+ and `npm`.
4. **WebView2**: Built into Windows 10/11.

### Quick Start (Development)
```powershell
# Clone the repository
git clone https://github.com/dhruvb2007/Ferrowipe.git
cd Ferrowipe

# Install frontend dependencies
npm install

# Run in development mode with hot-reload
npm run tauri dev
```

### Production Build
```powershell
# Compiles optimized production binary and Windows installer
npm run tauri build
```
The compiled executable will be located at:
`src-tauri/target/release/ferrowipe.exe`

---

## 📦 Project Structure

```
Ferrowipe/
├── app-icon.svg                 # Application Vector Brand Icon
├── package.json                 # Frontend dependencies & scripts
├── vite.config.ts               # Vite configuration for Tauri 2
├── tailwind.config.js           # Tailwind CSS configuration
├── src/                         # React + TypeScript Frontend
│   ├── main.tsx                 # Entrypoint
│   ├── App.tsx                  # Root state & navigation
│   ├── types.ts                 # Shared TypeScript models
│   ├── utils.ts                 # Byte & duration formatting
│   └── components/
│       ├── Header.tsx           # Branding & navigation bar
│       ├── DriveOverview.tsx    # Drive cards, SSD/HDD badges, space warnings
│       ├── JunkCleaner.tsx      # Target selection, scan/preview/clean workflow
│       ├── ConfirmationModal.tsx# Deletion safety confirm dialog
│       └── ReportModal.tsx      # Post-cleaning metrics & skipped files log
└── src-tauri/                   # Rust Tauri 2 Backend
    ├── Cargo.toml               # Rust dependencies (windows-sys, jwalk, rayon)
    ├── tauri.conf.json          # Tauri application settings & windows
    ├── build.rs                 # Tauri build script
    └── src/
        ├── main.rs              # Application main entrypoint
        ├── lib.rs               # Tauri handler registrations
        ├── models.rs            # Rust data structures (DriveInfo, JunkItem, etc.)
        ├── drives.rs            # Win32 hardware drive detection (SSD/HDD)
        ├── rules.rs             # Rule definitions & path resolution
        ├── cleaner.rs           # Multithreaded scan & safe delete engines
        └── commands.rs          # Invokable IPC commands & cancel tokens
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
