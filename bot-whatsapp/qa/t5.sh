ph=$1; shift
m(){ curl -s -m 10 -XPOST localhost:3000/demo/mensaje -H 'content-type: application/json' -d "$(python3 -c "import json,sys;print(json.dumps({'phone':sys.argv[1],'text':sys.argv[2]}))" "$ph" "$1")" | python3 -c "
import sys,json
try:
  d=json.load(sys.stdin);print('>>',sys.argv[1][:50].replace('\n',' '));print('  ',d.get('reply','')[:300].replace('\n',' / '))
except Exception as e: print('>>',sys.argv[1][:50],'ERROR',e)" "$1"; }
for t in "$@"; do m "$t"; done
