# BOM MAST Query

## read-table MAST

```bash
sap-vc-cs read-table MAST --fields STLTY,STLNR,MATNR,WERKS --where "MATNR LIKE '000000008000000038'" --json --system R1E
```

## Limitations

### WHERE Clause with `=` Operator

Multi-field WHERE with `=` causes NCo "Data was lost while copying a value" error. Always use `LIKE` instead.

### Limit Issue

`read-table --limit 5000` returns only the first 5000 sorted records. Material 8000000038 (`000000008000000038`) may not be in the first 5000. Always use `LIKE WHERE` for targeted queries.

### S4H Authorization

On S4H, `read-table MAST` may return `TABLE_NOT_AVAILABLE` even though MAST is accessible via SAP GUI SE16N. This is an `RFC_READ_TABLE` authorization limitation.

## Fallback

When MAST query fails, call `bom` command directly with material number (no MAST lookup needed):

```bash
sap-vc-cs bom --material 000000008000000038 --json --system R1E
```

## Material Padding

Numeric materials must be 18-char zero-padded:

```javascript
const matPadded = /^\d+$/.test(opts.material || '')
  ? (opts.material || '').padStart(18, '0')
  : (opts.material || '');
```

Alphanumeric AVC materials (`AVC_RBT_BUNDLE`) must NOT be padded.
