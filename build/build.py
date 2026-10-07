#!/usr/bin/env python3
"""Assemble the single-file Crowd Control build:
head.html + three.min.js + logic.js + game.js -> index.html
Usage: python3 build.py [output_path]
Default output: ~/workspace/your_files/crowd-control/index.html"""
import pathlib
import sys

root = pathlib.Path(__file__).parent
head = (root / "head.html").read_text()
three = (root / "three.min.js").read_text()
logic = (root / "logic.js").read_text()
game = (root / "game.js").read_text()

out = (
    head                      # head.html already ends with an open <script> tag
    + three + "\n</script>\n"
    + "<script>\n" + logic + "\n</script>\n"
    + "<script>\n" + game + "\n</script>\n"
    + "</body>\n</html>\n"
)

if len(sys.argv) > 1:
    dest = pathlib.Path(sys.argv[1])
else:
    dest = pathlib.Path.home() / "workspace" / "your_files" / "crowd-control" / "index.html"
dest.parent.mkdir(parents=True, exist_ok=True)
dest.write_text(out)
print("wrote", dest, f"({len(out) / 1024:.0f} KB)")
