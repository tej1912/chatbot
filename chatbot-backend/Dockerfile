FROM python:3.12-slim
 
WORKDIR /app
 
# gcc/g++ are needed to build 'annoy' (a NeMo Guardrails dependency), ca-certificates for model download
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ libpq-dev ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
 
COPY requirements.txt .
 
ENV PIP_TRUSTED_HOST="pypi.org files.pythonhosted.org pypi.python.org"
ENV PYTHONHTTPSVERIFY=0
 
RUN pip install --trusted-host pypi.org --trusted-host files.pythonhosted.org --trusted-host pypi.python.org --no-cache-dir -r requirements.txt
 
# Bake the embedding model into the image: no download on first request, no
# volume needed, and it works on hosts with ephemeral disks (Railway/Render).
ENV EMBEDDING_CACHE_DIR=/models
RUN useradd --create-home --uid 10001 app && \
    mkdir -p /models && \
    chown -R app:app /models /app
 
# Download embedding model
USER app
RUN python -c "import ssl; ssl._create_default_https_context = ssl._create_unverified_context; from fastembed import TextEmbedding; TextEmbedding('BAAI/bge-small-en-v1.5', cache_dir='/models')" || true
 
USER root
COPY --chown=app:app . .
USER app
 
EXPOSE 8000
 
# Production command: no --reload, several workers, honours $PORT (Railway/
# Render set it), trusts the platform proxy's X-Forwarded-For so per-IP rate
# limits see real client IPs. Each worker loads the ~300MB embedding model:
# on a 512MB host set WEB_CONCURRENCY=1.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers ${WEB_CONCURRENCY:-2} --proxy-headers --forwarded-allow-ips '*'"]
 