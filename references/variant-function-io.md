# Variant Function I/O 读取与 OD Char 分析

> 2026-08 新增。用 BAPI `CARD_FUNCTION_READ` 读取 variant function 的输入/输出 char 定义，
> 集成到 OD 源码解析，使 OD 中 char 的 input/output 分析包含函数调用参数。

## BAPI: CARD_FUNCTION_READ

读取 variant function 定义（SAP 标准函数 + 自定义 Z 函数）。

```bash
sap-vc-cs call CARD_FUNCTION_READ FUNCTION_NAME=SAP_VF_CONCATENATE --system Q1E
```

**参数**：
- `FUNCTION_NAME`（Import，必填）— 函数名。注意不是 `FUNCTION`
- `LANGUAGE`（可选）
- `DATE`（可选）

**输出表**：

| 表 | 结构 | 含义 |
|----|------|------|
| `VAR_FUNCTION_ALT_INPUT` | VFUNC_ALT_INP | **输入参数**（CHARACT 字段） |
| `VAR_FUNCTION_PARAMETERS` | CHARS | **全部参数**（CHARACT 字段） |
| `VAR_FUNCTION_DESCRIPTIONS` | VFUNC_DESCR | 描述（多语言） |
| `VAR_FUNCTION_BASIC_DATA` | VFUNC_BASIC | 状态/分组 |

**I/O 判断规则**：输出参数 = 全部参数 − 输入参数（差集）。

```
VAR_FUNCTION_ALT_INPUT (输入):
  [0] CHARACT=SAP_VF_FORMAT
  [1] CHARACT=SAP_VF_CHARIN
  [2] CHARACT=SAP_VF_OPTION
  [3] CHARACT=SAP_VF_NUMIN
VAR_FUNCTION_PARAMETERS (全部):
  [0] CHARACT=SAP_VF_CHARIN
  [1] CHARACT=SAP_VF_NUMIN
  [2] CHARACT=SAP_VF_FORMAT
  [3] CHARACT=SAP_VF_OPTION
  [4] CHARACT=SAP_VF_CHAROUT   ← 输出（差集）
```

**陷阱**：
- 参数名是 `FUNCTION_NAME`，不是 `FUNCTION`
- `CHARS` / `CDEP` 等表被 RFC 阻止（TABLE_NOT_AVAILABLE），只能走 BAPI
- 无输出参数的函数：`SAP_VF_COMPARE_STRINGS`（纯比较）、`Z_MFT_UPD_VTABLE`（纯写 variant table）

## OD 源码中的函数调用格式

源码使用 `FUNCTION` 或 **`PFUNCTION`** 前缀（自定义函数多用 PFUNCTION）：

```
FUNCTION SAP_VF_CONCATENATE(
  SAP_VF_FORMAT   = 'DELETELEADING 0',
  SAP_VF_NUMIN    = 0,
  SAP_VF_CHARIN   = MDATA $self.TXT_MATNR,
  SAP_VF_OPTION   = '',
  SAP_VF_CHAROUT ?= $self.TXT_MATNR),
```

```
PFUNCTION ZMFT_OMF_GET_LIFT_AND_WBS (
  TXT_REF_ORDER_NUMBER = $SELF.TXT_REF_ORDER_NUMBER,
  TXT_FIELD_LIFT_NR = $SELF.TXT_FIELD_LIFT_NR,
  TXT_URN = $SELF.TXT_URN)
```

## od-parser.js 集成

### 改动（2026-08，2026-08-26 更新）

1. 构造函数接收 `vfDefs`（`{funcName: {inputs: [], outputs: []}}`）
2. tokenizer 用 `/^P?FUNCTION\s+([A-Z][A-Z0-9_]*)\s*\(/i` 匹配调用头（PFUNCTION 和 FUNCTION 都适用）
3. 函数体内所有裸词 → `vfparam` token（不限于 `SAP_VF_` 前缀，支持自定义 Z 函数参数 KEY01/ZID/TXT_URN 等）
4. 参数方向判断优先级：
   - `vfDefs[currentFunc].outputs` 命中 → write
   - `vfDefs[currentFunc].inputs` 命中 → read
   - 未知参数 → 回退 `/OUT$/i` 启发式（SAP_VF_*OUT 结尾视为输出）
5. 函数参数值里的 char 引用（`$SELF.X` / 别名）按参数方向归类到 reads/writes
6. **funcall 时 `parenDepth++`（2026-08-26 修复）**：fnCall 正则消费了 `(`，token walk 的 parenDepth 必须同步 +1，否则函数参数内逗号被误判为顶层逗号 → `inCondition=false` → IF 后的 `char='literal'` 条件被误判为 WRITE。症状：`ELV.WITH_CAR_WALL_MAKE='NO'` 出现在约束的 output 而非 input。

### index.js 实时 BAPI 读取（2026-08-26，用户要求按最近 BAPI 读 I/O）

不再固定加载 `variant_functions_q1e.json`，而是**每次运行实时读取**：

1. 从所有 dep/constraint 源码发现实际调用的函数名：`/(?:P?FUNCTION)\s+([A-Z][A-Z0-9_]*)\s*\(/gi`（同时扫 `d.source` 和 `d.constraints[].source`）
2. 逐个调 `CARD_FUNCTION_READ FUNCTION_NAME=X --system Y` 读最新定义
3. 解析：`VAR_FUNCTION_ALT_INPUT` 表 = inputs，`VAR_FUNCTION_PARAMETERS` 表 = 全部参数，差集 = outputs
4. `variant_functions_q1e.json` 降级为**逐函数回退**（BAPI 失败才用），无缓存则空定义
5. 控制台输出：`Variant function defs: 10 (BAPI=10, cached=0, fail=0)`

