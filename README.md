# 智慧化進階機票搜尋與策略規劃系統 (Smart Flight Finder)

> 以「假期」為核心，整合台灣連假、彈性日期矩陣、多段旅程 (Multi-city / Open-Jaw)，
> 以及資深玩家的反向票 (Reverse Ticketing) 與外站四段票 (Back-to-back 4-leg) 策略，
> 自動運算性價比最高、請假效益最大化的機票組合。

**可免費自架：** 可透過 [Cloudflare Workers Free Plan](https://developers.cloudflare.com/workers/platform/pricing/) 一鍵部署網站、公用票價資料庫與 Email 登入，不需要自行準備伺服器；一般個人使用可從免費方案開始。

## 一鍵部署

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/b8rrs4sydg-cmyk/Flight-Finder)

點擊按鈕後，Cloudflare 會在你的 GitHub 帳號建立新的 repository、自動建立 D1 資料庫並部署成 Worker（網頁 + API 在同一個網址）。

1. 首次使用時，依畫面透過 **Git account → New Github Connection → Install & Authorize** 授權 Cloudflare 存取 GitHub。
   - 若你就是此儲存庫的擁有者，按鈕預設要建立的新儲存庫名稱會和現有的相同而失敗（出現 *Cloudflare could not create the Git repository*）：請把表單裡的儲存庫名稱改成不存在的名字，或改用 Cloudflare 儀表板的 **Workers & Pages → Create → Import a repository** 直接匯入現有儲存庫（Build command `npm run build`、Deploy command `npm run deploy`，部署後在 Worker 的 Variables and Secrets 新增 `INGEST_TOKEN`）。
2. 表單的三個 Secret：
   - `AUTH_SECRET`：保留 `auto`（部署時自動產生私有金鑰）。
   - `INGEST_TOKEN`：爬蟲上傳票價用的密碼，填一段很長的隨機字串（`openssl rand -hex 32`），**自己記下來**，下一步要用。
   - `RESEND_API_KEY`：保留 `optional`（登入碼寄信設定見下方）。
3. **Build command** 保留 `npm run build`、**Deploy command** 保留 `npm run deploy`。關閉 **Enable Preview builds**。
4. 點擊 **Deploy**。build 成功後點右上角 **Visit** 開啟網站。

部署後要做的事（約 5 分鐘）：

- **擋掉爬蟲資料提交觸發的重複建置**：Worker → Settings → Builds → **Build watch paths** → Exclude paths 填入
  `public/fares.json,public/fares-live*.json,public/daemon*.json,public/live-request.json,public/*.lock`。
  否則爬蟲每次提交資料都會觸發一次建置。
