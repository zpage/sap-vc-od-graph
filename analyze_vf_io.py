#!/usr/bin/env python3
"""
analyze_vf_io.py — Variant Function I/O 分析

用 CARD_FUNCTION_READ 读取 variant function 的输入/输出 char 定义,
解析 OD 源码中的 FUNCTION 调用, 汇总每个 OD 中函数调用涉及的 char 方向。

用法:
  python analyze_vf_io.py                # 全量分析, 输出 JSON + 控制台汇总
  python analyze_vf_io.py --json FILE    # 用已有函数定义缓存, 跳过 SAP 查询
"""

import argparse, json, os, re, subprocess, sys

# Point these at your own sap-vc-cs build and OD graph cache.
# SAPVC_CS_BIN / SAPVC_CS_DIR / SAPVC_SYSTEM override the defaults.
BIN = os.environ.get("SAPVC_CS_BIN", "sap-vc-cs.exe")
BIN_DIR = os.environ.get("SAPVC_CS_DIR") or os.path.dirname(os.path.abspath(BIN))
SYSTEM = os.environ.get("SAPVC_SYSTEM", "Q1E")
_HERE = os.path.dirname(os.path.abspath(__file__))
OD_JSON = os.environ.get("SAPVC_OD_JSON", os.path.join(_HERE, "<MATNR>-od-graph.json"))
VF_CACHE = os.environ.get("SAPVC_VF_CACHE", os.path.join(_HERE, "variant_functions_<sid>.json"))
OUT_JSON = os.environ.get("SAPVC_OUT_JSON", os.path.join(_HERE, "vf_io_analysis_<sid>.json"))


def sap_call(func, *params, timeout=120):
    cmd = [BIN, "call", func] + list(params) + [f"--system={SYSTEM}"]
    try:
        r = subprocess.run(cmd, capture_output=True, timeout=timeout, cwd=BIN_DIR)
        return r.stdout.decode('utf-8', errors='replace'), r.returncode
    except Exception as e:
        return str(e), -1


def read_function_def(func_name):
    """读 CARD_FUNCTION_READ 返回 (inputs, outputs, all_params)."""
    out, rc = sap_call("CARD_FUNCTION_READ", f"FUNCTION_NAME={func_name}")
    if rc != 0 or "FUNCNAME" not in out:
        return None
    inputs, params = [], []
    in_alt = in_param = False
    for line in out.split("\n"):
        ls = line.strip()
        if "VAR_FUNCTION_ALT_INPUT = TABLE" in ls:
            in_alt = True; in_param = False; continue
        if "VAR_FUNCTION_PARAMETERS = TABLE" in ls:
            in_param = True; in_alt = False; continue
        if ls.startswith("T_") and "= TABLE" in ls:
            in_alt = in_param = False
        if in_alt and ls.startswith("["):
            m = re.search(r'CHARACT=([^,\s]+)', ls)
            if m: inputs.append(m.group(1))
        if in_param and ls.startswith("["):
            m = re.search(r'CHARACT=([^,\s]+)', ls)
            if m: params.append(m.group(1))
    outputs = [p for p in params if p not in inputs]
    return {"inputs": inputs, "outputs": outputs, "all": params}


