"""Picks a booted-capable simulator for the native audit: the newest iOS (an iPhone) or watchOS (an Apple Watch)."""
import json, sys

kind, path = sys.argv[1], sys.argv[2]
d = json.load(open(path))['devices']
tag = '.iOS-' if kind == 'ios' else '.watchOS-'
prefix = 'iPhone' if kind == 'ios' else 'Apple Watch'
runtimes = sorted([k for k in d if tag in k], key=lambda k: [int(p) for p in k.split(tag)[1].split('-') if p.isdigit()])
for k in reversed(runtimes):
    devs = [x for x in d[k] if x['name'].startswith(prefix)]
    if devs:
        sys.stderr.write('simulator: %s on %s\n' % (devs[-1]['name'], k))
        print(devs[-1]['udid'])
        break