- **登入碼寄信**（沒設定時，網站仍可使用，只是不能登入帳號）：
  - 用 [Cloudflare Email Sending](https://developers.cloudflare.com/email-service/)：把網域加入 Email Service（Workers Paid、網域需使用 Cloudflare DNS），再在 `wrangler.toml` 取消 `[[send_email]]` 的註解並把 `MAIL_FROM` 改成該網域的地址。
  - 或用 [Resend](https://resend.com)：驗證網域後，把 API key 設成 Worker 的 `RESEND_API_KEY` secret，並修改 `MAIL_FROM`。
- **讓爬蟲把票價寫進資料庫**：在你的 GitHub repository → Settings → Secrets and variables → Actions 新增
  `CF_INGEST_URL`（`https://<你的 Worker 網址>/api/ingest`）與 `CF_INGEST_TOKEN`（與上面 `INGEST_TOKEN` 相同），再手動執行 Actions 的 **Seed the Cloudflare fare database** 匯入既有票價。
- 爬蟲與常駐查價程式仍在 GitHub Actions 上執行，需要公開儲存庫（私有庫的免費時數很快會用完）。

詳細設計與限制見 [`docs/cloudflare.md`](docs/cloudflare.md)。

---

本 repo 為 Phase 1 骨架，涵蓋：

- Monorepo 專案結構 (backend FastAPI + frontend Next.js 14)
- Docker Compose 開發環境 (PostgreSQL + Redis + API + Web)
- Phase 1 核心資料模型：`ItineraryRequest` / `DateWindow` / `TicketStrategy`
- 2027 台灣連假與請假攻略靜態資料庫
- `/health` 與 `/holidays/2027` 基本 API

---

## 專案結構

```

├── backend/                     FastAPI + SQLAlchemy + Alembic
│   ├── app/
│   │   ├── main.py              入口
│   │   ├── config.py            設定
│   │   ├── core/database.py     DB session
│   │   ├── models/              SQLAlchemy ORM (Phase 1 資料模型)
│   │   ├── schemas/             Pydantic schema (API I/O)
│   │   ├── data/                2027 台灣連假靜態資料
│   │   ├── routers/             API endpoints
│   │   └── services/            後續 Phase 2+ 服務層
│   ├── alembic/                 DB migration
│   └── tests/                   pytest
├── frontend/                    Next.js 14 (App Router) + Tailwind
│   ├── app/
│   ├── components/
│   └── lib/
├── docs/
│   ├── spec.md                  完整產品規格書
│   └── roadmap.md               開發階段與里程碑
├── docker-compose.yml
└── .env.example
```

---

## 快速開始

```bash
cp .env.example .env
docker compose up --build
```

- API: http://localhost:8000 (`/docs` 可看 Swagger UI)
- Web: http://localhost:3000
- Postgres: `localhost:5432`，Redis: `localhost:6379`

本地開發 (不走 Docker)：

```bash
# Backend
cd backend
pip install -e .
uvicorn app.main:app --reload

# Frontend
cd frontend
npm install
npm run dev
```

---

## 開發進度 (對應 spec 中的 Phase)

| Phase | 內容 | 狀態 |
|-------|------|------|
| 1     | 專案初始化、Docker、資料模型、2027 連假資料庫 | ✅ |
| 2     | 彈性日期矩陣引擎、FlightOfferProvider 介面 + Stub | ✅ |
| 2.5   | Amadeus adapter + Skyscanner adapter (fallback chain) | ✅ |
| 2.6   | Redis-backed cross-request offer cache + per-IP rate limit | ✅ |
| 3     | Standard (含 multi-city)、Reverse、Open-jaw、Back-to-back 4-leg + MCT 檢查 + 多維度 scoring (真實飛行時長) | ✅ |
| 4     | SearchForm + ResultBoard + PlanCard + Timeline SVG | ✅ |
| 5     | Request-scoped cache、Alembic migration、GitHub Actions CI、Render + Vercel 設定 | ✅ |
| —     | Hidden-city planner | 刻意延後 (法規/道德疑慮) |

---

## Deployment

Two live targets are set up and ready to go:

### 1. GitHub Pages — a public, shareable URL for the static demo

The standalone demo (`public/index.html` — same algorithms,
same seed table, zero backend) deploys via `.github/workflows/pages.yml`.
The workflow is pushed and tried to run; it currently fails with
`Resource not accessible by integration` because the Claude GitHub App
installation on this repo does not have the Pages administration scope.

**One of these three enables the URL below:**

- **Make the repo public** — Settings → General → Change visibility → Make
  public, then Settings → Pages → Build and deployment → Source: GitHub
  Actions. Free, works with the current App permissions. The scaffold
  has no secrets; `.env.example` is a template.
- **Reconnect the Claude GitHub App with Pages scope** at
  https://claude.ai/connect-github, so the workflow's auto-enablement
  works even on a private repo.
- **Upgrade to GitHub Pro** so private-repo Pages is allowed, then enable
  Pages in Settings as above.

Once any of those is done, the next push (or a manual re-run from the
Actions tab) deploys the demo to:

**https://b8rrs4sydg-cmyk.github.io/TradingStrategy/**

### 2. Claude Artifact — a private, logged-in demo that works right now

The same page is published as an Artifact. Works immediately for the owner;
make it shareable through the Share menu inside claude.ai.

Live now: **https://claude.ai/artifact/RzaFsGWZg3phJHoUZYem2F**

### 3. Backend (Render) + Full frontend (Vercel)

For a real deployment with Amadeus/Skyscanner credentials and persistent
Postgres/Redis, follow `deploy/README.md` — the Render blueprint
(`deploy/render.yaml`) and Vercel config (`frontend/vercel.json`) are
prepared, you just need to point them at your accounts.

## Migrating to its own GitHub repo

這份 scaffold 目前放在 `` 子目錄裡，等您在 GitHub 開好 repo 之後，可以用其中一種方式搬過去：

**方法 A：簡單複製**

```bash
cp -r smart-flight-finder /tmp/
cd /tmp/smart-flight-finder
git init && git add -A && git commit -m "chore: initial Phase 1 scaffold"
git remote add origin git@github.com:<you>/smart-flight-finder.git
git push -u origin main
```

**方法 B：保留 commit 歷史 (git subtree)**

```bash
git subtree split --prefix=smart-flight-finder -b flight-split
# 然後把 flight-split 這條分支推到新 repo
```
