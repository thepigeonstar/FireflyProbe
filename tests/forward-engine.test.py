import contextlib
import copy
import importlib.util
import io
import json
import pathlib
import tempfile
import threading
import unittest
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch
from types import SimpleNamespace

source = pathlib.Path(__file__).resolve().parents[1]/'tools'/'forward-engine.py'
spec = importlib.util.spec_from_file_location('engine', source)
engine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine)


class EngineTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        root = pathlib.Path(self.directory.name)
        engine.ROOT, engine.MANIFESTS, engine.BACKUPS = root/'engine', root/'manifests', root/'backups'
        engine.ROOT.mkdir(); engine.MANIFESTS.mkdir()
        self.owner = str(uuid.uuid4())
        self.rules = [dict(id=str(uuid.uuid4()), protocol=p, listen_port=10000+i, target_host='127.0.0.1', target_port=8080, installed=True, state='stopped' if i==2 else 'running') for i,p in enumerate(['tcp','both','udp'])]
        self.running = {engine.UNIT:False, **{'firefly-forward-'+r['id']:r['state']=='running' for r in self.rules}}
        self.listed, self.counters, self.calls = {}, {}, []
        self.fail_port = None
        owner = self
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path=='/metrics':
                    text = 'gost_services 3\n'
                    for name in ['legacy']+list(owner.counters):
                        rx,tx = owner.counters.get(name, (100,200))
                        text += 'gost_service_transfer_input_bytes_total{service="%s"} %d\ngost_service_transfer_output_bytes_total{service="%s"} %d\n' % (name,rx,name,tx)
                    self.send_response(200);self.end_headers();self.wfile.write(text.encode());return
                state = engine.read(engine.ROOT/'state.json')
                expected='Basic '+engine.base64.b64encode(('firefly:'+state['password']).encode()).decode()
                if self.headers.get('Authorization')!=expected:
                    self.send_response(401);self.end_headers();return
                self.send_response(200);self.end_headers();self.wfile.write(json.dumps({'code':0,'data':{'count':len(owner.listed),'list':list(owner.listed.values())}}).encode())
            def do_POST(self):
                value=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                if value['addr']==':'+str(owner.fail_port):
                    self.send_response(500);self.end_headers();return
                owner.listed[value['name']]=value;owner.counters.setdefault(value['name'],(0,0));owner.calls.append(('add',value['name']));self.send_response(200);self.end_headers();self.wfile.write(b'{"code":0}')
            def do_DELETE(self):
                name=self.path.rsplit('/',1)[1];owner.listed.pop(name,None);owner.calls.append(('delete',name));self.send_response(200);self.end_headers();self.wfile.write(b'{"code":0}')
            def log_message(self,*args): pass
        self.server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        for r in self.rules:
            engine.write(engine.MANIFESTS/(r['id']+'.json'),dict(id=r['id'],epoch=str(uuid.uuid4()),port=self.server.server_port))
        self.patches=[patch.object(engine,'manager',side_effect=self.manager),patch.object(engine,'install_unit'),patch.object(engine,'choose_port',return_value=self.server.server_port)]
        for p in self.patches:p.start()
        self.output=io.StringIO();self.capture=contextlib.redirect_stdout(self.output);self.capture.__enter__()

    def tearDown(self):
        self.capture.__exit__(None,None,None)
        for p in self.patches:p.stop()
        self.server.shutdown();self.server.server_close();self.thread.join();self.directory.cleanup()

    def manager(self, action, unit=engine.UNIT):
        self.calls.append((action,unit))
        if action=='status':return self.running.get(unit,False)
        self.running[unit]=action=='start'
        if unit==engine.UNIT and action=='start':
            state=engine.read(engine.ROOT/'state.json');state['process_epoch']=str(uuid.uuid4());engine.persist(state)
            self.listed={s['name']:s for s in engine.config(state)['services']}

    def payload(self, action, **values):return dict(owner=self.owner,action=action,rules=copy.deepcopy(self.rules),**values)

    def test_migration_stop_resume_edit_preserve_other_service(self):
        engine.migrate(self.payload('migrate'));state=engine.read(engine.ROOT/'state.json');self.assertEqual(state['mode'],'shared');self.assertEqual(len(self.listed),3)
        self.assertTrue(self.running[engine.UNIT]);self.assertTrue(all(not self.running['firefly-forward-'+r['id']] for r in self.rules))
        self.assertEqual(len(list(engine.BACKUPS.glob('*/legacy.json'))),1)
        a,b=self.rules[:2];before=(engine.MANIFESTS/(b['id']+'.json')).read_bytes();b_names=engine.service_names(state['rules'][b['id']]);self.calls.clear()
        engine.apply(self.payload('stop',id=a['id']));self.assertFalse(engine.read(engine.ROOT/'state.json')['rules'][a['id']]['active']);self.assertEqual((engine.MANIFESTS/(b['id']+'.json')).read_bytes(),before);self.assertTrue(set(b_names)<=set(self.listed));self.assertNotIn(('stop',engine.UNIT),self.calls)
        first_generation=state['rules'][a['id']]['generation'];engine.apply(self.payload('resume',id=a['id']));self.assertNotEqual(engine.read(engine.ROOT/'state.json')['rules'][a['id']]['generation'],first_generation)
        replacement={**a,'id':str(uuid.uuid4()),'target_port':9090};payload=self.payload('edit',id=a['id'],replacement_id=replacement['id']);payload['rules'].append(replacement);engine.apply(payload);self.assertFalse((engine.MANIFESTS/(a['id']+'.json')).exists());self.assertTrue((engine.MANIFESTS/(replacement['id']+'.json')).exists());self.assertEqual((engine.MANIFESTS/(b['id']+'.json')).read_bytes(),before)

    def test_failed_migration_restores_old_processes_and_manifests(self):
        self.fail_port=self.rules[1]['listen_port'];old={p.name:p.read_bytes() for p in engine.MANIFESTS.glob('*.json')}
        with self.assertRaises(Exception):engine.migrate(self.payload('migrate'))
        self.assertFalse(self.running[engine.UNIT]);self.assertTrue(self.running['firefly-forward-'+self.rules[0]['id']]);self.assertTrue(self.running['firefly-forward-'+self.rules[1]['id']]);self.assertFalse(self.running['firefly-forward-'+self.rules[2]['id']]);self.assertEqual(old,{p.name:p.read_bytes() for p in engine.MANIFESTS.glob('*.json')})

    def test_failed_edit_restores_target_only(self):
        engine.migrate(self.payload('migrate'));a,b=self.rules[:2];before=(engine.MANIFESTS/(b['id']+'.json')).read_bytes();replacement={**a,'id':str(uuid.uuid4()),'listen_port':12345};self.fail_port=12345;payload=self.payload('edit',id=a['id'],replacement_id=replacement['id']);payload['rules'].append(replacement)
        with self.assertRaises(Exception):engine.apply(payload)
        state=engine.read(engine.ROOT/'state.json');self.assertIn(a['id'],state['rules']);self.assertNotIn(replacement['id'],state['rules']);self.assertEqual((engine.MANIFESTS/(b['id']+'.json')).read_bytes(),before);self.assertTrue(set(engine.service_names(state['rules'][a['id']]))<=set(self.listed))

    def test_owner_mismatch_and_final_samples_service_filter(self):
        engine.migrate(self.payload('migrate'));state=engine.read(engine.ROOT/'state.json');a=self.rules[0];entry=state['rules'][a['id']];name=engine.service_names(entry)[0];self.counters[name]=(31,42)
        result=engine.snapshot(entry,engine.MANIFESTS/(a['id']+'.json'));self.assertEqual((result['rx'],result['tx']),(31,42));self.assertNotEqual(result['epoch'],state['process_epoch'])
        payload=self.payload('migrate');payload['owner']=str(uuid.uuid4())
        with self.assertRaisesRegex(RuntimeError,'其他节点'):engine.migrate(payload)

    def test_failed_rollback_restores_shared_engine(self):
        engine.migrate(self.payload('migrate'));payload=self.payload('rollback',legacy=[{'id':r['id'],'script':r['id']} for r in self.rules[:2]]);calls=[]
        def run(command,**kwargs):
            ident=kwargs['input'];calls.append(ident);self.running['firefly-forward-'+ident]=True
            return SimpleNamespace(returncode=1 if len(calls)==2 else 0)
        with patch.object(engine.subprocess,'run',side_effect=run):
            with self.assertRaises(Exception):engine.rollback(payload)
        self.assertTrue(self.running[engine.UNIT]);self.assertEqual(engine.read(engine.ROOT/'state.json')['mode'],'shared');self.assertTrue(all(not self.running['firefly-forward-'+r['id']] for r in self.rules))

    def test_status_is_readonly_when_engine_stopped(self):
        engine.migrate(self.payload('migrate'));self.running[engine.UNIT]=False;self.calls.clear()
        engine.apply(self.payload('status',id=self.rules[0]['id']))
        self.assertNotIn(('start',engine.UNIT),self.calls)


if __name__=='__main__':unittest.main()
