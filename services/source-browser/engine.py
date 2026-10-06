"""GPL-3.0-or-later. Private JSONL worker; no RPC listener or disk cookies."""
import asyncio
import contextlib
import json
import os
import signal
import sys
import time
from urllib.parse import urlsplit

RESPONSE_LIMIT = 4 * 1024 * 1024
MEDIA_SUFFIXES = ('.mp4', '.m3u8', '.mpd', '.ts', '.m4s', '.webm', '.mp3', '.aac', '.ogg', '.mkv', '.mov')
CHALLENGE_SELECTOR = '#challenge-running, #challenge-stage, #challenge-form, #cf-challenge-running, .cf-browser-verification'
CHALLENGE_TITLES = ('just a moment', 'checking your browser', '잠시만 기다리', 'attention required', 'un momento')


def origin(url):
    parsed = urlsplit(url)
    return parsed.scheme, parsed.hostname, parsed.port or 443


def allow_request(url, resource_type):
    """The Node CONNECT gate remains the authority for DNS/address pinning."""
    parsed = urlsplit(url)
    return (parsed.scheme == 'https' and not parsed.username and not parsed.password
            and resource_type != 'media' and not parsed.path.lower().endswith(MEDIA_SUFFIXES))


async def challenge_present(page):
    title = (await page.title()).strip().lower()
    if any(marker in title for marker in CHALLENGE_TITLES):
        return True
    for frame in page.frames:
        if await frame.locator(CHALLENGE_SELECTOR).count():
            return True
    return False


async def clear_challenge(page, deadline):
    """Small locator-only interstitial waiter; no third-party solver vendored."""
    next_click = 0
    while time.monotonic() < deadline:
        try:
            if not await challenge_present(page):
                await asyncio.sleep(.25)
                if not await challenge_present(page):
                    return
            if time.monotonic() >= next_click:
                for frame in page.frames:
                    token = frame.locator('input[name="cf-turnstile-response"]')
                    if await token.count() and await token.first.input_value(timeout=750):
                        continue
                    clicked = False
                    for depth in range(1, 5):
                        widget = frame.locator(f'input[name="cf-turnstile-response"] >> xpath=ancestor::div[{depth}]')
                        if not await widget.count():
                            continue
                        box = await widget.first.bounding_box(timeout=750)
                        if box and box['width'] >= 40 and 20 < box['height'] < 120:
                            await page.mouse.click(box['x'] + 25, box['y'] + box['height'] / 2)
                            clicked = True
                            break
                    if clicked:
                        next_click = time.monotonic() + 4
                        break
        except Exception:
            # Navigation replaces locators while the challenge is clearing.
            pass
        await asyncio.sleep(.25)
    raise RuntimeError('source_challenge_timeout')


def launch_options(binary=None):
    return dict(headless=True, humanize=True, timezone='Asia/Seoul', locale='ko-KR', binary_path=binary,
                extra_prefs={
                    'devtools.jsonview.enabled': False,
                    'browser.tabs.remote.useCrossOriginOpenerPolicy': False,
                    'browser.tabs.remote.useCrossOriginEmbedderPolicy': False,
                    'media.peerconnection.enabled': False,
                    'network.trr.mode': 5,
                    'network.dns.disablePrefetch': True,
                    'network.prefetch-next': False,
                    'network.http.speculative-parallel-limit': 0,
                    'network.websocket.max-connections': 0,
                    # No launch-time proxy argument: that triggers a Python
                    # egress/geo probe outside browser policy. Global browser
                    # traffic fails closed; new_context overrides this proxy.
                    'network.proxy.type': 1,
                    'network.proxy.http': '127.0.0.1',
                    'network.proxy.http_port': 9,
                    'network.proxy.ssl': '127.0.0.1',
                    'network.proxy.ssl_port': 9,
                    'network.proxy.no_proxies_on': '',
                    'network.proxy.allow_hijacking_localhost': True,
                })


