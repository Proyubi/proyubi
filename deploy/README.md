# deploy

- `selfhost/nginx.conf`：根目录 `docker-compose.yml` 用的 web 容器配置（同域反代 `/api`、`/mock` 到 server）。

真实部署目标（服务器地址、账号、各环境 env）放在本机 `private/deploy/`，不进 git。
