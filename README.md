# WL BOOK

Discord bot: https://discord.com/oauth2/authorize?client_id=1556846631104806954&scope=bot%20applications.commands&permissions=52224
Discord whitelist registration bot for guilds. Members submit or update an EVM address through a private modal; administrators manage eligible roles, registration windows, and exports. Address format is validated, but wallet ownership is not verified.

## Commands

- Members: `/submit`, `/update`, `/check`, `/helpmember`.
- Administrators: `/whitelist role-add`, `role-remove`, `log`, `lock`, `deadline`, `lookup`, `stats`, `export`, `snapshot`, and `/helpadmin`.

Responses containing wallets are private. Submission logs go to an administrator-only channel. A Discord account can register one wallet per guild, and a wallet can belong to only one account in that guild. Exports and snapshots contain wallet data: restrict administrator access and protect downloaded CSV files.

## Run locally

Node.js 22+ and PostgreSQL are required. Copy `.env.example` to `.env` and supply your own credentials locally. Keep `.env` and database contents out of Git. Run `npm ci`, `npm run db:deploy`, `npm run register`, then `npm start`. Command registration targets only `DISCORD_GUILD_ID`. Invite the bot with `bot` and `applications.commands` scopes; give it View Channel and Send Messages in its private log channel. Do not grant the bot Administrator.

Configure at least one eligible role with `/whitelist role-add` and a private channel with `/whitelist log`. Optional deadline input: `YYYY-MM-DD HH:mm` in UTC, or `clear`. Discord displays the deadline in each viewer's timezone. New CSV exports use current role names and explicit UTC timestamps; existing snapshots are immutable.

Run `npm test` and `npm run lint` before deploying. Test database operations against an isolated database; never run test migrations against production.