class Engine:
    def __init__(self, launcher=None):
        self.launcher = launcher
        self.manager = None
        self.browser = None
        self.contexts = {}
        self.requests = {}
        self.launch_lock = asyncio.Lock()
        self.context_lock = asyncio.Lock()

    async def get_browser(self):
        async with self.launch_lock:
            if self.browser and self.browser.is_connected():
                return self.browser
            if self.manager:
                await self.manager.__aexit__(None, None, None)
                self.contexts.clear()
            if self.launcher is None:
                from invisible_playwright.async_api import InvisiblePlaywright
                self.launcher = InvisiblePlaywright
            # binary_path always resolves an already installed seal-verified
            # engine. The runtime never downloads a missing browser.
            binary = os.environ.get('MOA_SOURCE_BROWSER_BINARY')
            if not binary or not os.path.isfile(binary):
                raise RuntimeError('source_browser_unavailable')
            os.environ['INVPW_TRUE_HEADLESS'] = '1'
            self.manager = self.launcher(**launch_options(binary))
            self.browser = await self.manager.__aenter__()
            if self.browser.version != '151.0':
                await self.close()
                raise RuntimeError('source_browser_version')
            return self.browser

    async def close_context(self, key):
        self.requests.pop(key, None)
        async with self.context_lock:
            context = self.contexts.pop(key, None)
            if context:
                await context.close()
            if not self.contexts and self.manager:
                await self.manager.__aexit__(None, None, None)
                self.browser = self.manager = None

    async def evaluate(self, message):
        key, request = message['key'], message['request']
        deadline = time.monotonic() + request['timeoutMs'] / 1000
        page = None
        try:
            async with asyncio.timeout_at(deadline):
                context = self.contexts.get(key)
                if context is None:
                    async with self.context_lock:
                        browser = await self.get_browser()
                        context = await browser.new_context(proxy=message['proxy'])
                        self.contexts[key] = context
                    # INV requires the service-worker interception pref ON for
                    # route(). Disable page registration at initialization in
                    # every frame instead; all actual transport still pins IPs.
                    await context.add_init_script("Object.defineProperty(navigator,'serviceWorker',{value:undefined,configurable:false,writable:false});")
                    async def route_handler(route):
                        if allow_request(route.request.url, route.request.resource_type):
                            current = self.requests.get(key)
                            if current and current['headers'] and origin(route.request.url) == origin(current['url']):
                                headers = {k.lower(): v for k, v in route.request.headers.items()}
                                headers.update({k.lower(): v for k, v in current['headers'].items()})
                                await route.continue_(headers=headers)
                            else:
                                await route.continue_()
                        else:
                            await route.abort()
                    await context.route('**/*', route_handler)
                self.requests[key] = request
                page = await context.new_page()
                # Close every popup, while allowing content/challenge iframes.
                def close_popup(popup):
                    task = asyncio.create_task(popup.close())
                    task.add_done_callback(lambda t: None if t.cancelled() else t.exception())
                page.on('popup', close_popup)
                latest_document = {}
                def document_response(response):
                    if response.request.resource_type == 'document' and response.request.frame == page.main_frame:
                        latest_document['response'] = response
                page.on('response', document_response)
                response = await page.goto(request['url'], wait_until='domcontentloaded',
                                           timeout=max(1, int((deadline - time.monotonic()) * 1000)))
                mitigated = response and response.headers.get('cf-mitigated') == 'challenge'
                await clear_challenge(page, deadline)
                # A challenge response without recognized DOM is still denied.
                latest = latest_document.get('response', response)
                # INV does not reliably emit document response events. A real
                # nonchallenge DOM after solver completion is the authority;
                # do not retain the initial 403 across challenge navigation.
                if mitigated and await challenge_present(page):
                    raise RuntimeError('source_challenge_timeout')
                if latest and latest.status >= 400 and not mitigated:
                    raise RuntimeError('source_http_failed')
                result = await page.evaluate(request['script'])
                if await challenge_present(page):
                    raise RuntimeError('source_challenge_timeout')
                encoded = json.dumps({'result': result}, ensure_ascii=False, allow_nan=False, separators=(',', ':'))
                if len(encoded.encode()) > RESPONSE_LIMIT:
                    raise RuntimeError('source_body_limit')
                return {'result': result}
        except BaseException:
            await self.close_context(key)
            raise
        finally:
            self.requests.pop(key, None)
            if page:
                with contextlib.suppress(Exception):
                    await page.close()

    async def close(self):
        for key in list(self.contexts):
            await self.close_context(key)
        if self.manager:
            await self.manager.__aexit__(None, None, None)
        self.browser = self.manager = None


async def main():
    protocol = sys.stdout
    # Library/browser prints must never corrupt the private stdout protocol.
    sys.stdout = sys.stderr
    engine, tasks = Engine(), {}
    def emit(message):
        protocol.write(json.dumps(message, ensure_ascii=False, allow_nan=False, separators=(',', ':')) + '\n')
        protocol.flush()
    async def run(message):
        try:
            result = await engine.evaluate(message)
        except asyncio.CancelledError:
            result = {'error': 'source_cancelled'}
        except TimeoutError:
            result = {'error': 'source_request_timeout'}
        except Exception as error:
            code = str(error)
            result = {'error': code if code.startswith('source_') and code.replace('_', '').isalpha() else 'source_browser_failed'}
        finally:
            tasks.pop(message['id'], None)
        emit({'id': message['id'], **result})
    loop = asyncio.get_running_loop()
    reader = asyncio.StreamReader(limit=512 * 1024 + 4096)
    await loop.connect_read_pipe(lambda: asyncio.StreamReaderProtocol(reader), sys.stdin)
    current = asyncio.current_task()
    for name in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(name, current.cancel)
    try:
        while line := await reader.readline():
            message = json.loads(line)
            if message['op'] == 'evaluate':
                tasks[message['id']] = asyncio.create_task(run(message))
            elif message['op'] == 'cancel':
                task = tasks.get(message['target'])
                if task:
                    task.cancel()
                    await asyncio.gather(task, return_exceptions=True)
                emit({'id': message['id'], 'result': True})
            elif message['op'] == 'close':
                await engine.close_context(message['key'])
                emit({'id': message['id'], 'result': True})
            else:
                emit({'id': message['id'], 'error': 'source_request_invalid'})
    finally:
        remaining = list(tasks.values())
        for task in remaining:
            task.cancel()
        await asyncio.gather(*remaining, return_exceptions=True)
        await engine.close()


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except (Exception, KeyboardInterrupt, asyncio.CancelledError):
        sys.stderr.write('source_browser_engine_stopped\n')
