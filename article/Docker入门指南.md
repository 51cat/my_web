# Docker 入门指南

Docker 是一个开源的应用容器引擎，让开发者可以打包他们的应用以及依赖包到一个可移植的镜像中，然后发布到任何流行的 Linux 或 Windows 机器上，也可以实现虚拟化。

## 核心概念

1. **镜像 (Image)**：Docker 镜像就是一个只读的模板。例如：一个镜像可以包含一个完整的 Ubuntu 操作系统环境，里面仅安装了 Apache 或用户需要的其它应用程序。
2. **容器 (Container)**：Docker 利用容器来运行应用。容器是从镜像创建的运行实例。
3. **仓库 (Repository)**：集中存放镜像文件的场所。

## 常用命令

```bash
# 拉取镜像
docker pull biocontainers/fastqc:v0.11.9_cv8

# 运行镜像
docker run -it ubuntu /bin/bash

# 查看正在运行的容器
docker ps

# 查看所有容器
docker ps -a
```

> 提示：在我们的生物信息工具箱中，所有底层工具都是通过 `docker run` 以容器化方式调用的，完全避免了依赖冲突的烦恼！
