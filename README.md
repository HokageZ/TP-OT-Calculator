# !!! ابي فلوسي تستهبلون (TP OT Calculator)

Chrome extension for Teleperformance (TP) Egypt employees that calculates overtime hours and pay directly from the NICE WFM WebStation weekly schedule.

## Features

- **Chrome MV3 Extension:** Lightweight, secure, and modern.
- **Accurate Parsing:** Handles nested schedule tables, `rowspan` activity continuation blocks, and RTA/Scheduling classifications.
- **True Calendar Splitting:** Activities crossing midnight are split at `12:00 AM`. Spillover hours are dynamically moved and chronologically merged into the start of the following day's timeline (matching how payslips work).
- **Configurable Settings (Separate Tab):**
  - **Hourly Rate:** Define your pay rate in EGP.
  - **Week Starts On:** Group and display your weekly schedules starting on any day (Sunday–Saturday).
  - **Bonus Settings:** Fully configurable bonus calculation (`+X bonus hours` for every `Y worked OT hours`).
- **One-Click Manual Update:** Easily verify if a new version is available directly from the Settings panel.

## Installation

1. Clone or download this repository.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** (top-left button) and select this project's root folder.

## GitHub Auto-Updates

The extension is configured with an autoupdate XML payload (`updates.xml`) tracking updates from this repository:
- Manifest Location: `https://raw.githubusercontent.com/HokageZ/TP-OT-Calculator/master/updates.xml`
