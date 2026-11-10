# Fish Bot 🎣

An advanced fishing RPG for Discord, built with Node.js, Discord.js v14, and PostgreSQL.

## Current features

- Fishing with weighted fish rarities and a 30-second cooldown
- Fish inventory and sell system
- Coins and daily rewards
- Fishing rod shop, purchases, and equipment upgrades
- XP, levels, angler profiles, and leaderboard
- Fish encyclopedia / collection tracker
- English command responses and configurable ! prefix

## Commands

| Command | Description |
| --- | --- |
| !help | Show the command guide |
| !fish | Catch a fish |
| !balance | Check your coins |
| !inventory | View unsold fish |
| !sell all | Sell all fish in your inventory |
| !sell <fish name> | Sell matching fish |
| !daily | Claim your daily coins |
| !shop | Browse fishing rods |
| !buy <rod id> | Purchase a fishing rod |
| !equip <rod id> | Equip an owned rod |
| !rod | View your active rod |
| !profile [@user] | View an angler profile |
| !leaderboard | View the XP leaderboard |
| !collection | View discovered fish |
| !ping | Check bot latency |

## Requirements

- Node.js 20 or newer
- A Discord application and bot token
- A PostgreSQL database

## Local setup

1. Clone this repository.
2. Install dependencies with npm install.
3. Copy .env.example to .env.
4. Set DISCORD_TOKEN and DATABASE_URL in .env.
5. In the Discord Developer Portal, enable Message Content Intent for the bot.
6. Invite the bot with permission to view and send messages and embed links.
7. Start the bot with npm start.

Database tables are created automatically on startup.

## Railway deployment

1. Create a Railway project and deploy this GitHub repository.
2. Add a PostgreSQL service to the Railway project.
3. Set DATABASE_URL for the bot service using the PostgreSQL service reference.
4. Add DISCORD_TOKEN and optionally BOT_PREFIX=!.
5. Deploy. The start command is npm start.

If your PostgreSQL provider requires SSL, set DATABASE_SSL=true.

## Security

- Never commit your Discord bot token or database credentials.
- Keep secrets in Railway Variables or a local .env file.
- Never share your bot token in Discord, screenshots, or source code.

## Roadmap

Planned systems include quests, fishing zones and biomes, weather, tournaments, pets, crafting, bait, treasures, events, achievements, and staff configuration commands.
