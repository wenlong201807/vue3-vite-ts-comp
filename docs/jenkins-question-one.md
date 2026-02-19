# Jenkins CI/CD 自动化部署方案

> 项目地址：git@github.com:wenlong201807/vue3-vite-ts-comp.git
> Jenkins 地址：http://23.94.103.190:8080
> 目标服务器：23.94.103.190（Ubuntu 24.04 LTS）
> 部署类型：Vue3 + Vite + TypeScript 前端项目
> 核心特性：**自动选择分支** + **自动选择部署环境**

---

## 一、架构总览

```
开发者 Push/手动触发
       │
       ▼
┌──────────────────────────────────────────────────────────┐
│                    Jenkins Pipeline                       │
│                                                          │
│  参数化构建                                                │
│  ┌─────────────────┐  ┌──────────────────┐               │
│  │ 选择分支          │  │ 选择部署环境       │               │
│  │ ☑ main          │  │ ☑ production     │               │
│  │ ☐ develop       │  │ ☐ staging        │               │
│  │ ☐ feature/xxx   │  │ ☐ development    │               │
│  └─────────────────┘  └──────────────────┘               │
│                                                          │
│  Pipeline 阶段：                                          │
│  [拉取代码] → [安装依赖] → [构建] → [部署] → [通知]         │
└──────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────┐
│              服务器 23.94.103.190                          │
│                                                          │
│  Nginx 静态资源托管                                        │
│  ┌────────────────────────────────────────┐              │
│  │ /opt/webapps/vue3-comp/production/     │ ← 生产环境    │
│  │ /opt/webapps/vue3-comp/staging/        │ ← 预发布环境  │
│  │ /opt/webapps/vue3-comp/development/    │ ← 开发环境    │
│  └────────────────────────────────────────┘              │
│                                                          │
│  端口映射：                                                │
│  production   → :80   (http://23.94.103.190)             │
│  staging      → :8081 (http://23.94.103.190:8081)        │
│  development  → :8082 (http://23.94.103.190:8082)        │
└──────────────────────────────────────────────────────────┘
```

---

## 二、Jenkins 环境准备

### 2.1 安装必要插件

在 Jenkins → **Manage Jenkins** → **Plugins** → **Available plugins** 中搜索并安装：

| 插件名称 | 用途 |
|---------|------|
| **Git Parameter** | 参数化构建时动态获取 Git 分支/Tag 列表 |
| **NodeJS** | 提供 Node.js 构建环境 |
| **Publish Over SSH** | 通过 SSH 部署文件到远程服务器 |
| **Pipeline** | 支持 Jenkinsfile 流水线（通常已预装） |
| **Blue Ocean** | Pipeline 可视化界面（可选） |
| **Extended Choice Parameter** | 扩展参数选择（环境选择用） |

安装后重启 Jenkins：

```
http://23.94.103.190:8080/restart
```

### 2.2 配置 Node.js 环境

1. 进入 **Manage Jenkins** → **Tools**
2. 找到 **NodeJS installations** → **Add NodeJS**
3. 配置：
   - Name: `NodeJS-18`
   - Version: `NodeJS 18.x`（选择 18.20.x LTS）
   - Global npm packages to install: `pnpm`
4. **Save**

### 2.3 配置 GitHub SSH 凭据

1. 进入 **Manage Jenkins** → **Credentials** → **System** → **Global credentials** → **Add Credentials**
2. 选择类型 **SSH Username with private key**
3. 配置：
   - ID: `github-ssh-key`
   - Description: `GitHub SSH Deploy Key`
   - Username: `git`
   - Private Key → **Enter directly** → 粘贴服务器的 SSH 私钥

生成并配置 SSH 密钥（在服务器上执行）：

