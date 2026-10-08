FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

ARG EXTRAS=""
ENV UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project ${EXTRAS}
COPY . .
RUN uv sync --frozen ${EXTRAS}

EXPOSE 8000
CMD ["uvicorn", "topo.main:app", "--host", "0.0.0.0", "--port", "8000"]
