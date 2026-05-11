# pokerxyz

Multiplayer Texas hold'em with scriptable JS bots, an ELO ladder, and a
bot-vs-bot arena mode. Live at **<https://pokerxyz.io>**.

## Stack

| | |
|---|---|
| Frontend  | Next.js 16 · React 19 · Tailwind 4 |
| Backend   | Node 22 · Express · `ws` · Postgres |
| Storage   | AWS S3 + CloudFront (private bucket, presigned uploads) |
| Auth      | Google Identity Services + JWT cookie |
| Deploy    | Vercel (web) · Render (api) · Railway (db) |

## Run locally

```bash
git clone <this-repo> && cd gambling-web-ui
./scripts/setup-env.sh        # creates placeholder .env files
# edit client/.env.local + server/.env with real values

cd server && npm install && npm run migrate && npm run dev   # :3001
cd client && npm install && npm run dev                       # :3000
```

Open <http://localhost:3000/poker>.

## Env files

`./scripts/setup-env.sh` generates four placeholder files. All gitignored.

| File | Purpose |
|---|---|
| `client/.env.local`      | local frontend |
| `client/.env.production` | paste-into-Vercel ref |
| `server/.env`            | local backend (`npm start` / `npm run dev`) |
| `server/.env.production` | paste-into-Render ref (`npm run start:prod`) |

Flags: `--force` (overwrite), `--only=client`, `--only=server`.

## Scripts

```bash
# server
npm run dev          # nodemon
npm start            # node + .env
npm run start:prod   # node + .env.production
npm run migrate      # apply pending migrations
npm test             # node --test

# client
npm run dev
npm run build
npm start
```

## Project structure

```
client/    Next.js app (poker table, bot editor, lobby)
server/    Express + ws hub + Postgres
scripts/   setup-env.sh
STACK.md   compact architecture + AWS pipeline notes
CLAUDE.md  notes for AI assistants working in this repo
```

See [`STACK.md`](./STACK.md) for architecture, the AWS upload pipeline, and
gotchas.

## License

UNLICENSED — private project. Don't redistribute without permission.