```bash
# 生成 SSH 密钥对（如果没有）
ssh-keygen -t ed25519 -C "jenkins@23.94.103.190" -f /root/.ssh/id_ed25519_github -N ""

# 查看公钥（需添加到 GitHub 项目的 Deploy Keys）
cat /root/.ssh/id_ed25519_github.pub

# 查看私钥（需粘贴到 Jenkins 凭据）
cat /root/.ssh/id_ed25519_github

# 配置 SSH 使用此密钥连接 GitHub
cat >> /root/.ssh/config << 'EOF'
Host github.com
    HostName github.com
    User git
    IdentityFile /root/.ssh/id_ed25519_github
    StrictHostKeyChecking no
EOF

# 测试 GitHub 连接
ssh -T git@github.com
```

将公钥添加到 GitHub：
- 打开 https://github.com/wenlong201807/vue3-vite-ts-comp/settings/keys
- **Add deploy key** → 粘贴公钥内容 → 勾选 **Allow write access** → **Add key**

### 2.4 创建部署目录和 Nginx 配置

在服务器上执行：

```bash
# 创建各环境的部署目录
mkdir -p /opt/webapps/vue3-comp/{production,staging,development}

# 设置权限
chown -R www-data:www-data /opt/webapps/vue3-comp
chmod -R 755 /opt/webapps/vue3-comp
```

创建 Nginx 配置文件：

```bash
cat > /etc/nginx/sites-available/vue3-comp << 'NGINX_CONF'
# ========== 生产环境 (端口 80) ==========
server {
    listen 9000;
    server_name 23.94.103.190;

    root /opt/webapps/vue3-comp/production;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;
}

# ========== 预发布环境 (端口 8081) ==========
server {
    listen 8081;
    server_name 23.94.103.190;

    root /opt/webapps/vue3-comp/staging;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;
}

# ========== 开发环境 (端口 8082) ==========
server {
    listen 8082;
    server_name 23.94.103.190;

    root /opt/webapps/vue3-comp/development;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;
}
NGINX_CONF
```

启用配置并重启 Nginx：

```bash
# 如果 Nginx 已安装（宿主机直接安装模式）
ln -sf /etc/nginx/sites-available/vue3-comp /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# 如果 Nginx 还未安装
apt install -y nginx
ln -sf /etc/nginx/sites-available/vue3-comp /etc/nginx/sites-enabled/
systemctl enable nginx && systemctl start nginx

# 开放防火墙端口
ufw allow 9000/tcp
ufw allow 8081/tcp
ufw allow 8082/tcp
```

> **注意**：生产环境使用端口 `9000` 而不是 `80`，因为 `80` 端口已被 RuoYi 前端 Docker 容器占用。

---

## 三、创建 Jenkins Pipeline 任务

### 3.1 新建 Pipeline 任务

1. Jenkins 首页 → **新建任务**
2. 输入名称：`vue3-vite-ts-comp`
3. 选择 **流水线 (Pipeline)**
4. 点击 **确定**

### 3.2 配置参数化构建

在任务配置页中：

1. 勾选 **参数化构建过程**

2. **添加参数** → **Git Parameter**（分支选择）：
   - Name: `BRANCH`
   - Description: `选择要部署的分支`
   - Parameter Type: `Branch`
   - Default Value: `origin/main`
   - Branch Filter: `.*`（匹配所有分支）
   - Sort Mode: `Descending Smart`

3. **添加参数** → **Choice Parameter**（环境选择）：
   - Name: `DEPLOY_ENV`
   - Description: `选择部署环境`
   - Choices:（每行一个）
     ```
     production
     staging
     development
     ```

4. **添加参数** → **Boolean Parameter**（可选：是否清除缓存）：
   - Name: `CLEAN_BUILD`
   - Default Value: `false`
   - Description: `是否清除 node_modules 后重新安装依赖`

### 3.3 配置 Pipeline Script

在 **流水线** 部分，选择 **Pipeline script**，粘贴以下内容：

