"""Claude via the official Anthropic SDK."""

import anthropic

from app.council.adapters.base import Completion, ProviderError


class AnthropicAdapter:
    name = "anthropic"

    def __init__(self, api_key: str, model: str, base_url: str | None = None) -> None:
        self.model = model
        # One retry only: the pipeline has its own 120 s per-call timeout and failure handling.
        self._client = anthropic.AsyncAnthropic(
            api_key=api_key, base_url=base_url, max_retries=1, timeout=110.0
        )

    async def complete(self, system: str, user: str, max_tokens: int) -> Completion:
        try:
            message = await self._client.messages.create(
                model=self.model,
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": "user", "content": user}],
                # Thinking tokens are billed as output and count against max_tokens;
                # low effort keeps most of the allowance for the answer.
                output_config={"effort": "low"},
            )
        # `from None` everywhere: SDK errors carry the request, which includes the API key header.
        except anthropic.APIStatusError as exc:
            raise ProviderError(self.name, exc.status_code) from None
        except anthropic.APIConnectionError:  # includes timeouts
            raise ProviderError(self.name, None) from None
        if message.stop_reason == "refusal":
            raise ProviderError(self.name, None, "refused")
        text = "".join(block.text for block in message.content if block.type == "text")
        usage = message.usage
        input_tokens = (
            usage.input_tokens
            + (usage.cache_creation_input_tokens or 0)
            + (usage.cache_read_input_tokens or 0)
        )
        return Completion(text, input_tokens, usage.output_tokens, message.model)
