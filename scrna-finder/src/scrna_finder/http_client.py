from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from . import __version__


USER_AGENT = f"scrna-finder/{__version__} (+https://github.com)"


class HttpClientError(RuntimeError):
    """Raised when an HTTP request fails."""


@dataclass
class HttpResponse:
    status_code: int
    body: bytes

    @property
    def text(self) -> str:
        return self.body.decode("utf-8", errors="replace")

    def json(self) -> Any:
        return json.loads(self.text)


def _build_url(url: str, params: dict[str, Any] | None = None) -> str:
    if not params:
        return url
    query = urlencode({k: v for k, v in params.items() if v is not None}, doseq=True)
    if not query:
        return url
    sep = "&" if "?" in url else "?"
    return f"{url}{sep}{query}"


def http_get(url: str, params: dict[str, Any] | None = None, timeout: int = 60, accept_json: bool = False) -> HttpResponse:
    final_url = _build_url(url=url, params=params)
    headers = {"User-Agent": USER_AGENT}
    if accept_json:
        headers["Accept"] = "application/json"
    request = Request(final_url, headers=headers, method="GET")
    try:
        with urlopen(request, timeout=timeout) as response:
            status_code = int(getattr(response, "status", 200))
            body = response.read()
            return HttpResponse(status_code=status_code, body=body)
    except HTTPError as e:
        body = e.read().decode("utf-8", errors="replace") if hasattr(e, "read") else ""
        raise HttpClientError(f"HTTP {e.code} for {final_url}: {body[:200]}") from e
    except URLError as e:
        raise HttpClientError(f"Network error for {final_url}: {e}") from e
    except TimeoutError as e:
        raise HttpClientError(f"Timeout for {final_url}") from e


def http_get_json(url: str, params: dict[str, Any] | None = None, timeout: int = 60) -> Any:
    response = http_get(url=url, params=params, timeout=timeout, accept_json=True)
    try:
        return response.json()
    except json.JSONDecodeError as e:
        raise HttpClientError(f"Invalid JSON response from {url}: {e}") from e


def http_get_text(url: str, params: dict[str, Any] | None = None, timeout: int = 60) -> str:
    response = http_get(url=url, params=params, timeout=timeout, accept_json=False)
    return response.text


def stream_download_to_file(url: str, output: Path, timeout: int = 120, chunk_size: int = 1024 * 1024) -> None:
    request = Request(url, headers={"User-Agent": USER_AGENT}, method="GET")
    try:
        with urlopen(request, timeout=timeout) as response, output.open("wb") as f:
            while True:
                chunk = response.read(chunk_size)
                if not chunk:
                    break
                f.write(chunk)
    except HTTPError as e:
        raise HttpClientError(f"HTTP {e.code} while downloading {url}") from e
    except URLError as e:
        raise HttpClientError(f"Network error while downloading {url}: {e}") from e
    except TimeoutError as e:
        raise HttpClientError(f"Timeout while downloading {url}") from e
