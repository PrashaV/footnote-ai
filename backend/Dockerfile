# Stage 1: Build
FROM python:3.10-slim as builder

WORKDIR /app

# Copy requirements.txt from current directory
COPY ./requirements.txt ./

RUN pip install --user --no-cache-dir -r requirements.txt


# Stage 2: Runtime
FROM python:3.10-slim

WORKDIR /app

# Copy Python dependencies from builder
COPY --from=builder /root/.local /root/.local

# Copy application code
COPY . .

# Set environment variables
ENV PATH=/root/.local/bin:$PATH
ENV PYTHONUNBUFFERED=1
ENV PORT=8000

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD python -c "import requests; requests.get('http://localhost:8000/health', timeout=5)"

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
