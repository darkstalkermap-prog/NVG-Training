#!/usr/bin/env python3
"""Bundle sim/index.html + timeline.js + narration.m4a into one self-contained page (build/NVG-Sim.html)."""
import base64, os, re
SIM = os.path.dirname(os.path.abspath(__file__)); BUILD = os.path.join(os.path.dirname(SIM), "build")
html = open(os.path.join(SIM, "index.html")).read()
tl = open(os.path.join(SIM, "timeline.js")).read()
aud = base64.b64encode(open(os.path.join(SIM, "narration.m4a"), "rb").read()).decode()
html = re.sub(r"<!doctype html>\s*<html[^>]*>\s*<head>\s*", "", html)
html = re.sub(r'<meta charset="utf-8">\s*<meta name="viewport"[^>]*>\s*', "", html)
html = html.replace("</title>", '</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n'
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700;800;900&display=swap">', 1)
html = html.replace(":root { --bg", ":root { color-scheme: dark; --bg", 1)
html = re.sub(r"</head>\s*<body>\s*", "", html)
html = re.sub(r"\s*</body>\s*</html>\s*$", "\n", html)
html = html.replace('src="narration.m4a"', f'src="data:audio/mp4;base64,{aud}"')
html = html.replace('<script src="timeline.js"></script>', "<script>\n" + tl + "</script>")
os.makedirs(BUILD, exist_ok=True)
out = os.path.join(BUILD, "NVG-Sim.html"); open(out, "w").write(html)
print(out, len(html) // 1024, "KB")
