# sap-vc-od-graph

SAP VC Object Dependency Graph — interactive HTML visualizer for variant configuration dependencies.

## Quick start

```bash
# First run — query SAP and generate HTML + cached JSON
node index.js --material 8000000038 --output 8000000038-od-graph.html --force --fetch-tables

# Subsequent runs — reuse cached JSON (no SAP call)
node index.js --input 8000000038-od-graph.json --output 8000000038-od-graph.html --force

# Re-fetch from SAP
node index.js --material 8000000038 --output output.html --force --fetch-tables
```

## CLI options

| Flag | Description |
|------|-------------|
| `--material` | Material number |
| `--profile` | Config profile name |
| `--system` | SAP system ID (default: R1E) |
| `--output` | Output HTML path |
| `--input` | Load from cached JSON (skips SAP) |
| `--force` | Force re-fetch / overwrite output |
| `--fetch-tables` | Fetch variant table content + class data (requires SAP) |
| `--fetch-bom` | Fetch BOM via MAST + CSAP_MAT_BOM_READ + class objects |
| `--depgraph` | Generate interactive D3.js dependency graph |
| `--mock` | Use mock data |

## Architecture

```
index.js                   — CLI entry, parses args, orchestrates pipeline
lib/od-parser.js           — Parses VC procedure/constraint source code
lib/graph-builder.js       — Builds char dependency graph from parsed data
lib/html-renderer.js       — Generates interactive 3-panel HTML page
lib/mock-data.js           — Test data for development
```

## Pipeline

1. **Get data** — Query SAP via `sap-vc-cs.exe`, or load from cached JSON
2. **Parse** — Extract char reads/writes/defaults from each dependency (incl. variant function calls)
3. **Build graph** — Create relationship edges between chars, ODs, and tables
4. **Fetch extras** — Optionally fetch variant table content + class data
5. **Render HTML** — Generate the interactive 3-panel page

## Variant function I/O

OD 源码中的 variant function 调用（`FUNCTION`/`PFUNCTION`）会通过 `CARD_FUNCTION_READ`
BAPI 解析输入/输出 char，计入 OD 的 reads/writes。

**2026-08-26 起实时读取**：每次运行从 OD 源码发现实际调用的函数名，逐个调
`CARD_FUNCTION_READ` 读最新定义（`variant_functions_q1e.json` 仅作 BAPI 失败时的逐函数回退）。

详见 `references/variant-function-io.md`。

## Output HTML

Three-panel layout:

- **Top**: Global search bar — type to filter PROC/CNET/CONSTRAINT/CHAR/TABLE/CLASS, click result to jump
- **Left (Profile tab)**: OD tree — profile, procedures, CNETs, constraints, chars
- **Left (Env tab)**: Classes with chars, tables, BOM
- **Middle**: Source code / class detail / table detail
- **Right**: Char used-by detail (grouped by class / OD / table); every I/O badge is followed by the char's exact occurrence count in that OD's source (`xN`, word-boundary matched)

Click an item in any panel to navigate to its detail in the adjacent panel.
Selected tree items are highlighted (blue background).

Reference counts (`xN`) appear in three places, all computed client-side from the
already-embedded source data (no extra JSON payload, <0.01% file-size impact):
1. `showChar()` — each OD in the ODs section
2. `showOD()` parsed path — each char in the Chars section
3. `showOD()` fallback path — deps without parsed data

Counting uses a word-boundary regex `(^|[^A-Z0-9_])(NAME)(?![A-Z0-9_])` — never
substring `split()`, so a short name cannot false-match a longer one.

## Data privacy

No SAP credentials, system connection details, or business data are tracked or committed.
Material numbers and BOM data in sample usage are anonymized.
