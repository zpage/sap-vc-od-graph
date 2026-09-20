#!/usr/bin/env python3
"""
Phase 1 验证脚本：检查 dep 源码、VT 结构、class 分配中引用的所有 char
是否在 S4H 上存在。用于每个物料迁移的 Phase 1 之后。
Usage: python3 verify_chars.py <material_number> --system S4H
"""
import subprocess, os, json, re, sys

# Path to the sap-vc-cs CLI. Override with SAPVC_CS_BIN / SAPVC_CS_DIR.
BIN = os.environ.get('SAPVC_CS_BIN', 'sap-vc-cs.exe')
CWD = os.environ.get('SAPVC_CS_DIR') or os.path.dirname(os.path.abspath(BIN))

def run(args):
    r = subprocess.run([BIN] + args, capture_output=True, text=True, timeout=120, cwd=CWD)
    return r.stdout

def run_profile_deps(material):
    """Phase 0: Read config profile + deps from R1E"""
    out = run(['profile-deps', '--material', material, '--system', 'R1E', '--json'])
    return json.loads(out) if out else {}

def run_classes(material):
    """Phase 0: Read class assignments from R1E"""
    mat18 = material.zfill(18)
    out = run(['call', 'BAPI_OBJCL_GETCLASSES', '--system', 'R1E',
               'OBJECTKEY_IMP=' + mat18, 'OBJECTTABLE_IMP=MARA', 'CLASSTYPE_IMP=300'])
    classes = []
    for line in out.split('\n'):
        m = re.search(r'CLASSNUM=(\S+)', line)
        if m: classes.append(m.group(1).rstrip(','))
    return classes

def get_class_chars(class_name):
    """Read char list from R1E class"""
    out = run(['call', 'CARD_CLASS_READ', '--system', 'R1E',
               'CLASS=' + class_name, 'CLASS_TYPE=300'])
    chars = []
    for line in out.split('\n'):
        m = re.search(r'CHARACT=(\w+)', line)
        if m and m.group(1) not in chars:
            chars.append(m.group(1))
    return chars

def extract_self_chars(data):
    """Extract all $SELF. chars from dep source"""
    chars = set()
    for dep in data.get('dependencies', []):
        src = '\n'.join(dep.get('source', []))
        for m in re.finditer(r'\$SELF\.([A-Z][A-Z0-9_]*)', src):
            chars.add(m.group(1))
    return sorted(chars)

def check_on_s4h(chars):
    """Batch check char existence on S4H"""
    missing = []
    for ch in chars:
        out = run(['call', 'BAPI_CHARACT_EXISTENCECHECK', '--system', 'S4H',
                    'CHARACTNAME=' + ch])
        if 'already exists' not in out:
            missing.append(ch)
    return missing

def main(material):
    print(f"=== Phase 1 Char Verification for {material} ===")
    print()
    
    # Source 1: Dep source $SELF. refs
    print("Source 1: Dep source $SELF. references...")
    data = run_profile_deps(material)
    dep_chars = extract_self_chars(data)
    print(f"  Found {len(dep_chars)} unique chars in dep source")
    missing_dep = check_on_s4h(dep_chars)
    if missing_dep:
        print(f"  ❌ {len(missing_dep)} missing on S4H:")
        for ch in missing_dep:
            print(f"    {ch}")
    else:
        print(f"  ✅ All dep chars exist on S4H")

    # Source 2: Class assignment chars
    print("\nSource 2: Class assignment chars...")
    classes = run_classes(material)
    all_class_chars = set()
    for cls in classes:
        cls_chars = get_class_chars(cls)
        all_class_chars.update(cls_chars)
        print(f"  Class {cls}: {len(cls_chars)} chars")
    
    print(f"  Total unique chars from classes: {len(all_class_chars)}")
    missing_cls = check_on_s4h(list(all_class_chars))
    if missing_cls:
        print(f"  ❌ {len(missing_cls)} missing on S4H:")
        for ch in missing_cls[:10]:
            print(f"    {ch}")
        if len(missing_cls) > 10:
            print(f"    ... and {len(missing_cls)-10} more")
    else:
        print(f"  ✅ All class chars exist on S4H")

    # Summary
    all_missing = set(missing_dep + missing_cls)
    print(f"\n=== Summary ===")
    print(f"  Dep $SELF. chars: {len(dep_chars)}")
    print(f"  Class chars:      {len(all_class_chars)}")
    print(f"  Missing on S4H:   {len(all_missing)}")
    if all_missing:
        print(f"\n  ⚠️  Run create_missing_chars.py or create individually:")
        for ch in sorted(all_missing):
            print(f"    {ch}")
        return 1
    else:
        print(f"  ✅ All chars verified on S4H. Proceed to next phase.")
        return 0

if __name__ == '__main__':
    mat = sys.argv[1] if len(sys.argv) > 1 else '8000000623'
    sys.exit(main(mat))
