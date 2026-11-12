# FreelanceTN AI gateway

Private FastAPI service that keeps the existing Next.js prompt and JSON contracts while forwarding requests to Cloudflare Workers AI. It has no MongoDB connection and does not implement project, proposal, matching, feedback, or task rules.

## Run locally

1. Copy `.env.example` to `.env` and fill in the Cloudflare account ID, Workers AI API token, and a random `AI_SERVICE_TOKEN` of at least 32 characters. Keep `.env` out of source control.
2. Create and activate a virtual environment, then install `requirements.txt`.
3. Start the private service from this directory:

   ```powershell
   uvicorn app.main:app --host 127.0.0.1 --port 8100
   ```

4. Configure the Next.js server environment with the same `AI_SERVICE_TOKEN` and `AI_SERVICE_URL=http://127.0.0.1:8100`. Set optional `AI_TIMEOUT_MS=60000` and `AI_MAX_TOKENS=2500`, then restart Next.js.

For separate hosts or containers, use a private network and HTTPS for `AI_SERVICE_URL`; never expose the service token to browser code. Do not expose the FastAPI port publicly. The service has no CORS configuration and requires bearer authentication for both inference and health checks.

## Cloudflare Workers AI

Create a Cloudflare API token with Workers AI Read and Edit permissions and set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` only in this service's environment. `WORKERS_AI_MODEL` defaults to `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. The service does not store prompts, connect to MongoDB, retry inference, or synthesize answers when Workers AI fails.

The Workers AI Free allocation currently includes 10,000 Neurons per day; requests fail when the account's daily allocation or model capacity is exhausted. The selected model is not among the models listed as requiring a paid plan, but Cloudflare account limits and model availability still apply.

## Tests

From this directory run `python -m unittest discover -s tests`. These tests mock Cloudflare's HTTP response; they do not consume Workers AI quota.
