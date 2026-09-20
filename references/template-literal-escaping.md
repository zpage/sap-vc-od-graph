# Template Literal Escaping

## The Problem

When generating JavaScript inside template literals (backtick strings), escape sequences are processed by the template literal parser BEFORE becoming regex code:

| Pattern | Template literal result | Regex sees |
|---------|------------------------|------------|
| `\\$` | `$` | literal `$` (GOOD for regex) |
| `\\.` | `.` | literal `.` (BAD — matches any char) |
| `\\w` | `w` | literal `w` (BAD) |
| `\\\\` | `\\` | literal `\` (GOOD) |

## Solutions

### 1. Use character classes for `$`

`[$]` is not a recognized escape → passes through unchanged:

```javascript
// Instead of /(\$self|.$parent)/
const re = /[$]self[.]($w+)/g;
// or better, use regex literal outside template:
const re = /[$]self[.](\w+)/g;
```

### 2. Use regex literals outside template strings

Best approach for complex regexes — define them as standalone `new RegExp()` calls or regex literals:

```javascript
// In the generated HTML script (not inside a template literal):
const re = /[$](?:self|parent|SELF|PARENT)[.](\w+)/gi;
```

### 3. Double-escape when unavoidable

If you must put regex inside a template literal:

```javascript
// Produces \\$ in the output (regex sees \$)
const escaped = `const re = /\\\\$(?:self|parent)/`;
// escaped = 'const re = /\$(?:self|parent)/'
```

## Impact on Inline onclick

Inline `onclick="switchTab('od')"` inside template literals requires:

```javascript
`onclick="switchTab(\'od\')"`   // fragile
`onclick="switchTab(\x27od\x27)"`  // works but unreadable
```

Every additional layer of JS nesting doubles the backslash count. This is why the project switched to event delegation with `data-*` attributes exclusively.

## Reference

See `references/cli-integration.md` for related PascalCase normalization issues.