```groovy
pipeline {
    agent any

    tools {
        nodejs 'NodeJS-20'
    }

    parameters {
        gitParameter(
            name: 'BRANCH',
            type: 'PT_BRANCH',
            defaultValue: 'origin/main',
            description: '选择要部署的分支',
            branchFilter: '.*',
            sortMode: 'DESCENDING_SMART',
            selectedValue: 'DEFAULT',
            useRepository: 'git@github.com:wenlong201807/vue3-vite-ts-comp.git'
        )
        choice(
            name: 'DEPLOY_ENV',
            choices: ['production', 'staging', 'development'],
            description: '选择部署环境'
        )
        booleanParam(
            name: 'CLEAN_BUILD',
            defaultValue: false,
            description: '是否清除 node_modules 后重新安装依赖'
        )
    }

    environment {
        PROJECT_NAME  = 'vue3-vite-ts-comp'
        DEPLOY_DIR    = "/opt/webapps/vue3-comp/${params.DEPLOY_ENV}"
        BUILD_MODE    = "${params.DEPLOY_ENV == 'production' ? 'build:prod' : (params.DEPLOY_ENV == 'staging' ? 'build:stage' : 'build:dev')}"
        BRANCH_CLEAN  = "${params.BRANCH.replaceAll('origin/', '')}"
    }

    stages {
        stage('信息确认') {
            steps {
                echo "========================================"
                echo "项目名称：${PROJECT_NAME}"
                echo "部署分支：${params.BRANCH} → ${BRANCH_CLEAN}"
                echo "部署环境：${params.DEPLOY_ENV}"
                echo "构建命令：npm run ${BUILD_MODE}"
                echo "部署目录：${DEPLOY_DIR}"
                echo "清除缓存：${params.CLEAN_BUILD}"
                echo "========================================"
            }
        }

        stage('拉取代码') {
            steps {
                checkout([
                    $class: 'GitSCM',
                    branches: [[name: "${params.BRANCH}"]],
                    userRemoteConfigs: [[
                        url: 'git@github.com:wenlong201807/vue3-vite-ts-comp.git',
                        credentialsId: 'github-ssh-key'
                    ]]
                ])
                echo "代码拉取完成，当前分支：${BRANCH_CLEAN}"
            }
        }

        stage('安装依赖') {
            steps {
                script {
                    if (params.CLEAN_BUILD) {
                        sh 'rm -rf node_modules'
                        echo '已清除 node_modules'
                    }
                }
                sh '''
                    echo "Node 版本: $(node -v)"
                    echo "npm 版本: $(npm -v)"
                    npm config set registry https://registry.npmmirror.com
                    npm install
                '''
            }
        }

        stage('项目构建') {
            steps {
                script {
                    def buildCmd = env.BUILD_MODE
                    def packageJson = readJSON file: 'package.json'
                    def scripts = packageJson.scripts

                    if (scripts.containsKey(buildCmd)) {
                        sh "pnpm run ${buildCmd}"
                    } else if (scripts.containsKey('build')) {
                        echo "未找到 ${buildCmd} 命令，使用默认 build"
                        sh "pnpm run build"
                    } else {
                        sh "npx vite build --mode ${params.DEPLOY_ENV}"
                    }
                }
            }
        }

        stage('部署发布') {
            steps {
                sh """
                    # 备份旧版本（保留最近3个版本）
                    BACKUP_DIR="/opt/webapps/vue3-comp/backups/${params.DEPLOY_ENV}"
                    mkdir -p \$BACKUP_DIR
                    if [ -d "${DEPLOY_DIR}" ] && [ "\$(ls -A ${DEPLOY_DIR} 2>/dev/null)" ]; then
                        TIMESTAMP=\$(date +%Y%m%d_%H%M%S)
                        tar czf \$BACKUP_DIR/\${TIMESTAMP}.tar.gz -C ${DEPLOY_DIR} .
                        # 只保留最近3个备份
                        cd \$BACKUP_DIR && ls -t *.tar.gz | tail -n +4 | xargs -r rm
                    fi

                    # 清空目标目录并部署新版本
                    rm -rf ${DEPLOY_DIR}/*
                    cp -r dist/* ${DEPLOY_DIR}/

                    echo "部署完成 → ${DEPLOY_DIR}"
                """
            }
        }

        stage('健康检查') {
            steps {
                script {
                    def portMap = [
                        'production' : 9000,
                        'staging'    : 8081,
                        'development': 8082
                    ]
                    def port = portMap[params.DEPLOY_ENV]
                    def url = "http://127.0.0.1:${port}"

                    sh """
                        echo "正在验证部署结果..."
                        sleep 2
                        HTTP_CODE=\$(curl -s -o /dev/null -w '%{http_code}' ${url}/ || echo '000')
                        if [ "\$HTTP_CODE" = "200" ]; then
                            echo "✅ 健康检查通过 (HTTP \$HTTP_CODE)"
                            echo "访问地址: http://23.94.103.190:${port}"
                        else
                            echo "⚠️ 健康检查返回 HTTP \$HTTP_CODE，请检查 Nginx 配置"
                        fi
                    """
                }
            }
        }
    }

    post {
        success {
            script {
                def portMap = [
                    'production' : 9000,
                    'staging'    : 8081,
                    'development': 8082
                ]
                def port = portMap[params.DEPLOY_ENV]
                echo """
========================================
✅ 部署成功！
项目：${PROJECT_NAME}
分支：${BRANCH_CLEAN}
环境：${params.DEPLOY_ENV}
地址：http://23.94.103.190:${port}
时间：${new Date().format('yyyy-MM-dd HH:mm:ss')}
========================================
"""
            }
        }
        failure {
            echo """
========================================
❌ 部署失败！请检查构建日志。
分支：${BRANCH_CLEAN}
环境：${params.DEPLOY_ENV}
========================================
"""
        }
        always {
            cleanWs(
                cleanWhenNotBuilt: false,
                deleteDirs: false,
                disableDeferredWipeout: true,
                notFailBuild: true
            )
        }
    }
}
```

