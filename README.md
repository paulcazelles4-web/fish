# Fish Bot 🎣

An advanced fishing RPG for Discord, built with Node.js 20+, Discord.js v14, and Neon PostgreSQL.

## Current systems

- Weighted fishing with seven fish rarities and a cooldown
- Individual fish inventory with unique catch IDs
- Coin wallet, daily rewards, and fish selling
- Fishing rod shop, purchases, and equipment upgrades
- XP, levels, angler profiles, and leaderboard
- Fish encyclopedia / collection tracker
- Player-to-player fish and coin trading
- Public fish marketplace with fixed-price listings
- Configurable marketplace tax, listing expiry, and transaction records
- 30-day average / minimum / maximum sale-price statistics
- Transactional settlement, fish locks, dual trade confirmation, and expiry cleanup

## Commands

| Command | Description |
| --- | --- |
| !help | Show the command guide |
| !fish | Catch a fish |
| !balance | Check your coins |
| !inventory | View catches and their IDs |
| !sell all | Sell all available fish |
| !sell <fish name> | Sell matching available fish |
| !daily | Claim daily coins |
| !shop | Browse fishing rods |
| !buy <rod id> | Purchase a rod |
| !equip <rod id> | Equip an owned rod |
| !rod | View your active rod |
| !profile [@user] | View an angler profile |
| !leaderboard | View top anglers |
| !collection | View discovered fish |
| !market [fish] | Browse marketplace listings |
| !market list <catchId> <price> | List one catch for sale |
| !market buy <listingId> | Buy a listed catch |
| !market cancel <listingId> | Withdraw your listing |
| !market prices <fish name> | View 30-day price statistics |
| !market history | View your latest market transactions |
| !trade @user | Start a direct trade |
| !trade add <tradeId> <catchId> | Add one of your catches to a trade |
| !trade coins <tradeId> <amount> | Set your coin offer |
| !trade view <tradeId> | Review both sides of a trade |
| !trade confirm <tradeId> | Confirm the current trade |
| !trade cancel <tradeId> | Cancel and unlock your offered catches |
| !ping | Check bot latency |

## Requirements

- Node.js 20 or newer
- A Discord application and bot token
- A Neon PostgreSQL project

## Local setup

1. Clone this repository.
2. Install dependencies with `npm install`.
3. Copy `.env.example` to `.env`.
4. Set `DISCORD_TOKEN` and `NEON_DATABASE_URL` in `.env`.
5. In Neon, copy the **pooled** connection string (hostname commonly contains `-pooler`) and use it as `NEON_DATABASE_URL`. Keep the `sslmode=require` option.
6. In the Discord Developer Portal, enable **Message Content Intent**.
7. Invite the bot with permission to view and send messages and embed links.
8. Start with `npm start`.

The bot creates and upgrades its required tables at startup. Existing player and catch records are preserved by additive schema migrations.

## Railway deployment with Neon

1. Create a Railway project and deploy this GitHub repository.
2. Create a Neon project and database.
3. Copy the Neon **pooled** connection string.
4. In Railway Variables, set:
   - `DISCORD_TOKEN` — your Discord bot token
   - `NEON_DATABASE_URL` — your Neon pooled connection string
   - `DATABASE_SSL=true`
   - `BOT_PREFIX=!`
   - `MARKET_TAX_PERCENT=5` (optional; allowed range is 0–25)
5. Deploy with the start command `npm start`.

`DATABASE_URL` is accepted as a fallback variable name. Do not commit real credentials to GitHub.

## Marketplace rules

- Every caught fish has a unique catch ID, shown by `!inventory`.
- A catch can only be in one place at a time: available inventory, one direct trade, or one marketplace listing.
- Direct trades expire after 15 minutes. Both participants must review and confirm the same offer.
- Editing a trade offer resets both confirmations.
- Marketplace listings expire after 7 days.
- Marketplace purchases and direct trades settle inside PostgreSQL transactions.
- The marketplace fee defaults to 5%, can be configured with `MARKET_TAX_PERCENT`, and is capped at 25%.
- `!market prices` uses completed Fish Bot sales only; it is not an external real-money price feed.

## Security

- Never commit your Discord token or Neon connection string.
- Store secrets in Railway Variables or a local `.env` file.
- Use Neon pooled connection strings for the deployed bot.
- Fish and coin transfers are game-only virtual items and currency.

## Roadmap

Potential next systems: buy orders, timed auctions, price alerts, server-wide trading events, player shops, trade reputation, and moderator marketplace controls.
