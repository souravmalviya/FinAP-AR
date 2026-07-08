# 🏃 Runbook — start everything yourself

Open **3 terminals in VS Code** (`Ctrl+Shift+` ` opens a terminal, click `+` for more).

## Terminal 0 — Valkey (the queue broker)

> Docker Desktop must be running first (Start menu → Docker Desktop → wait for "Engine running").

```powershell
cd C:\Users\Soura\OneDrive\Desktop\finErpAP
docker compose up -d
```

Runs in the background — this terminal is free again after it prints "Started".
(Stop it later with `docker compose stop` from the same folder.)

## Terminal 1 — Mini-ERP (system of record)

```powershell
cd C:\Users\Soura\OneDrive\Desktop\miniERP
npm run dev
```

→ UI + API at **http://localhost:4000**

## Terminal 2 — finErpAP pipeline (backend)

```powershell
cd C:\Users\Soura\OneDrive\Desktop\finErpAP\server
npm run dev
```

→ API at **http://localhost:5000** — watch this terminal: every pipeline step
logs here (`[EXTRACT] (AI) ...`, `[VERIFY] (RULE) ...`).

## Terminal 3 — Dashboard (frontend)

```powershell
cd C:\Users\Soura\OneDrive\Desktop\finErpAP\web
npm run dev
```

→ Dashboard at **http://localhost:3000**

## Start order matters (a little)

Valkey → then the pipeline (it fails fast if Valkey is down) → ERP and web in
any order. Easiest habit: **Docker first, then the three `npm run dev`s.**

## Demo an invoice end to end

```powershell
# in a 4th terminal (or reuse Terminal 0)
cd C:\Users\Soura\OneDrive\Desktop\finErpAP\server

# 1. generate a vendor invoice PDF -> lands in server/samples/
npm run sample:invoice -- --no ACR-2001 --po PO-2026-020 --amount 150000

# 2. in the ERP UI (:4000): make sure vendor "Acer" exists,
#    create PO-2026-020 for Acer, amount 150000
# 3. in the dashboard (:3000): drag samples/ACR-2001.pdf onto the upload zone
# 4. watch it move: QUEUED -> PENDING APPROVAL -> approve it -> Record Payment
```

Rule-engine variants to play with:

```powershell
npm run sample:invoice -- --no X-1 --po PO-X --amount 30000    # < 50k  -> auto-approved
npm run sample:invoice -- --no X-2 --po PO-Y --amount 999999   # mismatch vs PO -> NEEDS_REVIEW
```

## Stop everything

- Each `npm run dev` terminal: **Ctrl+C**
- Valkey: `cd C:\Users\Soura\OneDrive\Desktop\finErpAP` then `docker compose stop`

## If a port is stuck ("address already in use")

```powershell
# find & kill whatever holds e.g. port 3000
Get-NetTCPConnection -LocalPort 3000 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

## Ports map

| Port | What | Folder |
|---|---|---|
| 3000 | Dashboard (Next.js) | `finErpAP\web` |
| 5000 | Pipeline API + worker | `finErpAP\server` |
| 4000 | Mini-ERP UI + API | `miniERP` |
| 6379 | Valkey (Docker) | `finErpAP` (compose file) |
| 5432 | PostgreSQL (Windows service, always on) | — |

## Handy extras

```powershell
npx prisma studio     # visual DB browser — run inside miniERP or finErpAP\server
docker ps             # is Valkey running?
docker logs finerp-valkey --tail 20
```
