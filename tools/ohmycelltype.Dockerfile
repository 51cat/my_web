# ── 第一阶段：构建依赖 ──────────────────────────────────────────────────────────
FROM python:3.11-slim AS builder

WORKDIR /app

# 安装系统依赖（根据你的工具按需增减）
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ libhdf5-dev && \
    rm -rf /var/lib/apt/lists/*

# 先只复制依赖文件，利用 Docker 层缓存
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ── 第二阶段：最终镜像 ──────────────────────────────────────────────────────────
FROM python:3.11-slim

WORKDIR /app

# 拷贝已安装的包
COPY --from=builder /install /usr/local

# 拷贝你的工具源码
COPY . .

# 安装你的工具本身（假设使用 setup.py 或 pyproject.toml）
RUN pip install --no-cache-dir .

# 验证安装
RUN ohmycelltype --version

# 容器默认入口
ENTRYPOINT ["ohmycelltype"]
