const express = require('express');
const multer = require('multer');
const archiver = require('archiver');
const { v4: uuidv4 } = require('uuid');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

// 确保目录存在
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const OUTPUTS_DIR = path.join(__dirname, 'outputs');
const TOOLS_DIR = path.join(__dirname, 'tools');
const ARTICLE_DIR = path.join(__dirname, 'article');
[UPLOADS_DIR, OUTPUTS_DIR, TOOLS_DIR, ARTICLE_DIR].forEach(d => !fs.existsSync(d) && fs.mkdirSync(d, { recursive: true }));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// multer 配置 - 按 jobId 分目录存储上传文件
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const jobId = req.headers['x-job-id'] || uuidv4();
    req.jobId = jobId;
    const dir = path.join(UPLOADS_DIR, jobId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    // 追加时间戳与随机数，防止即使是在同一个任务空间内有两个极端同名文件上传互相覆盖
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});
const upload = multer({ storage });

// 存储每个 jobId 的日志和状态
const jobs = {}; // { jobId: { logs: [], status: 'running'|'done'|'error', clients: [] } }

function emitLog(jobId, line) {
  if (!jobs[jobId]) return;
  jobs[jobId].logs.push(line);
  jobs[jobId].clients.forEach(res => {
    res.write(`data: ${JSON.stringify({ line })}\n\n`);
  });
}

function emitDone(jobId, status) {
  if (!jobs[jobId]) return;
  jobs[jobId].status = status;
  jobs[jobId].clients.forEach(res => {
    res.write(`data: ${JSON.stringify({ done: true, status })}\n\n`);
    res.end();
  });
  jobs[jobId].clients = [];
}

// ─── GET /api/tools ───────────────────────────────────────────────────────────
app.get('/api/tools', (req, res) => {
  if (!fs.existsSync(TOOLS_DIR)) return res.json([]);
  const files = fs.readdirSync(TOOLS_DIR).filter(f => f.endsWith('.json'));
  const tools = files.map(f => {
    try { return JSON.parse(fs.readFileSync(path.join(TOOLS_DIR, f), 'utf8')); }
    catch { return null; }
  }).filter(Boolean);
  res.json(tools);
});

// ─── GET /api/articles ────────────────────────────────────────────────────────
app.get('/api/articles', (req, res) => {
  if (!fs.existsSync(ARTICLE_DIR)) return res.json([]);
  const files = fs.readdirSync(ARTICLE_DIR).filter(f => f.endsWith('.md'));
  res.json(files.map(f => ({ name: f.replace('.md', ''), filename: f })));
});

// ─── GET /api/articles/:filename ──────────────────────────────────────────────
app.get('/api/articles/:filename', (req, res) => {
  const file = path.join(ARTICLE_DIR, req.params.filename);
  if (!fs.existsSync(file)) return res.status(404).send('Not found');
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.sendFile(file);
});

