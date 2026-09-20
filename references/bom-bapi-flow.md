# BOM BAPI Flow

## Two-Step Pipeline

1. **MAST table** via `read-table --where "MATNR LIKE '...'"` — find BOM headers
2. **CSAP_MAT_BOM_READ BAPI** via the `bom` CLI command — read full BOM structure

```
MAST (LIKE WHERE) → filter MATNR → dedup STLNR (take first) → CSAP_MAT_BOM_READ with first record's MATNR/WERKS/STLAN
```

## MAST Query

```bash
sap-vc-cs read-table MAST --fields STLTY,STLNR,MATNR,WERKS --where "MATNR LIKE '000000008000000038'" --json --system R1E
```

**CRITICAL**: Use `LIKE` operator, NOT `=`. The `=` operator with multi-field WHERE causes NCo "Data was lost while copying a value" error (NCo metadata bug on MAST).

**Material padding**: Numeric materials need 18-char zero-padding:
```javascript
const matPadded = /^\d+$/.test(opts.material || '') ? (opts.material || '').padStart(18, '0') : (opts.material || '');
```

## CSAP_MAT_BOM_READ

```bash
sap-vc-cs bom --material 000000008000000038 --json --system R1E
```

Returns:
- `T_DEP_ORDER` — dependency order (ITEM_NODE, DEP_INTERN)
- `T_DEP_DATA` — dependency metadata (DEP_TYPE)
- `T_DEP_SOURCE` — dependency source code (DEP_INTERN, LINE_NO, LINE)
- `STKO` — BOM header
- `STPO` — BOM items

## T_DEP_SOURCE Field Name

The field for dependency name is **`DEP_INTERN`**, not `DEP_NAME`.

```javascript
depSource: (bomJson.T_DEP_SOURCE || []).reduce(function(o, r) {
  var key = r.DEP_INTERN || '';
  if (key) { if (!o[key]) o[key] = []; o[key].push(r.LINE || ''); }
  return o;
}, {})
```

Using `DEP_NAME` returns ~1 source instead of 291.

## BOM Data Structure in JSON Cache

```javascript
bomData = {
  mast: [...],
  bapi: {
    stko: [header],
    stpo: [items],
    depOrder: [...],
    depData: {...},
    depSource: {...},
    matnr: '...',
    plant: '...',
    stlan: '...',
    stlnr: '...',
    classObjects: { className: [obj, ...], ... }
  }
}
```

## S4H Fallback

On S4H, `read-table MAST` may return `TABLE_NOT_AVAILABLE` (RFC_READ_TABLE authorization limitation). Fallback to calling `bom` directly:

```javascript
try {
  const mastOut = execFileSync(SAP_CS_EXE, ['read-table', 'MAST', ...]);
  bomData.mast = parseMast(mastOut);
} catch(e) { /* MAST not available */ }
if (bomData.mast.length === 0) {
  const bomOut = execFileSync(SAP_CS_EXE, ['bom', '--material', matPadded, '--json', '--system', opts.system], { ... });
  // parse bomOut same as MAST-based path
}
```

CSAP_MAT_BOM_READ accepts raw material number without MAST — no plant/usage needed when called bare (returns only the default BOM).
