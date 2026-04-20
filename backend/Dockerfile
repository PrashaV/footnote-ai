# Replace the entire Dockerfile with this simpler version
cat > /Users/prashavelmurugan/Documents/Claude/Projects/Footnote:\ AI\ powered\ Research\ Intelligence/backend/Dockerfile << 'EOF'
FROM python:3.10-slim

WORKDIR /app

# Copy requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy app code
COPY . .

# Run the app
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
EOF
