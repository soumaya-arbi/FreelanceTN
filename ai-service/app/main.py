from __future__ import annotations

import hmac
import json
import re
from typing import Annotated, Literal

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.settings import Settings, get_settings


class ChatMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Literal["system", "user", "assistant"]
    content: str = Field(min_length=1, max_length=100_000)


class GenerateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    messages: list[ChatMessage] = Field(min_length=1, max_length=12)
    temperature: float = Field(default=0.4, ge=0, le=1)
    max_tokens: int = Field(default=2500, ge=200, le=8000)

    @model_validator(mode="after")
    def bound_total_prompt(self) -> "GenerateRequest":
        if sum(len(message.content) for message in self.messages) > 120_000:
            raise ValueError("The combined prompt is too large.")
        return self


class GenerateResponse(BaseModel):
    content: str
    model: str


class HealthResponse(BaseModel):
    configured: bool
    provider: Literal["cloudflare-workers-ai"] = "cloudflare-workers-ai"
    model: str


app = FastAPI(title="FreelanceTN AI service", docs_url=None, redoc_url=None, openapi_url=None)


def _response_content(result: object) -> str | None:
    if not isinstance(result, dict):
        return None

    content = result.get("response")
    if not isinstance(content, str) or not content.strip():
        choices = result.get("choices")
        first_choice = choices[0] if isinstance(choices, list) and choices else None
        message = first_choice.get("message") if isinstance(first_choice, dict) else None
        content = message.get("content") if isinstance(message, dict) else None

    if not isinstance(content, str) or not content.strip():
        return None

    fenced = re.fullmatch(r"\s*```json\s*\n?(.*?)\n?```\s*", content, flags=re.IGNORECASE | re.DOTALL)
    if fenced:
        inner = fenced.group(1).strip()
        try:
            json.loads(inner)
        except (TypeError, ValueError):
            pass
        else:
            return inner

    return content


def service_settings() -> Settings:
    return get_settings()


def require_internal_token(
    authorization: Annotated[str | None, Header()] = None,
    settings: Settings = Depends(service_settings),
) -> Settings:
    if not settings.service_configured:
        raise HTTPException(
            status_code=503,
            detail={"code": "service_not_configured", "message": "The AI service is not configured."},
        )

    scheme, _, supplied = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not hmac.compare_digest(supplied, settings.internal_token):
        raise HTTPException(status_code=401, detail={"code": "unauthorized", "message": "Unauthorized."})
    return settings


@app.get("/health", response_model=HealthResponse)
async def health(settings: Settings = Depends(require_internal_token)) -> HealthResponse:
    return HealthResponse(configured=settings.provider_configured, model=settings.model)


@app.post("/v1/generate-json", response_model=GenerateResponse)
async def generate_json(
    request: GenerateRequest,
    settings: Settings = Depends(require_internal_token),
) -> GenerateResponse:
    if not settings.provider_configured:
        raise HTTPException(
            status_code=503,
            detail={"code": "provider_not_configured", "message": "Workers AI is not configured on the server."},
        )

    endpoint = (
        "https://api.cloudflare.com/client/v4/accounts/"
        f"{settings.cloudflare_account_id}/ai/run/{settings.model}"
    )
    body = {
        "messages": [message.model_dump() for message in request.messages],
        "temperature": request.temperature,
        "max_tokens": request.max_tokens,
        "response_format": {"type": "json_object"},
    }

    try:
        async with httpx.AsyncClient(timeout=settings.timeout_seconds) as client:
            response = await client.post(
                endpoint,
                headers={"Authorization": f"Bearer {settings.cloudflare_api_token}"},
                json=body,
            )
    except httpx.TimeoutException as error:
        raise HTTPException(
            status_code=503,
            detail={"code": "provider_timeout", "message": "Workers AI timed out. Please retry."},
        ) from error
    except httpx.HTTPError as error:
        raise HTTPException(
            status_code=503,
            detail={"code": "provider_unavailable", "message": "Workers AI is temporarily unavailable."},
        ) from error

    if response.status_code == 429:
        raise HTTPException(
            status_code=503,
            detail={"code": "quota_exhausted", "message": "The Workers AI quota or capacity limit was reached."},
        )
    if response.status_code in (401, 403):
        raise HTTPException(
            status_code=503,
            detail={"code": "provider_configuration", "message": "Workers AI rejected the server credentials or model."},
        )
    if response.status_code in (408, 504):
        raise HTTPException(
            status_code=503,
            detail={"code": "provider_timeout", "message": "Workers AI timed out. Please retry."},
        )
    if not response.is_success:
        raise HTTPException(
            status_code=503 if response.status_code >= 500 else 502,
            detail={"code": "provider_error", "message": "Workers AI could not complete this request."},
        )

    try:
        payload = response.json()
    except ValueError as error:
        raise HTTPException(
            status_code=502,
            detail={"code": "invalid_provider_response", "message": "Workers AI returned an invalid response."},
        ) from error

    if not isinstance(payload, dict) or payload.get("success") is False:
        errors = payload.get("errors", []) if isinstance(payload, dict) else []
        error_codes = {str(item.get("code", "")) for item in errors if isinstance(item, dict)}
        code = "quota_exhausted" if "3036" in error_codes else "provider_error"
        message = "The Workers AI quota was reached." if code == "quota_exhausted" else "Workers AI could not complete this request."
        raise HTTPException(status_code=503, detail={"code": code, "message": message})

    result = payload.get("result")
    content = _response_content(result)
    if not isinstance(content, str) or not content.strip():
        raise HTTPException(
            status_code=502,
            detail={"code": "invalid_provider_response", "message": "Workers AI returned an empty response."},
        )

    returned_model = result.get("model") if isinstance(result, dict) else None
    if not isinstance(returned_model, str) or not returned_model.strip():
        returned_model = payload.get("model")
    model = returned_model.strip() if isinstance(returned_model, str) and returned_model.strip() else settings.model

    return GenerateResponse(content=content, model=model)
