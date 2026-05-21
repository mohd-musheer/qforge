FROM ubuntu:22.04

WORKDIR /app

RUN apt-get update && apt-get install -y \
    git \
    build-essential \
    cmake \
    curl \
    python3 \
    python3-pip

RUN git clone https://github.com/ggerganov/llama.cpp

RUN cmake -B llama.cpp/build llama.cpp

RUN cmake --build llama.cpp/build --config Release -j4

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD bash -c "\
./llama.cpp/build/bin/llama-server \
-m models/qforge-q5.gguf \
--host 0.0.0.0 \
--port 8080 & \
uvicorn app.app:app --host 0.0.0.0 --port 8000"