#!/usr/bin/env python3
"""Upload today's dual-source raw evidence through the existing private Site gate."""
import base64
import hashlib
import json
import os
from pathlib import Path
import sys
from urllib.request import Request, build_opener
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from export_data import api_request, source_endpoint, RejectCredentialRedirects, ExportError
from scripts.domestic import ROOT


def upload():
    payload = json.loads((ROOT / 'reports/domestic-latest.json').read_text(encoding='utf-8'))
    captures = {}
    for source in payload['sources']:
        ref = source['capture']
        path = (ROOT / ref['path']).resolve()
        if not path.is_relative_to(ROOT.resolve()):
            raise ExportError('Capture path is outside the evidence root')
        raw = path.read_bytes()
        if hashlib.sha256(raw).hexdigest() != ref['sha256']:
            raise ExportError('Capture integrity check failed')
        captures[source['source']] = base64.b64encode(raw).decode('ascii')
    endpoint = source_endpoint(os.environ['JPI_API_URL']).removesuffix('/live') + '/observations'
    req, authenticated = api_request(endpoint)
    if not authenticated:
        raise ExportError('Authenticated Site service access is required for ingestion')
    raw = json.dumps({'observation': payload, 'captures': captures}, ensure_ascii=False).encode('utf-8')
    req = Request(endpoint, data=raw, headers={**dict(req.header_items()), 'Content-Type': 'application/json'}, method='POST')
    with build_opener(RejectCredentialRedirects()).open(req, timeout=45) as response:
        result = json.load(response)
    if result.get('status') != 'persisted' or result.get('formal_eligible') is not False:
        raise ExportError('No verified observation persistence receipt')
    print(json.dumps(result, ensure_ascii=False))
    return result


if __name__ == '__main__':
    upload()
