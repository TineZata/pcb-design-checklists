<!--
  SPDX-License-Identifier: GPL-3.0-or-later
  SPDX-FileCopyrightText: 2026 Tine Zata
-->

# PCB Design Checklists

Structured PCB design review checklists served as a static GitHub Pages site. Checklist data lives in CSV files under `checklists/csv/` and is rendered interactively in the browser — no build step required.

## Live Site

**`https://<your-username>.github.io/pcb-design-checklists/`**

To enable: go to **Settings → Pages → Source → GitHub Actions**.

## Checklists

| File | Items | Description |
|---|---|---|
| `design_review_checklist.csv` | 138 | Full design review — 13 categories from schematics to safety |
| `emc_rf_checklist.csv` | 16 | EMC/RF compliance — filtering, ground planes, shielding, ESD |
| `engineering_checklist.csv` | 28 | General engineering review — setup, electrical, components |
| `pcb_layout_checklist.csv` | 41 | PCB layout — placement, routing, DRC, fabrication |
| `schematic_checklist.csv` | 34 | Schematic review — symbols, ERC, power, connections |

## Structure

```
index.html                  Landing page
pages/                      One HTML page per checklist
assets/css/style.css        Shared styles
assets/js/csv-loader.js     CSV fetch, parse and render engine
checklists/csv/             Source-of-truth CSV data files
.github/workflows/pages.yml Auto-deploy to GitHub Pages on push to main
```

## Updating a Checklist

Edit the relevant CSV in `checklists/csv/`. The site reads the CSV live on page load — push to `main` and the changes appear immediately.
