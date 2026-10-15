FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt gunicorn

COPY . .

# Encrypted files live in a volume mounted here; the directory is created with
# the right owner so a fresh named volume inherits it.
RUN useradd --system --create-home --uid 1000 vault \
    && mkdir -p /data/storage \
    && chown -R vault:vault /data/storage
USER vault

ENV HOST=0.0.0.0 \
    PORT=8080 \
    STORAGE_DIR=/data/storage

EXPOSE 8080

# One worker so the schema migration in create_app() runs once; threads handle
# concurrent requests. The long timeout covers encrypting a 200 MB video three times.
CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "1", "--threads", "8", "--timeout", "300", "app:create_app()"]
