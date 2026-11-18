# Proyubi

Repository: https://github.com/Proyubi/proyubi

Project management for teams that deliver software to clients — customers, projects, Gantt/WBS,
tests and bugs, documents, mockups and design boards in one place, with an MCP server so
Claude / ChatGPT can read and update the plan.

> Status: early. Being extracted from a private monorepo; the self-host setup below is not yet verified end to end.

## Repository layout

| Path | What |
|---|---|
| `server/` | Java 17 · Spring Boot 3.4 · MyBatis-Flex · PostgreSQL · Redis · Sa-Token (Maven multi-module) |
| `web/` | React 19 · Ant Design Pro · Umi 4 |
| `mcp/` | MCP server (TypeScript), stdio for local use and Streamable HTTP for remote |
| `doc/` | Design notes, requirements, manuals, changelog |
| `brand/` | Logo and icons |
| `deploy/` | Self-host nginx config and deployment notes |

## Self-host (Docker)

```bash
cp .env.example .env      # set passwords and keys
docker compose up -d --build
open http://localhost:8080
```

PostgreSQL runs the SQL in `server/schema/` on first start (empty data directory only).

## Development

```bash
# backend (needs PostgreSQL + Redis; see server/README.md)
cd server && cp .env.dev.example .env.dev && ./run.sh

# frontend → http://localhost:8000, proxies /app/** to :38082
cd web && pnpm install && pnpm run start:dev

# MCP
cd mcp && npm ci && npm test
```

## License

[GNU AGPL-3.0](LICENSE). If you run a modified version as a network service, you must offer its source to its users.
