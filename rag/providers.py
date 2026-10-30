"""Existing OpenAI by default; Azure OpenAI and Key Vault are explicit configuration."""

import os
from functools import lru_cache


@lru_cache(maxsize=1)
def credential():
    from azure.identity import DefaultAzureCredential

    return DefaultAzureCredential(
        managed_identity_client_id=os.getenv("AZURE_CLIENT_ID") or None
    )


@lru_cache(maxsize=32)
def secret(name):
    vault = os.getenv("DOMORA_KEY_VAULT_URL")
    reference = os.getenv(name + "_SECRET_NAME")
    if vault and reference:
        from azure.keyvault.secrets import SecretClient

        return (
            SecretClient(vault_url=vault, credential=credential())
            .get_secret(reference)
            .value
        )
    if os.getenv("DOMORA_ENVIRONMENT", "development") == "production" and name in (
        "OPENAI_API_KEY",
        "DOMORA_RAG_INTERNAL_KEY",
        "DOMORA_QUERY_DATABASE_URL",
        "DOMORA_INGESTION_DATABASE_URL",
        "DOMORA_LEGACY_DATABASE_URL",
    ):
        raise RuntimeError(f"{name}: Key Vault reference required in production")
    return os.getenv(name)


class OpenAIProvider:
    def client(self):
        from openai import OpenAI

        key = secret("OPENAI_API_KEY")
        if not key:
            raise RuntimeError("OPENAI_API_KEY not configured")
        return OpenAI(api_key=key, timeout=45, max_retries=2)


class AzureOpenAIProvider:
    def client(self):
        from openai import AzureOpenAI
        from azure.identity import get_bearer_token_provider

        endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
        version = os.getenv("AZURE_OPENAI_API_VERSION")
        if not endpoint or not version:
            raise RuntimeError("Azure OpenAI endpoint/api version not configured")
        return AzureOpenAI(
            azure_endpoint=endpoint,
            api_version=version,
            azure_ad_token_provider=get_bearer_token_provider(
                credential(), "https://cognitiveservices.azure.com/.default"
            ),
            timeout=45,
            max_retries=2,
        )


def get_provider():
    provider = os.getenv("DOMORA_LLM_PROVIDER", "openai")
    if provider == "openai":
        return OpenAIProvider()
    if provider == "azure_openai":
        return AzureOpenAIProvider()
    raise RuntimeError("Unknown LLM provider")