点击 **Save** 保存。

---

## 四、（进阶）使用 Jenkinsfile 管理 Pipeline

推荐将 Pipeline 定义放入项目仓库中，实现 Pipeline as Code。

### 4.1 在项目仓库根目录创建 Jenkinsfile

```groovy
// Jenkinsfile
pipeline {
    agent any

    tools {
        nodejs 'NodeJS-20'
    }

    parameters {
        gitParameter(
            name: 'BRANCH',
            type: 'PT_BRANCH',
            defaultValue: 'origin/main',
            description: '选择要部署的分支',
            branchFilter: '.*',
            sortMode: 'DESCENDING_SMART',
            selectedValue: 'DEFAULT',
            useRepository: 'git@github.com:wenlong201807/vue3-vite-ts-comp.git'
        )
        choice(
            name: 'DEPLOY_ENV',
            choices: ['production', 'staging', 'development'],
            description: '选择部署环境'
        )
        booleanParam(
            name: 'CLEAN_BUILD',
            defaultValue: false,
            description: '是否清除缓存后重新安装依赖'
        )
    }

    environment {
        PROJECT_NAME  = 'vue3-vite-ts-comp'
        DEPLOY_DIR    = "/opt/webapps/vue3-comp/${params.DEPLOY_ENV}"
    }

    stages {
        stage('信息确认') {
            steps {
                script {
                    currentBuild.displayName = "#${BUILD_NUMBER}-${params.DEPLOY_ENV}-${params.BRANCH.replaceAll('origin/', '')}"
                    currentBuild.description = "分支: ${params.BRANCH} | 环境: ${params.DEPLOY_ENV}"
                }
                echo "部署分支: ${params.BRANCH}"
                echo "部署环境: ${params.DEPLOY_ENV}"
                echo "部署目录: ${DEPLOY_DIR}"
            }
        }

        stage('拉取代码') {
            steps {
                checkout([
                    $class: 'GitSCM',
                    branches: [[name: "${params.BRANCH}"]],
                    userRemoteConfigs: [[
                        url: 'git@github.com:wenlong201807/vue3-vite-ts-comp.git',
                        credentialsId: 'github-ssh-key'
                    ]]
                ])
            }
        }

        stage('安装依赖') {
            steps {
                script {
                    if (params.CLEAN_BUILD) {
                        sh 'rm -rf node_modules'
                    }
                }
                sh '''
                    npm config set registry https://registry.npmmirror.com
                    npm install
                '''
            }
        }

        stage('构建') {
            steps {
                script {
                    def packageJson = readJSON file: 'package.json'
                    def scripts = packageJson.scripts
                    def envCmdMap = [
                        'production' : 'build:prod',
                        'staging'    : 'build:stage',
                        'development': 'build:dev'
                    ]
                    def targetCmd = envCmdMap[params.DEPLOY_ENV] ?: 'build'

                    if (scripts.containsKey(targetCmd)) {
                        sh "pnpm run ${targetCmd}"
                    } else if (scripts.containsKey('build')) {
                        sh "pnpm run build"
                    } else {
                        sh "npx vite build --mode ${params.DEPLOY_ENV}"
                    }
                }
            }
        }

        stage('部署') {
            steps {
                sh """
                    BACKUP_DIR="/opt/webapps/vue3-comp/backups/${params.DEPLOY_ENV}"
                    mkdir -p \$BACKUP_DIR

                    if [ -d "${DEPLOY_DIR}" ] && [ "\$(ls -A ${DEPLOY_DIR} 2>/dev/null)" ]; then
                        TIMESTAMP=\$(date +%Y%m%d_%H%M%S)
                        tar czf \$BACKUP_DIR/\${TIMESTAMP}.tar.gz -C ${DEPLOY_DIR} .
                        cd \$BACKUP_DIR && ls -t *.tar.gz | tail -n +4 | xargs -r rm
                    fi

                    rm -rf ${DEPLOY_DIR}/*
                    cp -r dist/* ${DEPLOY_DIR}/
                """
            }
        }

        stage('验证') {
            steps {
                script {
                    def portMap = ['production': 9000, 'staging': 8081, 'development': 8082]
                    def port = portMap[params.DEPLOY_ENV]
                    sh """
                        sleep 2
                        HTTP_CODE=\$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:${port}/ || echo '000')
                        if [ "\$HTTP_CODE" = "200" ]; then
                            echo "部署验证通过 → http://23.94.103.190:${port}"
                        else
                            echo "部署验证返回 HTTP \$HTTP_CODE"
                        fi
                    """
                }
            }
        }
    }

    post {
        success {
            script {
                def portMap = ['production': 9000, 'staging': 8081, 'development': 8082]
                def port = portMap[params.DEPLOY_ENV]
                echo "部署成功 → http://23.94.103.190:${port}"
            }
        }
        failure {
            echo "部署失败，请查看日志排查问题"
        }
    }
}
```

