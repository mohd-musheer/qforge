FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

WORKDIR /app

RUN apt-get update && apt-get install -y \
    git \
    build-essential \
    cmake \
    curl \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

RUN ln -sf /usr/bin/python3 /usr/bin/python
RUN ln -sf /usr/bin/pip3 /usr/bin/pip

# Build llama.cpp

RUN git clone https://github.com/ggerganov/llama.cpp

RUN cmake -S llama.cpp -B llama.cpp/build \
    -DCMAKE_BUILD_TYPE=Release

RUN cmake --build llama.cpp/build -j4

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["bash","-c","\
./llama.cpp/build/bin/llama-server \
-m models/qforge-q5.gguf \
--host 0.0.0.0 \
--port 8080 & \
uvicorn app.app:app --host 0.0.0.0 --port 8000"]