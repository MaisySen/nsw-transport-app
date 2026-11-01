"""Picks a booted-capable simulator for the native audit: the newest iOS (an iPhone) or watchOS (an Apple Watch)."""
import json, sys

kind, path = sys.argv[1], sys.argv[2]
# 'phone' (the entry job): an ordinary one-screen iPhone, as simctl io screenshot needs. The newest device type on the
# runner was "iPhone Duo" (two displays), where every screenshot failed with nothing kept (run 41283876166).
plain = kind == 'phone'
if plain: kind = 'ios'
d = json.load(open(path))['devices']
tag = '.iOS-' if kind == 'ios' else '.watchOS-'
prefix = 'iPhone' if kind == 'ios' else 'Apple Watch'
runtimes = sorted([k for k in d if tag in k], key=lambda k: [int(p) for p in k.split(tag)[1].split('-') if p.isdigit()])
for k in reversed(runtimes):
    devs = [x for x in d[k] if x['name'].startswith(prefix)]
    if plain:
        devs = [x for x in devs if not any(w in x['name'] for w in ('Duo', 'Fold', 'Flip'))]
        pro = [x for x in devs if x['name'].endswith(' Pro')]
        devs = pro or devs
    if devs:
        sys.stderr.write('simulator: %s on %s\n' % (devs[-1]['name'], k))
        print(devs[-1]['udid'])
        break