**CARD_FUNCTION_READ 输出解析陷阱**：CLI 输出有 `=== VAR_FUNCTION_ALT_INPUT (4 rows) ===` 分隔行，**必须跳过**（`ls.startsWith('===')` continue），否则把 curTable 清空 → 所有参数解析为空。正确解析：表头 `^([A-Z_]+) = TABLE` 设 curTable；`[` 开头的行才是数据行（`CHARACT=([^,\s]+)`）；`===` 分隔行跳过；非 `[` 非空行清 curTable。

### 验证用例

| 用例 | 输入 | 输出 |
|------|------|------|
| SAP_VF_CONCATENATE | TXT_MATNR (CHARIN) | TXT_MATNR (CHAROUT) |
| SAP_VF_NUM_TO_CHAR | VAL_SPEED (NUMIN) | TXT_SPEED_CERT (CHAROUT) |
| SAP_VF_COMPARE_STRINGS | TYP_INV (CHARIN1) | （无） |
| ZMFT_OMF_GET_LIFT_AND_WBS (PFUNCTION) | TXT_REF_ORDER_NUMBER | TXT_FIELD_LIFT_NR, TXT_URN |
| CONS_ELEV_TO_SPB_MSG 约束 | WITH_CAR_WALL_MAKE (READ, 条件比较) | TXT_MSG/TXT_PRINT_INFO 等真实赋值 (WRITE) |
| PRO_ELEV_COUNT_SPB (2026-08-26) | TXT_TM_ROPE_MFG / TYP_CAR_CEILING (READ, `<>` 比较 + SPECIFIED) | 不调相关表 → 保持 READ |

### Table reconcile 修复（2026-08-26）

index.js Step 4 把「表输出列」的 char 从 reads 移到 writes 时，原来对**所有**引用该 char 的 OD 都执行。修复为**只对实际调用该表的 OD** 生效（`dep.parsed.tables[tableName]` 存在）。

- 症状：`PRO_ELEV_COUNT_SPB` 里 `TXT_TM_ROPE_MFG`（几十个 T_ROPE_* 表的输出列）被误标为 WRITE，实际只是 `<>` 比较 + `SPECIFIED` 检查（纯 READ）
- 正确：`PRO_TM_GROOVE_DEF_META_MRL` 调 `T_ROPE_TM_MRL` → TXT_TM_ROPE_MFG 是 WRITE ✓；`PRO_ELEV_COUNT_SPB` 不调表 → READ ✓

## 脚本

- `analyze_vf_io.py` — 批量读函数定义 + 解析 OD 源码调用，输出 JSON 分析（含每个调用参数的方向与 char 引用）
- `variant_functions_q1e.json` — 函数定义缓存（`{funcName: {inputs, outputs, all}}`）
- `vf_io_analysis_q1e.json` — OD 函数调用分析结果

## 实测数据（Q1E client 400, 物料 8000000002, 2026-08）

Profile ELEVATOR_PARAMETER 中 12 个 variant functions：

| 函数 | 输入 | 输出 |
|------|------|------|
| SAP_VF_CHAR_TO_NUM | SAP_VF_PLACES, SAP_VF_CHARIN, SAP_VF_OPTION, SAP_VF_SEPARATOR | SAP_VF_NUMOUT |
| SAP_VF_COMPARE_STRINGS | SAP_VF_OPTION, SAP_VF_CHARIN1, SAP_VF_CHARIN2, SAP_VF_OPERATOR | （无） |
| SAP_VF_CONCATENATE | SAP_VF_FORMAT, SAP_VF_CHARIN, SAP_VF_OPTION, SAP_VF_NUMIN | SAP_VF_CHAROUT |
| SAP_VF_COUNT_VALUES | SAP_VF_OPTION, SAP_VF_CHARNAME | SAP_VF_COUNT |
| SAP_VF_LENGTH | SAP_VF_CHARIN, SAP_VF_OPTION | SAP_VF_LENGTH |
| SAP_VF_NUM_TO_CHAR | SAP_VF_PLACES, SAP_VF_OPTION, SAP_VF_NUMIN, SAP_VF_SEPARATOR | SAP_VF_CHAROUT |
| SAP_VF_RIGHT | SAP_VF_CHARIN, SAP_VF_OPTION, SAP_VF_NUMLEN | SAP_VF_CHAROUT |
| SAP_VF_SUBSTRING | SAP_VF_CHARIN, SAP_VF_OPTION, SAP_VF_NUMLEN, SAP_VF_NUMOFF | SAP_VF_CHAROUT |
| SAP_VF_VALUE_AT_INDEX | SAP_VF_OPTION, SAP_VF_CHARNAME, SAP_VF_INDEX | SAP_VF_CHAROUT, SAP_VF_NUMOUT |
| ZMFT_OMF_GET_LIFT_AND_WBS | TXT_REF_ORDER_NUMBER | TXT_FIELD_LIFT_NR, TXT_URN |
| Z_MFT_GEN_TASKID | KEY01..KEY10, ZCAT | ZID |
| Z_MFT_UPD_VTABLE | ZVTABLE, ZCT01..ZCT20, ZVAL01..ZVAL20 | （无） |

14 个 OD 含函数调用：NET_CN_ELEV (96 calls), PRO_CERTIFICATE (48), PRO_DOOR_DEF_META_MR (57), PRO_ELEV_COUNT_SPB (29), PRO_SCOPE_AND_REMARK_META_MR (29), NET_META_MR_ENG (28) 等。
