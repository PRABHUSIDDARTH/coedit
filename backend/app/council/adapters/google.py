"""Gemini via the official google-genai SDK."""

import asyncio
import logging

from google import genai
from google.genai import errors, types

from app.council.adapters.base import Completion, ProviderError

# The SDK logs "Retrying ... raised ClientError: 429 <provider error body>" at INFO; provider
# error bodies can quote request details, and AGENTS.md says provider errors are logged by
# status code only (the pipeline does that). Silence the SDK's own logger.
logging.getLogger("google_genai").setLevel(logging.CRITICAL + 1)


EXTRA_503_BACKOFF_SECONDS = 6.0


class GoogleAdapter:
    name = "google"

    def __init__(self, api_key: str, model: str, base_url: str | None = None) -> None:
        self.model = model
        # Same policy as the other adapters: one retry (2 attempts) with exponential backoff
        # on 429/5xx, 110 s per attempt (the SDK takes milliseconds).
        self._client = genai.Client(
            api_key=api_key,
            http_options=types.HttpOptions(
                base_url=base_url,
                timeout=110_000,
                retry_options=types.HttpRetryOptions(
                    attempts=2,
                    initial_delay=1.0,
                    max_delay=8.0,
                    exp_base=2.0,
                    http_status_codes=[429, 500, 502, 503, 504],
                ),
            ),
        )

    async def complete(self, system: str, user: str, max_tokens: int) -> Completion:
        """One extra attempt, after a longer pause, for 503 only (Gemini's "overloaded").
        Runs inside the pipeline's per-call deadline (CALL_TIMEOUT_SECONDS), which cancels it;
        a 503 reply carries no usage, so nothing extra is billed or counted against the cap."""
        try:
            return await self._complete_once(system, user, max_tokens)
        except ProviderError as exc:
            if exc.status != 503:
                raise
        await asyncio.sleep(EXTRA_503_BACKOFF_SECONDS)
        return await self._complete_once(system, user, max_tokens)

    async def _complete_once(self, system: str, user: str, max_tokens: int) -> Completion:
        try:
            response = await self._client.aio.models.generate_content(
                model=self.model,
                contents=user,
                config=types.GenerateContentConfig(
                    system_instruction=system,
                    # Thinking tokens are billed as output and count against this limit.
                    max_output_tokens=max_tokens,
                    thinking_config=types.ThinkingConfig(thinking_level=types.ThinkingLevel.LOW),
                ),
            )
        # `from None`: SDK errors can quote the request URL/headers, which carry the API key.
        except errors.APIError as exc:
            raise ProviderError(self.name, exc.code) from None
        except Exception:  # noqa: BLE001  # connection problems/timeouts; the SDK's transport
            # exceptions are not a stable public set, and their messages must not escape anyway
            raise ProviderError(self.name, None) from None
        feedback = response.prompt_feedback
        if (feedback and feedback.block_reason) or not response.candidates:
            raise ProviderError(self.name, None, "refused")
        usage = response.usage_metadata
        if usage is None:
            raise ProviderError(self.name, None, "no usage reported")  # cannot account the cost
        return Completion(
            response.text or "",
            usage.prompt_token_count or 0,
            (usage.candidates_token_count or 0) + (usage.thoughts_token_count or 0),
            response.model_version or self.model,
        )