### 4.2 Jenkins 任务改为从 SCM 读取 Pipeline

1. 打开任务 → **配置**
2. **流水线** 部分：
   - Definition: **Pipeline script from SCM**
   - SCM: **Git**
   - Repository URL: `git@github.com:wenlong201807/vue3-vite-ts-comp.git`
   - Credentials: `github-ssh-key`
   - Branch Specifier: `*/${BRANCH}`
   - Script Path: `Jenkinsfile`
3. **Save**

---

## 五、配置 GitHub Webhook（自动触发构建）

### 5.1 Jenkins 端配置

1. 打开任务 → **配置** → **构建触发器**
2. 勾选 **GitHub hook trigger for GITScm polling**
3. **Save**

### 5.2 GitHub 端配置

1. 打开 https://github.com/wenlong201807/vue3-vite-ts-comp/settings/hooks
2. **Add webhook**：
   - Payload URL: `http://23.94.103.190:8080/github-webhook/`
   - Content type: `application/json`
   - Secret: 留空（或设置一个密钥并在 Jenkins 中配置）
   - Which events: **Just the push event**
3. **Add webhook**

### 5.3 防火墙放行

```bash
ufw allow 8080/tcp
```

> **注意**：Webhook 触发的构建会使用默认参数（main 分支 + production 环境）。如需指定分支和环境，建议手动触发参数化构建。