// ─── POST /api/run ────────────────────────────────────────────────────────────
app.post('/api/run', upload.any(), (req, res) => {
  const jobId = req.jobId || uuidv4();
  const { toolId, params } = req.body;
  const parsedParams = JSON.parse(params || '{}');

  // 读取工具配置
  const toolFile = path.join(TOOLS_DIR, `${toolId}.json`);
  if (!fs.existsSync(toolFile)) return res.status(404).json({ error: 'Tool not found' });
  const tool = JSON.parse(fs.readFileSync(toolFile, 'utf8'));

  // 创建输出目录
  const outputDir = path.join(OUTPUTS_DIR, jobId);
  fs.mkdirSync(outputDir, { recursive: true });

  // 初始化 job
  jobs[jobId] = { logs: [], status: 'running', clients: [] };
  res.json({ jobId });

  // 构建参数映射表: key -> 实际值（file类型 -> /input/文件名，其他 -> 字符串值）
  const uploadDir = path.join(UPLOADS_DIR, jobId);
  const valueMap = {};
  tool.params.forEach(p => {
    if (p.type === 'file') {
      const uploadedFile = req.files && req.files.find(f => f.fieldname === p.key);
      valueMap[p.key] = uploadedFile ? `/input/${uploadedFile.originalname}` : '';
    } else {
      const val = parsedParams[p.key] !== undefined ? parsedParams[p.key] : p.default;
      valueMap[p.key] = val !== undefined ? String(val) : '';
    }
  });

  // ── 构建 docker run 参数 ─────────────────────────────────────────────────────
  const dockerArgs = [
    'run', '--rm',
    '-v', `${uploadDir}:/input`,
    '-v', `${outputDir}:/output`,
  ];

  // 支持额外的 -e / --env 环境变量（JSON 中 env: { KEY: value }）
  if (tool.env) {
    Object.entries(tool.env).forEach(([k, v]) => {
      dockerArgs.push('-e', `${k}=${v}`);
    });
  }

  dockerArgs.push(tool.image);

  if (tool.cmd && Array.isArray(tool.cmd)) {
    // ── 方案 B：cmd 模板数组，{key} 占位符替换 ──────────────────────────────
    tool.cmd.forEach(segment => {
      // 替换所有 {key} 占位符
      const resolved = segment.replace(/\{(\w+)\}/g, (_, key) => valueMap[key] ?? '');
      if (resolved !== '') dockerArgs.push(resolved);
    });
  } else {
    // ── 回退：旧的 --key value 模式（向后兼容）──────────────────────────────
    tool.params.forEach(p => {
      const val = valueMap[p.key];
      if (val !== undefined && val !== '') {
        dockerArgs.push(`--${p.key}`, val);
      }
    });
  }

  // 记录并执行命令
  const cmdStr = `docker ${dockerArgs.join(' ')}`;
  emitLog(jobId, `$ ${cmdStr}`);
  emitLog(jobId, `> Job ID: ${jobId}`);
  emitLog(jobId, `> 正在启动容器...`);

  let errorHandled = false;

  const proc = spawn('docker', dockerArgs);

  proc.stdout.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => emitLog(jobId, l)));
  proc.stderr.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => emitLog(jobId, `[stderr] ${l}`)));

  proc.on('error', err => {
    errorHandled = true;
    // Docker 未安装或不可用时进入演示模式
    emitLog(jobId, `[WARN] Docker 不可用 (${err.code}): ${err.message}`);
    emitLog(jobId, `> 进入演示模式（模拟运行）...`);

    // 写一个示例输出文件供下载
    fs.writeFileSync(path.join(outputDir, 'result.txt'),
      `工具: ${tool.name}\n参数: ${JSON.stringify(parsedParams, null, 2)}\n运行时间: ${new Date().toISOString()}\n状态: 成功（演示模式）\n`);

    const mockLogs = [
      `> 加载工具镜像: ${tool.image}`,
      `> 挂载输入目录: /input`,
      `> 挂载输出目录: /output`,
      `> 初始化运行环境... [██████████] 100%`,
      `> 处理输入文件...`,
      `> 分析中... [████████░░] 80%`,
      `> 分析中... [██████████] 100%`,
      `> 生成结果报告...`,
      `> 任务完成! 结果已保存到 /output`,
      `> 演示完成。`,
    ];
    let i = 0;
    const interval = setInterval(() => {
      if (i < mockLogs.length) {
        emitLog(jobId, mockLogs[i++]);
      } else {
        clearInterval(interval);
        emitDone(jobId, 'done');
      }
    }, 400);
  });

  proc.on('close', code => {
    if (errorHandled) return; // error 事件已经接管，忽略 close
    emitLog(jobId, `> 容器退出，exit code: ${code}`);
    emitDone(jobId, code === 0 ? 'done' : 'error');
  });
});

// ─── GET /api/logs/:jobId (SSE) ───────────────────────────────────────────────
app.get('/api/logs/:jobId', (req, res) => {
  const { jobId } = req.params;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const job = jobs[jobId];
  if (!job) { res.write(`data: ${JSON.stringify({ error: 'Job not found' })}\n\n`); return res.end(); }

  // 先推送历史日志
  job.logs.forEach(line => res.write(`data: ${JSON.stringify({ line })}\n\n`));

  if (job.status !== 'running') {
    res.write(`data: ${JSON.stringify({ done: true, status: job.status })}\n\n`);
    return res.end();
  }

  job.clients.push(res);
  req.on('close', () => {
    job.clients = job.clients.filter(c => c !== res);
  });
});

// ─── GET /api/download/:jobId ─────────────────────────────────────────────────
app.get('/api/download/:jobId', (req, res) => {
  const { jobId } = req.params;
  const outputDir = path.join(OUTPUTS_DIR, jobId);
  if (!fs.existsSync(outputDir)) return res.status(404).json({ error: 'No output found' });

  let ext = req.query.ext;
  if (ext) {
    const exts = ext.split(',').map(e => e.trim().startsWith('.') ? e.trim() : `.${e.trim()}`);
    const files = fs.readdirSync(outputDir).filter(f => exts.some(suffix => f.endsWith(suffix)));
    if (files.length === 1) {
      return res.download(path.join(outputDir, files[0]), files[0]);
    } else if (files.length > 1) {
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="result-${jobId.slice(0, 8)}.zip"`);
      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.pipe(res);
      files.forEach(f => archive.file(path.join(outputDir, f), { name: f }));
      return archive.finalize();
    }
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="result-${jobId.slice(0, 8)}.zip"`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.pipe(res);
  archive.directory(outputDir, false);
  archive.finalize();
});

app.listen(PORT, () => {
  console.log(`\n🧬 生物信息工具箱服务已启动`);
  console.log(`   访问地址: http://localhost:${PORT}\n`);
});
