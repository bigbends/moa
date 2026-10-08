import asyncio
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from engine import Engine, allow_request, challenge_present, clear_challenge, launch_options


class PolicyTests(unittest.TestCase):
    def test_media_denied_iframe_allowed(self):
        for url, kind in [('https://example.com/video', 'media'), ('https://example.com/a.M3U8?token=x', 'fetch'), ('http://example.com/', 'document'), ('https://user:p@example.com/', 'document')]:
            self.assertFalse(allow_request(url, kind))
        self.assertTrue(allow_request('https://example.com/player', 'document'))

    def test_launch_contract_has_no_unsupported_args_or_network_geo(self):
        options = launch_options('/existing/firefox')
        self.assertNotIn('proxy', options)
        self.assertEqual(options['locale'], 'ko-KR')
        self.assertEqual(options['executable_path'], '/existing/firefox')
        self.assertTrue(options['headless'])
        self.assertTrue(options['humanize'])
        self.assertFalse(options['geoip'])
        self.assertTrue(options['main_world_eval'])
        self.assertEqual(options['config']['timezone'], 'Asia/Seoul')
        prefs = options['firefox_user_prefs']
        self.assertNotIn('extra_prefs', options)
        self.assertNotIn('dom.serviceWorkers.enabled', prefs)
        self.assertFalse(prefs['media.peerconnection.enabled'])
        self.assertEqual(prefs['network.trr.mode'], 5)
        self.assertEqual(prefs['network.proxy.type'], 1)
        self.assertEqual(prefs['network.proxy.ssl'], '127.0.0.1')
        self.assertEqual(prefs['network.proxy.ssl_port'], 9)
        self.assertEqual(prefs['network.proxy.no_proxies_on'], '')


class ChallengeTests(unittest.IsolatedAsyncioTestCase):
    async def test_challenge_never_success(self):
        page = type('Page', (), {'title': AsyncMock(return_value='Just a moment…'), 'frames': []})()
        self.assertTrue(await challenge_present(page))
        with self.assertRaisesRegex(RuntimeError, 'source_challenge_timeout'):
            await clear_challenge(page, 0)

    async def test_context_close_removes_memory(self):
        engine = Engine()
        context = type('Context', (), {'close': AsyncMock()})()
        engine.contexts['a'] = context
        await engine.close_context('a')
        self.assertEqual(engine.contexts, {})
        context.close.assert_awaited_once()

    async def test_last_context_closes_browser_manager_but_active_context_keeps_it(self):
        engine = Engine()
        engine.manager = type('Manager', (), {'__aexit__': AsyncMock()})()
        manager = engine.manager
        engine.browser = object()
        contexts = [type('Context', (), {'close': AsyncMock()})() for _ in range(2)]
        engine.contexts = dict(zip(['a', 'b'], contexts))
        await engine.close_context('a')
        manager.__aexit__.assert_not_awaited()
        self.assertIsNotNone(engine.browser)
        await engine.close_context('b')
        manager.__aexit__.assert_awaited_once_with(None, None, None)
        self.assertIsNone(engine.browser)
        self.assertIsNone(engine.manager)


if __name__ == '__main__':
    unittest.main()
