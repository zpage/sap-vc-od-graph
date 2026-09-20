# VBA Extraction from .xlam

## Python Extraction Script

Use Python to extract VBA code from `.xlam` files (which are ZIP archives containing `.xl/vbaProject.bin`):

```bash
python3 -c "
import zipfile, sys
z = zipfile.ZipFile(sys.argv[1])
print(z.read('xl/vbaProject.bin').decode('latin-1', errors='replace'))
" VCTOOL.xlam
```

## Sanitization Patterns

### Replace SAP GUI constants

```python
# SAP GUI Scripting constants need to be mapped
# Constants like wdCaption, wdResize, etc.
```

### Handle COM reflection

```python
# VBA uses COM reflection for SAP GUI:
# Set objConnection = CreateObject("SAP.Functions")
# Map to Python: win32com.client.Dispatch("SAP.Functions")
```

### Preserve special characters

VC source code contains `$self`, `$parent`, `$root` — these must not be escaped during extraction.

## Reference

See `references/cli-integration.md` for CLI path conventions.
