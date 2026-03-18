# 五一的生物信息工具箱

这是一款基于 Node.js 和 Docker 的轻量级、完全容器化的生物信息学分析 Web 平台。通过简洁的配置，您可以将复杂的生信命令行工具转换为带有精美界面的 Web 应用。

---

## 1. 本地运行与部署 (Local Deployment)

要让该工具箱在您的个人电脑（Windows/Mac/Linux）上真正跑起来，只需以下几步：

### 1.1 安装 Docker (核心依赖)
本项目**完全依赖 Docker** 来确保生信工具的跨平台一致性。
- 请前往 [Docker 官网](https://www.docker.com/products/docker-desktop/) 下载并安装 Docker Desktop。
- 安装完毕后，在终端输入 `docker --version` 确认安装成功。

### 1.2 准备代码环境
在项目根目录下，执行以下命令安装网页后台所需的零件：
```bash
npm install
```

### 1.3 启动与运行
执行以下命令启动服务：
```bash
npm start
```
然后在浏览器访问 `http://localhost:3000`。上传文件并点击 **RUN CONTAINER**，后台就会自动调用本地 Docker 镜像来处理你的真实数据了！

### 1.4 (进阶) 构建自己的工具镜像
如果您有**自己开发的 Docker 生信工具**（例如 `ohmycelltype`），在本地构建它的镜像：
```bash
docker build -f tools/ohmycelltype.Dockerfile -t ohmycelltype:latest .
```

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

### 3.2 如何添加或修改属于你自己的新工具
只需在 `tools/` 文件夹中直接创建或编辑 `.json` 配置文件，无需改动任何代码，前端界面和后端逻辑将自动同步生成。

#### 示例配置详解 (以 `ohmycelltype.json` 为例)：
```json
{
  "id": "ohmycelltype",
  "name": "哦我的细胞 (OhMyCellType)",
  "image": "ohmycelltype:latest",
  "output_extension": ".csv", 
  "cmd": ["ohmycelltype", "--input", "{input}", "--threads", "{threads}", "--filters", "{filters}"],
  "params": [
    {
      "key": "input",
      "label": "测序数据",
      "type": "file",
      "required": true,
      "width": "full"
    },
    {
      "key": "filters",
      "label": "预处理步骤",
      "type": "multi-select",
      "width": "full",
      "options": [{"label": "去除线粒体", "value": "mito"}, {"label": "去除核糖体", "value": "ribo"}],
      "default": ["mito"]
    },
    {
      "key": "threads",
      "label": "线程数",
      "type": "number",
      "default": 8
    }
  ]
}
```

#### 关键字段及规则：
1. **`cmd` (命令模板)**：
   - 使用 `{key}` 语法来实时替换界面上用户输入的值。
   - `{input}` 如果对应 `type: file`，后端会自动将其路径转换为 Docker 容器内的路径（如 `/input/yourdata.csv`）。
2. **`params[].type` (支持的输入类型)**：
   - `file`：渲染为精美的拖拽上传框。
   - `select`：渲染为下拉菜单（需提供 `options` 列表）。
   - `multi-select`：渲染为**复选框按钮组**，选中的多个结果将自动以**逗号**拼接（如 `mito,ribo`）。
   - `number` / `text`：常规数字或文本框。
3. **`params[].width` (排版控制)**：
   - 设置为 `"full"` 则独占一行；不设置则默认平铺（通常两个参数并排一行）。
4. **`output_extension` (下载策略)**：
   - 若不设置：默认将整个输出目录打成 `.zip` 给用户。
   - 设置为单一后缀（如 `.csv`）：若输出目录内只有 1 个文件匹配，将**跳过压缩直接下载原文件**。
   - 支持多后缀（如 `[".csv", ".sam"]`）：只下载并打包选定格式的文件。

只要在 `tools/` 目录添加了文件并保存，刷新你的网页即可实时在线预览效果。
