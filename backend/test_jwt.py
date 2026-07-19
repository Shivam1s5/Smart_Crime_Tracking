import urllib.request, json, urllib.error
try:
    req = urllib.request.Request('http://127.0.0.1:5000/api/auth/login', data=json.dumps({'username':'police', 'password':'police123'}).encode(), headers={'Content-Type': 'application/json'})
    res = urllib.request.urlopen(req)
    token = json.loads(res.read())['token']
    req2 = urllib.request.Request('http://127.0.0.1:5000/api/zones', headers={'Authorization': 'Bearer ' + token})
    urllib.request.urlopen(req2).read()
except urllib.error.HTTPError as e:
    print("Error code:", e.code)
    print("Body:", e.read())
