#!/usr/bin/env python3
"""Bundle a video page + its scripts + narration into one self-contained HTML file.
Usage: python3 sim/build_artifact.py [video_dir] [out.html]   (default: sim -> docs/index.html)"""
import base64, os, re, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VID = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(ROOT, "sim")
OUT = os.path.abspath(sys.argv[2]) if len(sys.argv) > 2 else os.path.join(ROOT, "docs", "index.html")
html = open(os.path.join(VID, "index.html")).read()
aud = base64.b64encode(open(os.path.join(VID, "narration.m4a"), "rb").read()).decode()
html = re.sub(r"<!doctype html>\s*<html[^>]*>\s*<head>\s*", "", html)
html = re.sub(r'<meta charset="utf-8">\s*<meta name="viewport"[^>]*>\s*', "", html)
html = html.replace("</title>", '</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n'
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700;800;900&display=swap">', 1)
html = html.replace(":root { --bg", ":root { color-scheme: dark; --bg", 1)
html = re.sub(r"</head>\s*<body>\s*", "", html)
html = re.sub(r"\s*</body>\s*</html>\s*$", "\n", html)
html = html.replace('src="narration.m4a"', f'src="data:audio/mp4;base64,{aud}"')
html = re.sub(r'<script src="([^"]+)"></script>', lambda m: "<script>\n" + open(os.path.join(VID, m.group(1))).read() + "</script>", html)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
open(OUT, "w").write(html)
print(OUT, len(html) // 1024, "KB")
