"""Opt-in API preflight using an existing engine, localhost mocks only.

No production URL policy is changed. A failing TLS mock intentionally prevents
external access; assertions inspect CONNECT authority and Basic authentication.
"""
import asyncio
import base64
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from engine import launch_options


async def main():
    from invisible_playwright.async_api import InvisiblePlaywright
    seen = []
    expected = 'Basic ' + base64.b64encode(b'probe-user:probe-password').decode()
    async def handler(reader, writer):
        try:
            data = (await asyncio.wait_for(reader.readuntil(b'\r\n\r\n'), 5)).decode()
            if f'Proxy-Authorization: {expected}'.lower() not in data.lower():
                writer.write(b'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="probe"\r\nContent-Length: 0\r\n\r\n')
            else:
                seen.append(data.split('\r\n')[0])
                writer.write(b'HTTP/1.1 200 Connection Established\r\n\r\n')
            await writer.drain()
        finally:
            writer.close()
    server = await asyncio.start_server(handler, '127.0.0.1', 0)
    proxy = dict(server=f'http://127.0.0.1:{server.sockets[0].getsockname()[1]}',
                 username='probe-user', password='probe-password', bypass='<-loopback>')
    os.environ['INVPW_TRUE_HEADLESS'] = '1'
    async with server, InvisiblePlaywright(**launch_options(os.environ['MOA_SOURCE_BROWSER_BINARY'])) as browser:
        assert browser.version == '151.0'
        context = await browser.new_context(proxy=proxy)
        await context.add_init_script("Object.defineProperty(navigator,'serviceWorker',{value:undefined,configurable:false,writable:false});")
        page = await context.new_page()
        effective = await page.evaluate("({serviceWorker: !!navigator.serviceWorker})")
        assert effective['serviceWorker'] is False, effective
        for target in ('https://proxy-preflight.invalid/', 'https://127.0.0.1:44333/'):
            try:
                await page.goto(target, timeout=6000)
            except Exception:
                pass
        await context.close()
    assert 'CONNECT proxy-preflight.invalid:443 HTTP/1.1' in seen, seen
    assert 'CONNECT 127.0.0.1:44333 HTTP/1.1' in seen, seen
    print('PASS Firefox 151.0: new_context authenticated HTTP proxy; localhost bypass disabled; service workers absent')


asyncio.run(main())
