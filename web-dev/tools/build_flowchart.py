#!/usr/bin/env python3
"""Build the original game's flowchart from the owner's prepared local game.

Native data supplies row order, connections, thumbnail selection, titles and
notes. Script JSON only supplies browser entry indices and migration evidence
for players who already have a dialogue-read history in this web port.
"""
import json
import os
from pathlib import Path
import re
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from native_flowchart import build as native_chart


def build(root, out=None):
    """out: where flowchart.json goes (build_ja.py: web/assets/ja, the original's titles and notes)."""
    root = Path(root).resolve()
    assets = root / "web/assets"
    chart = native_chart(root)
    index = json.loads((assets / "scripts/index.json").read_text())
    scripts = {i: json.loads((assets / f"scripts/{i}.json").read_text()) for i in range(len(index["names"]))}
    jump = index["jump"]

    def messages(i, visited=None):
        visited = set() if visited is None else visited
        if i in visited or i not in scripts:
            return []
        visited.add(i)
        ops = scripts[i]["ops"]
        ids = {int(n) for o in ops if o[0] in ("MSG", "MSAD") for n in re.findall(r"\$(\d+)", o[1] if len(o) > 1 else "")}
        # The native chart includes small FLAG scripts: follow their one onward
        # jump for read-history migration, but retain the wrapper as the entry.
        if not ids:
            for o in ops:
                if o[0] == "JUMP" and o[1] in jump:
                    ids.update(messages(jump[o[1]], visited))
        return sorted(ids)

    count, missing = 0, []
    for group in chart["groups"]:
        for part in group["parts"]:
            if part["flag"] <= 0:
                continue
            i = jump.get(str(part["jump"]))
            part["script"] = i
            part["lines"] = messages(i) if i is not None else []
            if i is None:
                missing.append(part["jump"])
            count += 1
    if missing:
        raise ValueError(f"Native flowchart jump targets missing from browser script index: {sorted(set(missing))}")
    path = (Path(out) if out else assets) / "flowchart.json"
    temp = path.with_suffix(".json.tmp")
    temp.write_text(json.dumps(chart, ensure_ascii=False, separators=(",", ":")))
    os.replace(temp, path)
    print(f"flowchart: {len(chart['groups'])} native rows, {count} scenes, {len(chart['transitions'])} transition records")
    return chart


if __name__ == "__main__":
    build(sys.argv[1] if len(sys.argv) > 1 else HERE.parents[1])
