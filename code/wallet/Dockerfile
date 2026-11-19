# One image, two programs: run api.py or worker.py.
FROM python:3.12-slim
RUN pip install --no-cache-dir "psycopg[binary]==3.2.3"
RUN useradd --uid 10001 --no-create-home wallet
WORKDIR /app
COPY app/ /app/
USER 10001
EXPOSE 8080
CMD ["python3", "api.py"]
