import asyncio
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from engine import Engine, allow_request, challenge_present, clear_challenge, launch_options


class PolicyTests(unittest.TestCase):
    def test_media_denied_iframe_allowed(self):
        for url, kind in [('https://x/video', 'media'), ('https://x/a.M3U8?token=x', 'fetch'), ('http://x/', 'document'), ('https://user:p@x/', 'document')]:
            self.assertFalse(allow_request(url, kind))
        self.assertTrue(allow_request('https://x/player', 'document'))

    def test_launch_contract_has_no_unsupported_args_or_network_geo(self):
        options = launch_options('/existing/firefox')
        self.assertNotIn('proxy', options)
        self.assertEqual(options['locale'], 'ko-KR')
        self.assertNotIn('dom.serviceWorkers.enabled', options['extra_prefs'])
        self.assertFalse(options['extra_prefs']['media.peerconnection.enabled'])


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


if __name__ == '__main__':
    unittest.main()
