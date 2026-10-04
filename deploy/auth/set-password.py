#!/usr/bin/env python3
"""Bootstrap credentials, or reset one existing administrator in sessions.sqlite."""
import argparse
import getpass
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import tempfile

root = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--database', type=Path, default=root / 'data/auth/sessions/sessions.sqlite')
parser.add_argument('--credentials', type=Path, default=root / 'data/auth/config/credentials.json')
args = parser.parse_args()
username = input('MOA 관리자 아이디: ').strip()
password = getpass.getpass('새 비밀번호 (8자 이상): ')
if not 8 <= len(password) <= 1024 or password != getpass.getpass('비밀번호 확인: '):
    raise SystemExit('비밀번호는 8~1024자이고 확인과 일치해야 합니다.')
salt = secrets.token_bytes(30)
verifier = hashlib.scrypt(password.encode(), salt=salt, n=32768, r=8, p=1, maxmem=64 * 1024 * 1024, dklen=64)
if args.database.exists():
    with sqlite3.connect(args.database) as db:
        db.execute('PRAGMA busy_timeout=5000')
        db.execute('BEGIN IMMEDIATE')
        if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='accounts'").fetchone():
            raise SystemExit('먼저 새 인증 서버를 한 번 기동해 계정을 이관하세요.')
        user = db.execute("SELECT id FROM accounts WHERE username=? COLLATE NOCASE AND role='admin'", (username,)).fetchone()
        if not user:
            raise SystemExit('기존 관리자 계정을 찾을 수 없습니다.')
        db.execute('UPDATE accounts SET salt=?,hash=? WHERE id=?', (salt.hex(), verifier.hex(), user[0]))
        db.execute('DELETE FROM sessions WHERE account_id=?', (user[0],))
    print('관리자 비밀번호를 변경했습니다. 해당 계정 세션만 만료되며 재시작은 필요 없습니다.')
else:
    if not re.fullmatch(r'[a-zA-Z0-9._-]{2,32}', username):
        raise SystemExit('아이디는 영문, 숫자, 점, 밑줄, 하이픈 2~32자로 입력하세요.')
    if args.credentials.exists():
        raise SystemExit('기존 credentials 파일이 있습니다. DB 경로를 확인하거나 먼저 인증 서버를 기동하세요.')
    config = {'users': [{'username': username.lower(), 'salt': salt.hex(), 'hash': verifier.hex()}], 'csrfSecret': secrets.token_hex(32)}
    args.credentials.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(dir=args.credentials.parent)
    try:
        with os.fdopen(fd, 'w') as out:
            json.dump(config, out)
        os.replace(temporary, args.credentials)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    print('최초 관리자 로그인 정보를 생성했습니다. 인증 서버 첫 기동 시 DB에 이관됩니다.')
