import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from scripts.publish_dashboard import publish, git

class PublisherTests(unittest.TestCase):
    def cmd(self,*args):
        return subprocess.run(['git',*map(str,args)],check=True,capture_output=True,text=True).stdout.strip()
    def setup_repo(self,root):
        remote=root/'origin.git';writer=root/'writer';runner=root/'runner'
        self.cmd('init','--bare','--initial-branch=main',remote);self.cmd('clone',remote,writer)
        self.cmd('-C',writer,'config','user.name','Synthetic test');self.cmd('-C',writer,'config','user.email','test@example.invalid')
        (writer/'code.txt').write_text('original')
        self.cmd('-C',writer,'add','.');self.cmd('-C',writer,'commit','-m','base');self.cmd('-C',writer,'push','origin','main');self.cmd('clone',remote,runner)
        return remote,writer,runner
    def snapshot(self,root,minute=1):
        p=root/'snapshot.json';p.write_text(json.dumps({'source_updated_at':f'2026-11-01T07:{minute:02}:00Z','stale':False,'snapshot_hash':str(minute)*64,'matches':[{'id':'synthetic'}]}));return p
    def advance(self,writer,name='code.txt'):
        (writer/name).write_text('new code remains');self.cmd('-C',writer,'add',name);self.cmd('-C',writer,'commit','-m','advance code');self.cmd('-C',writer,'push','origin','main')
    def test_old_checkout_publishes_only_snapshot_on_latest_code(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);remote,writer,runner=self.setup_repo(root);self.advance(writer);result=publish(runner,self.snapshot(root))
            self.assertEqual(result['status'],'PUBLISHED');self.assertEqual(self.cmd('--git-dir',remote,'show','main:code.txt'),'new code remains')
            self.assertEqual(json.loads(self.cmd('--git-dir',remote,'show','main:dashboard_data.json'))['snapshot_hash'],'1'*64)
    def test_actual_push_race_retries_without_losing_remote_code(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);remote,writer,runner=self.setup_repo(root);raced=[False]
            def intercept(repo,*args):
                if args[:2]==('push','origin') and not raced[0]:
                    raced[0]=True;self.advance(writer,'concurrent.txt')
                return git(repo,*args)
            with patch('scripts.publish_dashboard.git',side_effect=intercept):result=publish(runner,self.snapshot(root))
            self.assertEqual(result['attempt'],2);self.assertEqual(self.cmd('--git-dir',remote,'show','main:concurrent.txt'),'new code remains')
    def test_late_old_delivery_preserves_newer_snapshot(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);remote,writer,runner=self.setup_repo(root);publish(runner,self.snapshot(root,2));head=self.cmd('--git-dir',remote,'rev-parse','main')
            result=publish(runner,self.snapshot(root,1));self.assertEqual(result['status'],'CURRENT_SNAPSHOT_NEWER');self.assertEqual(self.cmd('--git-dir',remote,'rev-parse','main'),head)
