# CLI Integration — sap-vc-cs

## SAP_CS_EXE Path

```
<path-to>\sap-vc-cs.exe
```

## Path History

Originally pointed to `sap-vc-cli/bin/Debug/sap-vc-cli.exe`. Changed to `sap-vc-cs/bin/Release/sap-vc-cs.exe` to get S4H support (`sap-vc-cli` Debug binary didn't have S4H in its systems.json). The Debug binary defaulted to JSON output but used a different systems file.

## Key Differences Between sap-vc-cli and sap-vc-cs

### `profile-deps` requires `--json` flag

`sap-vc-cs` does NOT default to JSON like `sap-vc-cli` did — got `Unexpected token 'C', "C_PROFILE "` error when `--json` was omitted.

### PascalCase field names

`sap-vc-cs` uses PascalCase in JSON output (`Profile` not `profile`, `Dependencies` not `dependencies`, `Tables` not `tables`). The `loadFromRaw()` and `querySAP()` functions must normalize with fallback:

```javascript
result.Profile || result.profile || {}
```

### PascalCase normalization for table I/O keys

`loadFromRaw()` and `querySAP()` must normalize table I/O keys:

```javascript
if (ts.Inputs && !ts.inputs) ts.inputs = ts.Inputs;
if (ts.Outputs && !ts.outputs) ts.outputs = ts.Outputs;
```

### `bom` command flags

```
bom --material X --plant Y --usage Z --json --system SID
```

### `read-table` requires `--json` flag

Without `--json`, output is text and `JSON.parse` throws.

```javascript
// WRONG — output is text, JSON.parse throws:
['read-table', 'MAST', '--fields', '...', '--where', '...', '--system', opts.system]

// RIGHT:
['read-table', 'MAST', '--fields', '...', '--where', '...', '--json', '--system', opts.system]
```

## GitHub

https://github.com/zpage/sap-vc-cli
