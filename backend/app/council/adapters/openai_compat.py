"""Any OpenAI-compatible Chat Completions endpoint (Groq, NVIDIA NIM, Ollama, vLLM, ...).

Same policy as the OpenAI adapter: one SDK retry with backoff, 110 s per attempt, errors reduced
to the HTTP status (no provider body, no chained exception), a refusal or a reply without usage
is a failure. The HTTP client is the SSRF-guarded one from `netguard`.
"""

import openai

from app.council import netguard
from app.council.adapters.base import Completion, ProviderError
from app.council.prices import Price
from app.council.seats import SeatConfig

NO_KEY = "not-needed"  # the SDK insists on a non-empty key; keyless servers ignore it


class OpenAICompatAdapter:
    def __init__(
        self,
        seat: SeatConfig,
        *,
        allow_local: bool,
        preset_hosts: frozenset[str] = frozenset(),
        resolver: netguard.Resolver = netguard.system_resolver,
    ) -> None:
        self.name = seat.seat_id
        self.model = seat.model
        self.price = Price(seat.price_in, seat.price_out)
        self.token_cap = seat.token_cap
        self._client = openai.AsyncOpenAI(
            api_key=seat.api_key or NO_KEY,
            base_url=seat.base_url,
            max_retries=1,
            timeout=110.0,
            http_client=netguard.guarded_client(
                allow_local=allow_local, preset_hosts=preset_hosts, resolver=resolver
            ),
        )

    async def complete(self, system: str, user: str, max_tokens: int) -> Completion:
        try:
            response = await self._client.chat.completions.create(
                model=self.model,
                max_tokens=max_tokens,  # the portable spelling; compat servers reject newer ones
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
            )
        # `from None`: SDK errors carry request details, which include the Authorization header.
        except openai.APIStatusError as exc:
            raise ProviderError(self.name, exc.status_code) from None
        except openai.OpenAIError:  # connection, timeout, SSRF refusal, malformed reply
            raise ProviderError(self.name, None) from None
        choice = response.choices[0] if response.choices else None
        if (
            choice is None
            or getattr(choice.message, "refusal", None)
            or choice.finish_reason == "content_filter"
        ):
            raise ProviderError(self.name, None, "refused")
        usage = response.usage
        if usage is None or usage.prompt_tokens is None or usage.completion_tokens is None:
            raise ProviderError(self.name, None, "no usage reported")  # cannot account the cost
        return Completion(
            choice.message.content or "",
            usage.prompt_tokens,
            usage.completion_tokens,
            response.model or self.model,
        )