---

## 六、前端项目适配（build 命令约定）

为了让 Jenkins Pipeline 的环境选择功能生效，项目的 `package.json` 中需要有对应的构建命令。

### 6.1 推荐的 scripts 配置

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "build:dev": "vite build --mode development",
    "build:stage": "vite build --mode staging",
    "build:prod": "vite build --mode production",
    "preview": "vite preview"
  }
}
```

### 6.2 对应的环境变量文件

```
项目根目录/
├── .env                  # 所有环境共用
├── .env.development      # 开发环境
├── .env.staging          # 预发布环境
├── .env.production       # 生产环境
```

示例 `.env.production`：

```ini
VITE_APP_TITLE = 我的应用
VITE_APP_ENV = production
VITE_APP_BASE_API = /api
```

示例 `.env.staging`：

```ini
VITE_APP_TITLE = 我的应用(预发布)
VITE_APP_ENV = staging
VITE_APP_BASE_API = /api
```

示例 `.env.development`：

```ini
VITE_APP_TITLE = 我的应用(开发)
VITE_APP_ENV = development
VITE_APP_BASE_API = /dev-api
```

> Pipeline 中已做兼容处理：如果项目没有 `build:prod` 等命令，会降级使用 `build` 或 `npx vite build --mode xxx`。

---

## 七、完整执行步骤（从零到部署）

### 第一步：服务器环境初始化

```bash
ssh root@23.94.103.190

# 1. 安装 Nginx（如果尚未安装）
apt install -y nginx

# 2. 创建部署目录
mkdir -p /opt/webapps/vue3-comp/{production,staging,development}
mkdir -p /opt/webapps/vue3-comp/backups/{production,staging,development}

# 3. 写入 Nginx 配置
cat > /etc/nginx/sites-available/vue3-comp << 'NGINX_CONF'
server {
    listen 9000;
    server_name 23.94.103.190;
    root /opt/webapps/vue3-comp/production;
    index index.html;
    location / {
        try_files $uri $uri/ /index.html;
    }
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;
}

server {
    listen 8081;
    server_name 23.94.103.190;
    root /opt/webapps/vue3-comp/staging;
    index index.html;
    location / {
        try_files $uri $uri/ /index.html;
    }
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;
}

server {
    listen 8082;
    server_name 23.94.103.190;
    root /opt/webapps/vue3-comp/development;
    index index.html;
    location / {
        try_files $uri $uri/ /index.html;
    }
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;
}
NGINX_CONF

# 4. 启用配置
ln -sf /etc/nginx/sites-available/vue3-comp /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# 5. 开放端口
ufw allow 9000/tcp
ufw allow 8081/tcp
ufw allow 8082/tcp

# 6. 配置 GitHub SSH 密钥
ssh-keygen -t ed25519 -C "jenkins@23.94.103.190" -f /root/.ssh/id_ed25519_github -N ""
cat /root/.ssh/id_ed25519_github.pub
# → 将输出的公钥添加到 GitHub 项目的 Deploy Keys

cat >> /root/.ssh/config << 'EOF'
Host github.com
    HostName github.com
    User git
    IdentityFile /root/.ssh/id_ed25519_github
    StrictHostKeyChecking no
EOF