def load_vf_defs(cache_path):
    """Load VF definitions from cache or fetch all from SAP."""
    if os.path.exists(cache_path):
        with open(cache_path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def parse_func_calls(text):
    """Parse FUNCTION xxx(...) blocks, return list of {func, params:[{param,op,value}]}."""
    results = []
    pattern = re.compile(r'FUNCTION\s+(\w+)\s*\(', re.IGNORECASE)
    for m in pattern.finditer(text):
        func_name = m.group(1)
        i = m.end()
        depth = 1
        while i < len(text) and depth > 0:
            if text[i] == '(': depth += 1
            elif text[i] == ')': depth -= 1
            i += 1
        body = text[m.end():i-1]
        params = []
        for pm in re.finditer(r'(?m)^\s*([A-Z][A-Z0-9_]*)\s*(\?=|=)\s*([^,\n]+)', body):
            params.append({"param": pm.group(1), "op": pm.group(2),
                           "value": pm.group(3).strip()})
        results.append({"func": func_name, "params": params})
    return results


def extract_chars(value):
    """Extract char names from a function param value."""
    chars = set()
    # $SELF.X, $self.x, MDATA $SELF.X, alias.X
    for m in re.finditer(r'\$SELF\.([A-Z][A-Z0-9_]*)|MDATA\s+\$SELF\.([A-Z][A-Z0-9_]*)', value, re.IGNORECASE):
        c = m.group(1) or m.group(2)
        if c: chars.add(c.upper())
    # Bare uppercase names (aliases, char refs in conditions)
    for m in re.finditer(r'(?<![A-Z0-9_])([A-Z][A-Z0-9_]{2,})(?!["\'])', value):
        c = m.group(1)
        if c not in ("FUNCTION", "MDATA", "SELF", "TABLE", "NOT"):
            chars.add(c)
    return sorted(chars)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", default=VF_CACHE, help="VF definitions cache path")
    args = ap.parse_args()

    # Load VF definitions
    vf_defs = load_vf_defs(args.json)
    if not vf_defs:
        print("VF cache empty — run variant_functions fetch first")
        sys.exit(1)

    # Load OD data
    with open(OD_JSON, "r", encoding="utf-8") as f:
        raw = json.load(f)
    deps = raw.get("Dependencies") or raw.get("dependencies") or []

    analysis = {}
    for d in deps:
        dep_name = d.get("name", "?")
        src = d.get("source", [])
        if isinstance(src, str):
            src = [src]
        text = "\n".join(src)

        # Also include constraint sources under CNET
        cons_texts = []
        for c in d.get("constraints", []):
            cs = c.get("source", [])
            if isinstance(cs, str):
                cs = [cs]
            cons_texts.append("\n".join(cs))
        all_text = text + "\n" + "\n".join(cons_texts)

        calls = parse_func_calls(all_text)
        if not calls:
            continue

        dep_io = {"calls": [], "char_in": [], "char_out": [], "char_io": []}
        for call in calls:
            fd = vf_defs.get(call["func"])
            if not fd:
                dep_io["calls"].append({"func": call["func"], "error": "no def"})
                continue
            inputs_set = set(fd.get("inputs", []))
            outputs_set = set(fd.get("outputs", []))
            call_info = {"func": call["func"], "params": []}
            for p in call["params"]:
                if p["param"] in outputs_set:
                    direction = "OUT"
                elif p["param"] in inputs_set:
                    direction = "IN"
                else:
                    direction = "?"
                chars = extract_chars(p["value"])
                call_info["params"].append({
                    "param": p["param"], "op": p["op"],
                    "direction": direction, "chars": chars,
                })
                for c in chars:
                    if direction == "OUT":
                        if c not in dep_io["char_out"]: dep_io["char_out"].append(c)
                    elif direction == "IN":
                        if c not in dep_io["char_in"]: dep_io["char_in"].append(c)
                    else:
                        if c not in dep_io["char_io"]: dep_io["char_io"].append(c)
            dep_io["calls"].append(call_info)
        analysis[dep_name] = dep_io

    # Save
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(analysis, f, ensure_ascii=False, indent=1)
    print(f"Saved: {OUT_JSON}")
    print(f"ODs with function calls: {len(analysis)}\n")

    for dep_name, dep_io in sorted(analysis.items()):
        n_calls = len(dep_io["calls"])
        n_in = len(dep_io["char_in"])
        n_out = len(dep_io["char_out"])
        print(f"{dep_name:32s} calls={n_calls:3d} in={n_in:3d} out={n_out:3d}")


if __name__ == "__main__":
    main()
