import json, os, sys
sys.stdout.reconfigure(encoding='utf-8')

with open('E:/tools/shimeng/_github_tree.json', encoding='utf-8') as f:
    data = json.load(f)

github = {x['path']: x.get('size', 0) for x in data['tree'] if x['type'] == 'blob'}

local_dir = "E:/tools/shimeng/拾梦v2.0/Ai 古风角色/生成trae"
local = {}
for root, dirs, files in os.walk(local_dir):
    dirs[:] = [d for d in dirs if d not in ['.git', '.DS_Store', '.claude']]
    for fname in files:
        if fname == '.DS_Store':
            continue
        full = os.path.join(root, fname)
        rel = os.path.relpath(full, local_dir).replace('\\', '/')
        local[rel] = os.path.getsize(full)

all_paths = sorted(set(list(local.keys()) + list(github.keys())))

skip_files = {'launch.json', 'settings.local.json', 'logo_original.png'}

print(f"{'文件路径':<48} {'本地(KB)':<10} {'GitHub(KB)':<12} 状态")
print("-" * 88)

diff_count = 0
only_local = 0
only_github = 0

for path in all_paths:
    fname = os.path.basename(path)
    if fname in skip_files or fname == '.DS_Store':
        continue

    l = local.get(path)
    g = github.get(path)

    if l is None:
        status = "[仅GitHub]"
        only_github += 1
    elif g is None:
        status = "[仅本地]"
        only_local += 1
    elif abs(l - g) < 50:
        status = "[一致]"
    else:
        diff = l - g
        pct = abs(diff) / g * 100 if g > 0 else 0
        status = "[不同 本地%s %.1fKB / %.0f%%]" % ('大' if diff > 0 else '小', abs(diff)/1024, pct)
        diff_count += 1

    ls = "%.1f" % (l/1024) if l is not None else "-"
    gs = "%.1f" % (g/1024) if g is not None else "-"
    print("%-48s %-10s %-12s %s" % (path, ls, gs, status))

print("\n汇总: 不一致 %d 个 / 仅本地 %d 个 / 仅GitHub %d 个" % (diff_count, only_local, only_github))