ssh -T git@github.com
```

### 第二步：Jenkins 配置

1. 访问 http://23.94.103.190:8080
2. 安装插件：Git Parameter、NodeJS、Pipeline
3. 配置 Node.js 工具：Manage Jenkins → Tools → NodeJS → `NodeJS-18`
4. 添加 GitHub SSH 凭据：Manage Jenkins → Credentials → `github-ssh-key`
5. 新建 Pipeline 任务：`vue3-vite-ts-comp`
6. 粘贴第三章的 Pipeline Script
7. Save

### 第三步：首次构建

1. 进入任务 → **Build with Parameters**
2. 选择分支：`origin/main`
3. 选择环境：`production`
4. 点击 **开始构建**
5. 点击构建编号查看 **Console Output** 跟踪进度

### 第四步：验证

```bash
# 生产环境
curl -I http://23.94.103.190:9000
# 预期: HTTP/1.1 200 OK

# 预发布环境
curl -I http://23.94.103.190:8081

# 开发环境
curl -I http://23.94.103.190:8082
```

---

## 八、日常使用

### 8.1 手动触发部署

1. 打开 http://23.94.103.190:8080/job/vue3-vite-ts-comp/
2. 点击 **Build with Parameters**
3. 从下拉列表选择分支和环境
4. 点击 **开始构建**

### 8.2 回滚到上一版本

```bash
# 查看备份列表
ls -lt /opt/webapps/vue3-comp/backups/production/

# 回滚（替换为实际的备份文件名）
DEPLOY_DIR="/opt/webapps/vue3-comp/production"
BACKUP_FILE="/opt/webapps/vue3-comp/backups/production/20260217_143000.tar.gz"
rm -rf $DEPLOY_DIR/*
tar xzf $BACKUP_FILE -C $DEPLOY_DIR
```

### 8.3 查看构建历史

- Jenkins 任务页面左侧的 **构建历史** 列表
- 每次构建标题会显示分支和环境信息（如 `#5-production-main`）

---

## 九、常见问题排查

### 9.1 Git Parameter 下拉列表为空

**原因**：首次创建任务时，Jenkins 尚未扫描仓库。

**解决**：
1. 先用默认参数触发一次构建（可以失败没关系）
2. 第二次打开 **Build with Parameters** 时分支列表就会出现

### 9.2 npm install 失败（网络超时）

**解决**：确认已配置 npm 镜像源：

```bash
# 在 Pipeline 中已包含，或全局配置
npm config set registry https://registry.npmmirror.com
```

### 9.3 构建找不到 build:prod 命令

**原因**：项目 `package.json` 中没有对应的 script。

**解决**：Pipeline 已做兼容处理，会依次尝试 `build:prod` → `build` → `npx vite build --mode production`。

### 9.4 部署后页面 404

**原因**：Nginx 配置中 `try_files` 未生效或部署目录为空。

**排查**：

```bash
# 检查部署目录是否有文件
ls -la /opt/webapps/vue3-comp/production/

# 检查 Nginx 配置
nginx -t

# 查看 Nginx 错误日志
tail -20 /var/log/nginx/error.log
```

### 9.5 Jenkins 没有权限写入部署目录

**解决**：

```bash
# 确认 Jenkins 运行用户（通常为 jenkins）
ps aux | grep jenkins

# 给 Jenkins 用户写入权限
chown -R jenkins:jenkins /opt/webapps/vue3-comp
# 或
chmod -R 777 /opt/webapps/vue3-comp
```

---

## 十、访问地址汇总

| 环境 | 地址 | 用途 |
|------|------|------|
| **Jenkins** | http://23.94.103.190:8080 | CI/CD 管理界面 |
| **生产环境** | http://23.94.103.190:9000 | 正式发布版本 |
| **预发布环境** | http://23.94.103.190:8081 | 上线前验证 |
| **开发环境** | http://23.94.103.190:8082 | 开发联调 |
