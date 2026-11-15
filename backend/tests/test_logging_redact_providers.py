from app.logging_redact import REDACTED, scrub


def test_groq_and_nvidia_shaped_keys_are_scrubbed() -> None:
    groq = "gsk_" + "A1b2C3d4E5f6G7h8I9j0K1l2"  # fake-secret-ok
    nvidia = "nvapi-" + "A1b2C3d4E5f6G7h8I9j0_K1l2-m3"  # fake-secret-ok
    text = f"401 for {groq} and {nvidia}"
    assert scrub(text) == f"401 for {REDACTED} and {REDACTED}"
