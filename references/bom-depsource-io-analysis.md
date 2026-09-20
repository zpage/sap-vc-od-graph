# BOM DepSource I/O Analysis

## Overview

Client-side regex analysis of T_DEP_SOURCE lines to classify characteristic references as READ or WRITE.

## Analysis Logic

### Selection Conditions (DEP_TYPE 5 or 15)

ALL chars are READ. Implicit IF wraps the entire source; `=` is comparison, not assignment.

### Procedures (DEP_TYPE 7)

Standard I/O analysis with assignment vs comparison distinction:

| Pattern | Example | LHS | RHS |
|---------|---------|-----|-----|
| Assignment (`$self.X = Y`) | `$self.QTY_BOM_ITEM=2` | **WRITE** | READ |
| Comparison (`>=`, `<=`, `==`, `<>`) | `$parent.VAL >=2023` | **READ** (comparison target) | READ (comparison value) |
| No `=` sign | `$PARENT.TYP_SUSPENSION SPECIFIED` | **READ** (all vars on line) | — |
| IF/THEN/ELSE lines | `if $PARENT.TYP_TM in (...)` | Skipped entirely | — |

### Comparison Detection Order

First-match wins: `>=`, `<=`, `==`, `<>`, then bare `=` (assignment).

## Implementation Details

### Regex Creation

Create regex **ONCE** outside the `while` loop to prevent `lastIndex` infinite loop:

```javascript
const re = /[$]self[.](\w+)|[$]parent[.](\w+)/gi;
while ((m = re.exec(line)) !== null) { ... }
```

### Template Literal Pitfall

Inside backtick strings, `\$` is an invalid escape → backslash is silently stripped:

```javascript
// WRONG — $ is lost in template literal:
const re = /(\$self|.$parent).(\\w+)/;

// RIGHT — [$] passes through unchanged:
const re = /[$]self[.]($w+)/g;
```

### Line Limit

Loop limited to 200 lines (`Math.min(lines.length, 200)`) to prevent hanging on malformed source.

### Try/Catch Guard

The entire I/O analysis loop in `showDepSource()` is wrapped in `try/catch` to prevent a frozen page if regex hangs.
