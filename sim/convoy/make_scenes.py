#!/usr/bin/env python3
"""Convert the reviewed script (sim/convoy/script.json) into sim/convoy/scenes.json for build_audio.py."""
import json, os, re
D = os.path.dirname(os.path.abspath(__file__))
RENDERERS = {'title', 'roles', 'requirements', 'prep', 'agenda', 'intro', 'pcc', 'risk', 'manifest', 'clearance', 'comms',
             'fuel', 'route', 'xchecks', 'march', 'serials', 'ccp', 'safety', 'backbrief', 'execution', 'quizintro', 'summary', 'end', 'casestudy'}
script = json.load(open(os.path.join(D, 'script.json')))
scenes, quiz = [], [s for s in script['scenes'] if s.get('quiz') or re.fullmatch(r'q\d+', s['id'])]
nq = len(quiz)
def clean(t): return re.sub(r'\s+', ' ', t.replace('—', ', ').replace('–', '-')).strip()
for s in script['scenes']:
    is_q = s in quiz
    if is_q and not any(x['id'] == 'quizintro' for x in scenes) and not any(x['id'] == 'quizintro' for x in script['scenes']):
        scenes.append({'id': 'quizintro', 'type': 'quizintro', 'kind': 'info', 'section': 'KNOWLEDGE CHECK', 'title': 'Knowledge Check', 'ref': '',
                       'text': f'Knowledge check. {nq} questions. Answer each one before the answer appears, and pause the video if you need more time.', 'onscreen': []})
    sc = {'id': s['id'], 'type': 'quiz' if is_q else (s['id'] if s['id'] in RENDERERS else 'cards'), 'kind': s.get('kind', 'info'),
          'title': s['title'], 'ref': s.get('ref', ''), 'text': clean(s['narration']), 'onscreen': [clean(b) for b in s.get('onscreen', [])]}
    if is_q:
        q = s['quiz']; num = quiz.index(s) + 1
        sc.update({'section': 'KNOWLEDGE CHECK', 'title': f'Question {num} of {nq}', 'num': num, 'of': nq, 'question': clean(q['question']),
                   'choices': [re.sub(r'^[A-D][.)]\s*', '', clean(c)) for c in q['choices']], 'answer': q['answer'].strip()[0].upper(),
                   'pause_after': {'0': 4.0}})
    elif s['id'] == 'quizintro':
        sc['section'] = 'KNOWLEDGE CHECK'
    scenes.append(sc)
json.dump({'target_seconds': 0, 'scenes': scenes}, open(os.path.join(D, 'scenes.json'), 'w'), indent=1, ensure_ascii=False)
print(len(scenes), 'scenes;', sum(len(x['text'].split()) for x in scenes), 'words')
