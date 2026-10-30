FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /srv
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app
COPY policies ./policies

RUN useradd --system --uid 10001 guard && mkdir -p /srv/data && chown guard /srv/data
USER guard

EXPOSE 8000
# 요청 본문을 남기지 않도록 액세스 로그 끔(경로·상태 코드만 필요하면 별도 미들웨어로 추가).
CMD ["uvicorn", "app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
