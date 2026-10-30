#!/usr/bin/env python3
"""Validate the merged base/dev Compose configuration without claiming container execution."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shlex
import subprocess


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--compose-command',default='docker compose')
    parser.add_argument('--report',type=Path)
    args=parser.parse_args()
    root=Path(__file__).resolve().parents[1]
    def config(file,**overrides):
        env={**os.environ,**overrides,'DB_URL':'jdbc:mysql://host-loopback-must-not-leak:3306/wrong'}
        result=subprocess.run(shlex.split(args.compose_command)+['--env-file','.env.example','-f',file,'config','--format','json'],cwd=root,env=env,capture_output=True,check=True,text=True)
        return json.loads(result.stdout)
    base=config('compose.yaml',APP_BIND_IP='192.0.2.20',APP_PORT='18081')
    dev=config('compose-dev.yml',APP_BIND_IP='192.0.2.20',APP_PORT='18081')
    assert base['services']['backend']['ports'][0]['host_ip']=='127.0.0.1'
    assert base['services']['backend']['ports'][0]['published']=='8080'
    assert dev['services']['backend']['ports'][0]['host_ip']=='192.0.2.20'
    assert dev['services']['backend']['ports'][0]['published']=='18081'
    assert len(dev['services']['backend']['ports'])==1
    assert base['services']['mysql']['volumes'][0]['source']=='mysql-data'
    assert dev['services']['mysql']['volumes'][0]['source']=='dev-mysql-data'
    assert len(dev['services']['mysql']['volumes'])==1
    assert set(dev['volumes'])=={'dev-mysql-data'}
    for cfg in [base,dev]:
        assert cfg['services']['backend']['environment']['DB_URL'].startswith('jdbc:mysql://mysql:3306/')
        assert cfg['services']['mysql']['ports'][0]['host_ip']=='127.0.0.1'
        assert set(cfg['services'])=={'backend','mysql'}
    assert 'SPRING_FLYWAY_LOCATIONS' not in base['services']['backend']['environment']
    backend=dev['services']['backend']
    assert backend['environment']['SPRING_FLYWAY_LOCATIONS']=='classpath:db/migration,filesystem:/app/dev-sql'
    mount=backend['volumes'][0]
    assert mount['target']=='/app/dev-sql' and mount['read_only'] and Path(mount['source'])==root/'dev/sql'
    report={'status':'PASS','checkedAt':datetime.now(timezone.utc).isoformat(),'scope':'Compose config parsing only; Docker Engine/container/volume lifecycle not executed',
            'checks':['base loopback binding unchanged','dev APP_BIND_IP/APP_PORT override, single published app port',
                      'normal mysql-data and isolated dev-mysql-data, one MySQL mount',
                      'dev-only readonly SQL mount and Flyway locations','no init container','container DB_URL isolated from host environment']}
    if args.report:args.report.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(report,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
