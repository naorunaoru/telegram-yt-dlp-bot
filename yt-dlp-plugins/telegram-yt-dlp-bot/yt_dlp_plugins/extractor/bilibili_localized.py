"""Bilibili video URLs that the built-in extractor cannot handle.

Bilibili serves region-localized video paths such as
``https://www.bilibili.com/ru/video/BV1...``. The built-in ``BiliBiliIE`` only
matches ``bilibili.com/video/...``, so a localized URL falls through to the
generic extractor, which resolves the page's ``player.bilibili.com`` iframe into
a bogus ``player`` format and fails.

Bilibili also answers the canonical ``/video/<id>`` path with a JavaScript
redirect shell carrying no ``__INITIAL_STATE__`` payload for many non-CN
clients, while any valid locale-prefixed path is server-rendered with playback
data. Canonical URLs -- including ones resolved from ``b23.tv`` short links --
are therefore retried through a locale path when that shell is detected.

Delete this plugin once upstream yt-dlp accepts localized video paths.
"""

from yt_dlp.extractor.bilibili import BiliBiliIE
from yt_dlp.utils import ExtractorError

_FALLBACK_LOCALE = 'en'
_SHELL_ERROR = 'Unable to extract initial state'


class BiliBiliLocalizedIE(BiliBiliIE):
    IE_NAME = 'BiliBili:localized'
    _VALID_URL = r'https?://(?:www\.)?bilibili\.com/(?:(?P<locale>[a-z]{2}(?:[_-][A-Za-z0-9]+)?)/)?video/(?P<prefix>[aAbB][vV])(?P<id>[^/?#&]+)'
    _TESTS = []

    def _real_extract(self, url):
        try:
            return super()._real_extract(url)
        except ExtractorError as error:
            if _SHELL_ERROR not in str(error) or self._match_valid_url(url).group('locale'):
                raise

        self.report_warning(
            f'Got a JavaScript shell page, retrying through the "{_FALLBACK_LOCALE}" locale path')
        return super()._real_extract(url.replace(
            'bilibili.com/video/', f'bilibili.com/{_FALLBACK_LOCALE}/video/', 1))
