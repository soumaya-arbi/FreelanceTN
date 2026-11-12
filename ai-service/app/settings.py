from dataclasses import dataclass
import os
from pathlib import Path

from dotenv import load_dotenv


load_dotenv(dotenv_path=Path(__file__).resolve().parents[1] / ".env", override=False)


DEFAULT_WORKERS_AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast"


@dataclass(frozen=True)
class Settings:
    cloudflare_account_id: str
    cloudflare_api_token: str
    internal_token: str
    model: str
    timeout_seconds: float

    @property
    def provider_configured(self) -> bool:
        return bool(self.cloudflare_account_id and self.cloudflare_api_token)

    @property
    def service_configured(self) -> bool:
        return len(self.internal_token) >= 32


def get_settings() -> Settings:
    try:
        timeout_seconds = float(os.getenv("WORKERS_AI_TIMEOUT_SECONDS", "50"))
    except ValueError:
        timeout_seconds = 50

    return Settings(
        cloudflare_account_id=os.getenv("CLOUDFLARE_ACCOUNT_ID", "").strip(),
        cloudflare_api_token=os.getenv("CLOUDFLARE_API_TOKEN", "").strip(),
        internal_token=os.getenv("AI_SERVICE_TOKEN", "").strip(),
        model=os.getenv("WORKERS_AI_MODEL", DEFAULT_WORKERS_AI_MODEL).strip()
        or DEFAULT_WORKERS_AI_MODEL,
        timeout_seconds=max(5, min(timeout_seconds, 120)),
    )
