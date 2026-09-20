# BAPI OBJCL GETOBJECTS — Class Objects for BOM K Items

## Purpose

When a BOM item is a K-item (class item), the right panel shows classified objects — materials assigned to that class.

## CLI Command

```bash
sap-vc-cs class-objects --class CN_SPB_1 --system R1E --json
```

Calls `BAPI_OBJCL_GETOBJECTS` with proper CLASSNUMRANGE table handling.

## Data Flow

1. `--fetch-bom` pipeline reads BOM → finds unique class names for K items
2. For each unique class, calls `class-objects` CLI command
3. Stores results in `bomData.classObjects[className]`
4. When user clicks a K item, `showBOMItem()` renders classified objects in right panel

## HTML Rendering

```javascript
var objs = (BOM.classObjects || {})[item.CLASS] || [];
var dh = '<h3>Classified Objects (' + objs.length + ')</h3>';
for (var oi = 0; oi < Math.min(objs.length, 50); oi++) {
  dh += '<div class="proc-row" style="font-size:10px">' + esc(objs[oi]) + '</div>';
}
if (objs.length > 50) dh += '<div style="color:#999;font-size:9px;margin-top:4px">… ' + objs.length + ' total</div>';
dp.innerHTML = dh;
```

## Limitations

- Max 50 objects shown per class (with "N more" indicator)
- Requires `--system` flag — defaults to R1E if omitted, may miss S4H classes
- CLASSNUMRANGE table handling: BAPI may require specific range formats
