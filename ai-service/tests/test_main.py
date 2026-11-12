import os
import unittest
from unittest.mock import patch

import httpx
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.settings import DEFAULT_WORKERS_AI_MODEL


INTERNAL_TOKEN = "unit-test-internal-token-with-over-32-characters"


class StubResponse:
    def __init__(self, status_code: int = 200, payload: object | None = None):
        self.status_code = status_code
        self.payload = payload if payload is not None else {
            "success": True,
            "result": {"response": '{"title":"Verified"}'},
        }
        self.is_success = 200 <= status_code < 300

    def json(self) -> object:
        return self.payload


class StubAsyncClient:
    calls: list[dict[str, object]] = []
    response = StubResponse()
    error: Exception | None = None

    def __init__(self, **_: object):
        pass

    async def __aenter__(self) -> "StubAsyncClient":
        return self

    async def __aexit__(self, *_: object) -> None:
        return None

    async def post(self, url: str, *, headers: dict[str, str], json: dict[str, object]) -> StubResponse:
        self.calls.append({"url": url, "headers": headers, "json": json})
        if self.error:
            raise self.error
        return self.response


class AiServiceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        StubAsyncClient.calls = []
        StubAsyncClient.response = StubResponse()
        StubAsyncClient.error = None
        self.environment = patch.dict(os.environ, {
            "AI_SERVICE_TOKEN": INTERNAL_TOKEN,
            "CLOUDFLARE_ACCOUNT_ID": "account-test",
            "CLOUDFLARE_API_TOKEN": "cloudflare-server-only-token",
            "WORKERS_AI_MODEL": DEFAULT_WORKERS_AI_MODEL,
            "WORKERS_AI_TIMEOUT_SECONDS": "10",
        })
        self.environment.start()
        self.http = patch("app.main.httpx.AsyncClient", StubAsyncClient)
        self.http.start()
        self.client = AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver")

    async def asyncTearDown(self) -> None:
        await self.client.aclose()
        self.http.stop()
        self.environment.stop()

    def headers(self, token: str = INTERNAL_TOKEN) -> dict[str, str]:
        return {"Authorization": f"Bearer {token}"}

    async def test_internal_auth_is_required(self) -> None:
        response = await self.client.get("/health")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(StubAsyncClient.calls, [])

    async def test_health_reports_provider_configuration_without_secrets(self) -> None:
        response = await self.client.get("/health", headers=self.headers())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {
            "configured": True,
            "provider": "cloudflare-workers-ai",
            "model": DEFAULT_WORKERS_AI_MODEL,
        })
        self.assertNotIn("token", str(response.json()).lower())

    async def test_forwards_existing_chat_contract_and_returns_text_without_fallback(self) -> None:
        messages = [
            {"role": "system", "content": "Return JSON."},
            {"role": "user", "content": '{"idea":"A real brief"}'},
        ]
        response = await self.client.post(
            "/v1/generate-json",
            headers=self.headers(),
            json={"messages": messages, "temperature": 0.4, "max_tokens": 2500},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"content": '{"title":"Verified"}', "model": DEFAULT_WORKERS_AI_MODEL})
        sent = StubAsyncClient.calls[0]
        self.assertEqual(sent["url"], f"https://api.cloudflare.com/client/v4/accounts/account-test/ai/run/{DEFAULT_WORKERS_AI_MODEL}")
        self.assertEqual(sent["headers"], {"Authorization": "Bearer cloudflare-server-only-token"})
        self.assertEqual(sent["json"]["messages"], messages)
        self.assertEqual(sent["json"]["response_format"], {"type": "json_object"})
        self.assertNotIn(INTERNAL_TOKEN, str(sent["json"]))

    async def test_uses_openai_compatible_choices_when_response_is_absent(self) -> None:
        StubAsyncClient.response = StubResponse(200, {
            "success": True,
            "result": {"choices": [{"message": {"content": '{"title":"From choices"}'}}]},
        })
        response = await self.client.post(
            "/v1/generate-json",
            headers=self.headers(),
            json={"messages": [{"role": "user", "content": "brief"}]},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["content"], '{"title":"From choices"}')

    async def test_falls_back_to_choices_when_response_is_empty_and_uses_returned_model(self) -> None:
        StubAsyncClient.response = StubResponse(200, {
            "success": True,
            "result": {
                "response": "  ",
                "choices": [{"message": {"content": '{"title":"Fallback"}'}}],
                "model": "@cf/model-returned-by-cloudflare",
            },
        })
        response = await self.client.post(
            "/v1/generate-json",
            headers=self.headers(),
            json={"messages": [{"role": "user", "content": "brief"}]},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {
            "content": '{"title":"Fallback"}',
            "model": "@cf/model-returned-by-cloudflare",
        })

    async def test_strips_json_markdown_fence_only_for_valid_inner_json(self) -> None:
        content = '```json\n{"title":"Verified"}\n```'
        StubAsyncClient.response = StubResponse(200, {
            "success": True,
            "result": {"response": content},
        })
        response = await self.client.post(
            "/v1/generate-json",
            headers=self.headers(),
            json={"messages": [{"role": "user", "content": "brief"}]},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["content"], '{"title":"Verified"}')

    async def test_preserves_already_valid_json_content(self) -> None:
        content = ' { "title" : "Verified" } '
        StubAsyncClient.response = StubResponse(200, {
            "success": True,
            "result": {"response": content},
        })
        response = await self.client.post(
            "/v1/generate-json",
            headers=self.headers(),
            json={"messages": [{"role": "user", "content": "brief"}]},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["content"], content)

    async def test_empty_primary_and_choices_content_is_invalid(self) -> None:
        StubAsyncClient.response = StubResponse(200, {
            "success": True,
            "result": {
                "response": " ",
                "choices": [{"message": {"content": "  "}}],
            },
        })
        response = await self.client.post(
            "/v1/generate-json",
            headers=self.headers(),
            json={"messages": [{"role": "user", "content": "brief"}]},
        )
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["detail"]["code"], "invalid_provider_response")

    async def test_daily_quota_is_reported_without_exposing_provider_details(self) -> None:
        StubAsyncClient.response = StubResponse(429, {"errors": [{"code": 3036, "message": "provider private detail"}]})
        response = await self.client.post("/v1/generate-json", headers=self.headers(), json={"messages": [{"role": "user", "content": "brief"}]})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["detail"]["code"], "quota_exhausted")
        self.assertNotIn("provider private detail", response.text)

    async def test_cloudflare_error_in_success_http_response_is_not_used_as_a_result(self) -> None:
        StubAsyncClient.response = StubResponse(200, {"success": False, "errors": [{"code": 3036}]})
        response = await self.client.post("/v1/generate-json", headers=self.headers(), json={"messages": [{"role": "user", "content": "brief"}]})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["detail"]["code"], "quota_exhausted")

    async def test_empty_provider_output_is_invalid_not_a_synthetic_answer(self) -> None:
        StubAsyncClient.response = StubResponse(200, {"success": True, "result": {"response": "  "}})
        response = await self.client.post("/v1/generate-json", headers=self.headers(), json={"messages": [{"role": "user", "content": "brief"}]})
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["detail"]["code"], "invalid_provider_response")

    async def test_missing_cloudflare_credentials_fail_closed(self) -> None:
        with patch.dict(os.environ, {"CLOUDFLARE_API_TOKEN": ""}):
            response = await self.client.post("/v1/generate-json", headers=self.headers(), json={"messages": [{"role": "user", "content": "brief"}]})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["detail"]["code"], "provider_not_configured")
        self.assertEqual(StubAsyncClient.calls, [])

    async def test_provider_timeout_maps_to_a_retryable_error(self) -> None:
        StubAsyncClient.error = httpx.TimeoutException("private timeout details")
        response = await self.client.post("/v1/generate-json", headers=self.headers(), json={"messages": [{"role": "user", "content": "brief"}]})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["detail"]["code"], "provider_timeout")
        self.assertNotIn("private timeout details", response.text)

    async def test_invalid_request_shape_is_rejected(self) -> None:
        response = await self.client.post("/v1/generate-json", headers=self.headers(), json={"messages": [], "extra": "not allowed"})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(StubAsyncClient.calls, [])


if __name__ == "__main__":
    unittest.main()
