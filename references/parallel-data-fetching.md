# Parallel Data Fetching

After graph is built, enabled fetchers run in parallel via `Promise.all`:

```javascript
const fetchers = [];
if (opts.fetchTables) { fetchers.push(fetchTableContent()); fetchers.push(fetchClassData()); }
if (opts.fetchBom) fetchers.push(fetchBomData());
await Promise.all(fetchers);
```

Each fetcher is an `async function` in `main()` reading from shared variables. JSON cache updated once after all complete.

Reduces sequential fetch time to `max(tables, class, BOM)` instead of `tables + class + BOM`.

## Affected Calls — maxBuffer Required

ALL `execFile`/`execFileSync` calls to the CLI must include:

```javascript
{ encoding: 'utf-8', timeout: 60000, maxBuffer: 50 * 1024 * 1024, windowsHide: true, cwd: path.dirname(SAP_CS_EXE) }
```

Affected calls in index.js:
- `profile-deps` (main SAP query) — already has `maxBuffer: 50*1024*1024`
- `read-table --table MAST` — was missing, fixed
- `bom ... --json` — was missing, fixed
- `class-objects ... --json` — was missing, fixed
- `table-content` (async execFile in fetch loop) — was missing default 30s timeout + no maxBuffer, both fixed

## Data Sizes

| Call | Data | Size |
|------|------|------|
| `read-table --table MAST --limit 5000` | 5000 MAST records | ~1-2MB |
| `bom ... --json` (CSAP_MAT_BOM_READ with 243 items) | Full BOM structure | ~200KB-2MB |
| `class-objects ... --json` (105 classes) | Class → material mapping | ~500KB |
| `table-content` for large variant tables | 8000+ rows | ~5-10MB per table |

Without explicit `maxBuffer`, Node.js silently truncates output. `execFileSync` throws `ENOBUFS`. `execFile` (async) calls the callback with an error, which gets swallowed as `errs++` in the fetch loop.
