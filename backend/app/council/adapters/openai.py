"""GPT via the official OpenAI SDK (Chat Completions)."""

import openai

from app.council.adapters.base import Completion, ProviderError


class OpenAIAdapter:
    name = "openai"

    def __init__(self, api_key: str, model: str, base_url: str | None = None) -> None:
        self.model = model
        # Same policy as the Anthropic adapter: one SDK retry (exponential backoff, honours
        # Retry-After), 110 s per attempt; the pipeline adds the 120 s overall deadline.
        self._client = openai.AsyncOpenAI(
            api_key=api_key, base_url=base_url, max_retries=1, timeout=110.0
        )

    async def complete(self, system: str, user: str, max_tokens: int) -> Completion:
        try:
            response = await self._client.chat.completions.create(
                model=self.model,
                # Reasoning tokens are billed as output and count against the limit.
                max_completion_tokens=max_tokens,
                reasoning_effort="low",
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
            )
        # `from None`: SDK errors carry request details, which include the API key header.
        except openai.APIStatusError as exc:
            raise ProviderError(self.name, exc.status_code) from None
        except openai.APIConnectionError:  # includes timeouts
            raise ProviderError(self.name, None) from None
        choice = response.choices[0] if response.choices else None
        if choice is None or choice.message.refusal or choice.finish_reason == "content_filter":
            raise ProviderError(self.name, None, "refused")
        usage = response.usage
        if usage is None:
            raise ProviderError(self.name, None, "no usage reported")  # cannot account the cost
        return Completion(
            choice.message.content or "",
            usage.prompt_tokens,
            usage.completion_tokens,
            response.model,
        )
