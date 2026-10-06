"""One opt-in real-engine RPC smoke, entirely localhost, with test TLS trust."""
import asyncio
import os
import ssl
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import engine


async def main():
    if '--engine' in sys.argv:
        from invisible_playwright.async_api import InvisiblePlaywright
        class TestLauncher(InvisiblePlaywright):
            async def __aenter__(self):
                browser = await super().__aenter__()
                original = browser.new_context
                async def test_context(**kwargs):
                    return await original(ignore_https_errors=True, **kwargs)
                browser.new_context = test_context
                return browser
        original_engine = engine.Engine
        class TestEngine(original_engine):
            async def evaluate(self, message):
                try:
                    return await super().evaluate(message)
                except Exception as error:
                    # Local fixture only: disclose type/message to diagnose the
                    # API contract, never enabled by the production worker.
                    sys.stderr.write(f'{type(error).__name__}: {error}\n')
                    raise
        engine.Engine = lambda: TestEngine(launcher=TestLauncher)
        await engine.main()
        return
    with tempfile.TemporaryDirectory(prefix='source-browser-smoke-') as temp:
        cert, key = Path(temp) / 'cert.pem', Path(temp) / 'key.pem'
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', str(key),
                        '-out', str(cert), '-days', '1', '-subj', '/CN=localhost'], check=True, capture_output=True)
        tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        tls.load_cert_chain(cert, key)
        async def handle(reader, writer):
            try:
                headers = await reader.readuntil(b'\r\n\r\n')
                assert b'referer: https://fixture.invalid/series/' in headers.lower()
                body = b'<html><title>RPC fixture</title><body>local-ok</body></html>'
                writer.write(b'HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nConnection: close\r\nContent-Length: '
                             + str(len(body)).encode() + b'\r\n\r\n' + body)
                await writer.drain()
            finally:
                writer.close()
        server = await asyncio.start_server(handle, '127.0.0.1', 0, ssl=tls)
        async with server:
            child = await asyncio.create_subprocess_exec('node', str(ROOT / 'tests/rpc-smoke.mjs'),
                                                        str(server.sockets[0].getsockname()[1]), sys.executable)
            assert await child.wait() == 0


asyncio.run(main())
