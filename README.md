# 五一的生物信息工具箱

这是一款基于 Node.js 和 Docker 的轻量级、完全容器化的生物信息学分析 Web 平台。通过简洁的配置，您可以将复杂的生信命令行工具转换为带有精美界面的 Web 应用。

---

## 1. 下一步我该如何实现本地真正运行

本项目目前因为未检测到 Docker 环境，自动以后端“演示模式”容灾运行（即如果没有检测到 Docker，也会通过 mock 逻辑跑完全部流程）。要让它真正处理您的本地数据，只需简单两步：

### 1.1 安装 Docker
本项目**完全依赖 Docker** 来执行分析工具，这样做以免除您折腾 Python、R 或 C++ 的环境依赖带来的烦恼。
- 请前往 [Docker 官网](https://www.docker.com/products/docker-desktop/) 下载并安装 Docker Desktop for Windows / Mac。
- 安装完毕后，打开命令行（CMD 或 PowerShell），输入 `docker --version`。确保其能正常输出版本号。

### 1.2 准备镜像库
项目配置文件 (`tools/*.json`) 内预设了一些镜像。在网页上首次运行某个工具时，Docker 会自动在后台拉取（下载）该镜像（这可能需要一些时间）。如果你想要更流畅的体验，也可以提前拉取：
```bash
docker pull biocontainers/fastqc:v0.11.9_cv8
docker pull quay.io/biocontainers/trim-galore:0.6.7--hdfd78af_0
```
如果您有**自己开发的工具**（例如 `ohmycelltype`），我们需要在您的电脑本地将其构建为一个镜像。在项目根目录下利用我写好的 Dockerfile 进行构建：
```bash
docker build -f tools/ohmycelltype.Dockerfile -t ohmycelltype:latest /您的真实工具代码所在目录/
```

### 1.3 启动项目
上述环境搭建好即代表"本地真正运行"准备完毕。在本项目目录命令行里一如既往地启动即可：
```bash
npm start
```
再去浏览器访问 `http://localhost:3000` 并上传文件点击 Run，后台便会使用真实的 Docker 容器来分析你的数据！

---

## 2. 我该如何将其部署到线上服务器

将这个项目放到您课题组或个人的 Linux 服务器上非常简单，只需两步：

### 2.1 安装基础环境 (以 Linux/Ubuntu 为例)
在服务器上安装 Node.js 和 Docker：
```bash
sudo apt update
sudo apt install docker.io nodejs npm
# 确保你的普通用户无密码具有 docker 运行权限
sudo usermod -aG docker $USER
```
然后注销并重新登录终端使 Docker 权限生效。将你的这个项目文件夹上传至服务器。

### 2.2 使用 PM2 守护进程运行
在线上不要使用直接的 `node server.js`（因为一旦关闭终端服务就会断掉）。推荐使用 `pm2` 来进行线上部署：
```bash
# 全局安装 pm2 工具
sudo npm install -g pm2

# 进入项目目录安装依赖
npm install

# 启动我们的工具箱 server.js
pm2 start server.js --name bio-toolbox

# 可选：设置开机自启
pm2 startup
pm2 save
```
此时，服务器上的 `3000` 端口就已经稳定开启了。如果你只有 IP，在云主机安全组放行 `3000` 端口后即可直接通过 `http://你的公网IP:3000` 访问使用了。

### 2.3 绑定域名配置 (Nginx 反向代理)
如果你申请了域名（如 `bio-tools.yourdomain.com`），建议通过 **Nginx** 隐藏 `3000` 端口，实现域名的优雅访问：

1. **安装 Nginx**：
```bash
sudo apt update
sudo apt install nginx
```

2. **添加你的专属域名配置**，新建文件 `/etc/nginx/sites-available/bio-toolbox` 并输入以下内容：
```nginx
server {
    listen 80;
    server_name bio-tools.yourdomain.com; # 这里替换成你的域名

    location / {
        proxy_pass http://localhost:3000; # 将请求转发给我们启动的 Node.js 端口
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        
        # 非常重要：允许上传较大的测序文件（这里举例最大可传 500MB，可以自行调大）
        client_max_body_size 500M;
    }
}
```

3. **启用该解析配置并重启 Nginx**：
```bash
sudo ln -s /etc/nginx/sites-available/bio-toolbox /etc/nginx/sites-enabled/
sudo nginx -t     # 检查你的配置语法是否正确
sudo systemctl restart nginx
```

此时你就可以直接通过 `http://bio-tools.yourdomain.com` 访问了！
*(小贴士：如果希望给网站加上安全的 HTTPS 小绿锁，只需在服务端打一条命令安装官方工具 `sudo apt install certbot python3-certbot-nginx`，然后敲入 `sudo certbot --nginx -d bio-tools.yourdomain.com` 即可全程自动搞定 HTTPS 配置。)*

---

## 3. 项目实现原理与深入扩展

### 3.1 核心实现机制
1. **JSON驱动的前端UI**：前端 `index.html` 每次刷新都会向 `/api/tools` 请求现存的工具列表。后端会扫描 `tools/` 文件夹下所有的 `.json` 配置文件返回。前端通过 JS 解析 JSON 里的 `params` 数组自动拼接出不同类型的输入框、下拉菜单、文件上传按钮。
2. **安全隔离的沙盒处理**：
   - 每次用户上传文件点击运行后，Node.js 会在本地 `uploads/<任务的随机UUID>/` 生成专属目录存放用户数据。
   - Node.js 解析 JSON 中的 `cmd` 字段，把界面界面上传来的参数无缝替换提取进去。
   - 通过 `spawn('docker', ['run', '--rm', '-v', ...])` 唤起 Docker 进程。利用 `-v` 参数硬挂载了 `uploads/<UUID>:/input` 和 `outputs/<UUID>:/output` 给容器以实现**数据隔离流动**。 
3. **SSE 实时伪终端**：容器内一切标准输出 (`stdout`/`stderr`) 触发 Node.js 事件，通过 SSE（Server-Sent Events）建立的长轮询连接，一字不差地逐行推送到网页前端的黑框控制台里。
4. **结果自动打包 Zip**：Docker 容器退出后，Node.js 监听到进程关闭事件，它会使用 `archiver` 库自动将 `outputs/<UUID>/` 里面的所有结果文件打包为一层 zip 压缩包供前台下载。
5. **知识文档库渲染**：前端第二个 Tab 刷新时会调用接口扫描 `/article` 下的 `.md` 文档。获取文档后在前端完全利用 `marked.js` 将它转为原生原风味的排版 HTML。

### 3.2 如何添加属于你自己的新工具

无论什么工具，添加均**不需要修改核心代码**！
你只需在 `tools/` 文件夹里创建一个新的 `.json` 文件（例如添加你自己的 `OhMyCellType` 工具）：

```json
{
  "id": "ohmycelltype",
  "name": "OhMyCellType",
  "type": "PYTHON / DOCKER",
  "image": "ohmycelltype:latest",
  "description": "单细胞 RNA-seq 自动细胞类型注释工具",
  "params": [
    {
      "key": "input",
      "label": "输入文件 (h5ad / csv)",
      "type": "file",
      "required": true,
      "description": "单细胞表达矩阵"
    },
    {
      "key": "species",
      "label": "物种",
      "type": "select",
      "options": [{"label": "人类", "value": "human"}, {"label": "小鼠", "value": "mouse"}],
      "default": "human"
    }
  ],
  "cmd": "ohmycelltype --input {input_name} --output /output --species {species}"
}
```

*简要规则说明：*
- 当你的 `params` 中的项 `type="file"`，网页将被渲染为上传拖动框。当后端组装命令时， `{input_name}` 这个特别占位符，会被自动化地填补上**用户所传文件的实际首个文件名**（例如 `test.csv`）。由于我们在挂载时传进 Docker 内在 `/input` 下，因此后端将其拼接为了 `/input/test.csv`。
- 如果是普通参数形式（例如 `number`, `string`, `select`），则会依据该字段的 `key`（如 `{species}`在配置中），无缝换成网页上的选中内容。（例如选择“小鼠”后，命令行将自动代入 `--species mouse`）。

只要添加类似的 JSON 文件，刷新你的网页，世界上又多了一个精美的容器化 Web 工具。
