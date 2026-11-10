const { EmbedBuilder } = require("discord.js");
const { pool, ensurePlayer } = require("./db");
const { weightedFish, rarityColors, fish } = require("./data/fish");
const { rods } = require("./data/rods");

const FISH_COOLDOWN_MS = 30_000;
const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function coins(value) {
  return "🪙 " + Number(value).toLocaleString("en-US") + " coins";
}

function levelFromXp(xp) {
  return Math.floor(Math.sqrt(Number(xp) / 100)) + 1;
}

async function playerFor(message) {
  return ensurePlayer(message.author.id, message.author.username);
}

async function fishCommand(message) {
  const player = await playerFor(message);
  const last = player.last_fished_at ? new Date(player.last_fished_at).getTime() : 0;
  const remaining = FISH_COOLDOWN_MS - (Date.now() - last);
  if (remaining > 0) {
    return message.reply("🎣 Your line is resting! Try again in **" + Math.ceil(remaining / 1000) + "s**.");
  }

  const rod = rods.find(item => item.id === player.active_rod) || rods[0];
  const caught = weightedFish();
  const bonus = Math.floor(Math.random() * (rod.luck + 1));
  const value = Math.floor(caught.minValue + Math.random() * (caught.maxValue - caught.minValue + 1) + bonus);
  const xpGained = caught.xp + Math.floor(rod.luck / 5);
  const newXp = Number(player.xp) + xpGained;
  const newLevel = levelFromXp(newXp);

  await pool.query("UPDATE players SET last_fished_at = NOW(), xp = $2, level = $3 WHERE user_id = $1",
    [message.author.id, newXp, newLevel]);
  await pool.query(
    "INSERT INTO catches (user_id, fish_id, fish_name, rarity, value, xp) VALUES ($1, $2, $3, $4, $5, $6)",
    [message.author.id, caught.id, caught.name, caught.rarity, value, xpGained]
  );

  const embed = new EmbedBuilder()
    .setColor(rarityColors[caught.rarity])
    .setTitle("🎣 Fish caught!")
    .setDescription("You reeled in a **" + caught.name + "**!")
    .addFields(
      { name: "Rarity", value: caught.rarity, inline: true },
      { name: "Estimated value", value: coins(value), inline: true },
      { name: "XP earned", value: "+" + xpGained + " XP", inline: true },
      { name: "Fishing rod", value: rod.name, inline: true },
      { name: "Level", value: String(newLevel) + (newLevel > Number(player.level) ? " ⬆️ LEVEL UP!" : ""), inline: true }
    )
    .setFooter({ text: "Use !inventory to view your catches • !sell all to sell them" })
    .setTimestamp();
  return message.reply({ embeds: [embed] });
}

async function balanceCommand(message) {
  const player = await playerFor(message);
  return message.reply("💰 **" + message.author.username + "**, you have **" + coins(player.coins) + "**.");
}

async function inventoryCommand(message) {
  await playerFor(message);
  const result = await pool.query(
    "SELECT id, fish_name, rarity, value, locked_by_trade, market_listing_id FROM catches WHERE user_id = $1 AND sold_at IS NULL ORDER BY caught_at DESC LIMIT 20",
    [message.author.id]
  );
  if (!result.rowCount) return message.reply("🎒 Your inventory is empty. Use !fish to catch your first fish.");
  const lines = result.rows.map(row => {
    const state = row.locked_by_trade ? " · 🔒 Trade #" + row.locked_by_trade :
      row.market_listing_id ? " · 🏷️ Listing #" + row.market_listing_id : "";
    return "**#" + row.id + " " + row.fish_name + "** (" + row.rarity + ") — " + coins(row.value) + state;
  });
  const embed = new EmbedBuilder().setColor(0x3498db)
    .setTitle("🎒 " + message.author.username + "'s Inventory")
    .setDescription(lines.join("\n"))
    .setFooter({ text: "Use catch IDs with !market list or !trade add • Showing newest 20 catches" });
  return message.reply({ embeds: [embed] });
}

async function sellCommand(message, args) {
  await playerFor(message);
  const mode = args.join(" ").toLowerCase();
  if (!mode) return message.reply("Usage: !sell all or !sell <fish name>");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const params = [message.author.id];
    let condition = "user_id = $1 AND sold_at IS NULL";
    if (mode !== "all") {
      params.push("%" + mode + "%");
      condition += " AND LOWER(fish_name) LIKE $2";
    }
    const totals = await client.query(
      "SELECT COUNT(*)::int AS quantity, COALESCE(SUM(value), 0)::bigint AS amount FROM catches WHERE " + condition + " AND locked_by_trade IS NULL AND market_listing_id IS NULL",
      params
    );
    const quantity = totals.rows[0].quantity;
    const amount = totals.rows[0].amount;
    if (!quantity) {
      await client.query("ROLLBACK");
      return message.reply("You don't have any matching fish to sell.");
    }
    await client.query("UPDATE catches SET sold_at = NOW() WHERE " + condition + " AND locked_by_trade IS NULL AND market_listing_id IS NULL", params);
    await client.query("UPDATE players SET coins = coins + $2 WHERE user_id = $1", [message.author.id, amount]);
    await client.query("COMMIT");
    return message.reply("💰 Sold **" + quantity + "** fish for **" + coins(amount) + "**!");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function dailyCommand(message) {
  const player = await playerFor(message);
  const last = player.last_daily_at ? new Date(player.last_daily_at).getTime() : 0;
  const remaining = DAILY_COOLDOWN_MS - (Date.now() - last);
  if (remaining > 0) {
    const hours = Math.floor(remaining / 3600000);
    const minutes = Math.ceil((remaining % 3600000) / 60000);
    return message.reply("⏰ Your next daily reward is available in **" + hours + "h " + minutes + "m**.");
  }
  const reward = 250 + Math.min(Number(player.level) * 10, 500);
  await pool.query("UPDATE players SET coins = coins + $2, last_daily_at = NOW() WHERE user_id = $1",
    [message.author.id, reward]);
  return message.reply("🎁 Daily reward claimed! You received **" + coins(reward) + "**.");
}

async function shopCommand(message) {
  const player = await playerFor(message);
  const owned = await pool.query("SELECT rod_id FROM owned_rods WHERE user_id = $1", [message.author.id]);
  const ownedSet = new Set(owned.rows.map(row => row.rod_id));
  const lines = rods.map(rod => {
    const status = ownedSet.has(rod.id) ? "✅ Owned" : "**" + coins(rod.price) + "**";
    return "**" + rod.name + "** (" + rod.id + ") — Luck +" + rod.luck + " — " + status + "\n" + rod.description;
  });
  const embed = new EmbedBuilder().setColor(0x2ecc71).setTitle("🛒 Fishing Rod Shop")
    .setDescription(lines.join("\n\n"))
    .setFooter({ text: "Your balance: " + Number(player.coins).toLocaleString("en-US") + " coins • Use !buy <rod id>" });
  return message.reply({ embeds: [embed] });
}

async function buyCommand(message, args) {
  await playerFor(message);
  const rod = rods.find(item => item.id === (args[0] || "").toLowerCase());
  if (!rod) return message.reply("Unknown rod. Use !shop to see available rods.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const owned = await client.query("SELECT 1 FROM owned_rods WHERE user_id = $1 AND rod_id = $2",
      [message.author.id, rod.id]);
    if (owned.rowCount) {
      await client.query("ROLLBACK");
      return message.reply("You already own this fishing rod.");
    }
    const debit = await client.query(
      "UPDATE players SET coins = coins - $2 WHERE user_id = $1 AND coins >= $2 RETURNING coins",
      [message.author.id, rod.price]);
    if (!debit.rowCount) {
      await client.query("ROLLBACK");
      return message.reply("You need " + coins(rod.price) + " to buy this rod.");
    }
    await client.query("INSERT INTO owned_rods (user_id, rod_id) VALUES ($1, $2)", [message.author.id, rod.id]);
    await client.query("COMMIT");
    return message.reply("🎣 You purchased the **" + rod.name + "**! Equip it with !equip " + rod.id + ".");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function equipCommand(message, args) {
  await playerFor(message);
  const rod = rods.find(item => item.id === (args[0] || "").toLowerCase());
  if (!rod) return message.reply("Unknown rod. Use !shop to see rod IDs.");
  const owned = await pool.query("SELECT 1 FROM owned_rods WHERE user_id = $1 AND rod_id = $2",
    [message.author.id, rod.id]);
  if (!owned.rowCount) return message.reply("You don't own that rod yet. Use !shop.");
  await pool.query("UPDATE players SET active_rod = $2 WHERE user_id = $1", [message.author.id, rod.id]);
  return message.reply("✅ Equipped **" + rod.name + "**.");
}

async function rodCommand(message) {
  const player = await playerFor(message);
  const rod = rods.find(item => item.id === player.active_rod) || rods[0];
  return message.reply("🎣 Your active rod is **" + rod.name + "** (Luck +" + rod.luck + ").");
}

async function profileCommand(message, target) {
  const user = target || message.author;
  const player = await ensurePlayer(user.id, user.username);
  const caught = await pool.query(
    "SELECT COUNT(*)::int AS total, COUNT(DISTINCT fish_id)::int AS species FROM catches WHERE user_id = $1",
    [user.id]);
  const unsold = await pool.query(
    "SELECT COUNT(*)::int AS count FROM catches WHERE user_id = $1 AND sold_at IS NULL",
    [user.id]);
  const embed = new EmbedBuilder().setColor(0x1abc9c)
    .setAuthor({ name: user.username + "'s Angler Profile", iconURL: user.displayAvatarURL() })
    .addFields(
      { name: "Level", value: String(player.level), inline: true },
      { name: "XP", value: Number(player.xp).toLocaleString("en-US"), inline: true },
      { name: "Coins", value: Number(player.coins).toLocaleString("en-US"), inline: true },
      { name: "Fish caught", value: String(caught.rows[0].total), inline: true },
      { name: "Species found", value: String(caught.rows[0].species), inline: true },
      { name: "Fish in inventory", value: String(unsold.rows[0].count), inline: true }
    );
  return message.reply({ embeds: [embed] });
}

async function leaderboardCommand(message) {
  await playerFor(message);
  const result = await pool.query("SELECT username, xp, level FROM players ORDER BY xp DESC LIMIT 10");
  const lines = result.rows.map((row, index) =>
    "**" + (index + 1) + ".** " + row.username + " — Level " + row.level + " · " +
    Number(row.xp).toLocaleString("en-US") + " XP");
  const embed = new EmbedBuilder().setColor(0xf1c40f).setTitle("🏆 Angler Leaderboard")
    .setDescription(lines.length ? lines.join("\n") : "No anglers yet.");
  return message.reply({ embeds: [embed] });
}

async function collectionCommand(message) {
  await playerFor(message);
  const result = await pool.query("SELECT DISTINCT fish_id FROM catches WHERE user_id = $1", [message.author.id]);
  const found = new Set(result.rows.map(row => row.fish_id));
  const lines = fish.map(item => (found.has(item.id) ? "✅" : "⬛") + " **" + item.name + "** — " + item.rarity);
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle("📖 Fish Encyclopedia")
    .setDescription(lines.join("\n"))
    .setFooter({ text: found.size + "/" + fish.length + " species discovered" });
  return message.reply({ embeds: [embed] });
}

function helpEmbed() {
  return new EmbedBuilder().setColor(0x3498db).setTitle("🎣 Fish Bot — Command Guide")
    .setDescription("Cast your line, discover rare fish, upgrade your gear, and become a legendary angler.")
    .addFields(
      { name: "Fishing", value: "**!fish** — Catch a fish\n**!inventory** — View your unsold catches\n**!collection** — View discovered species\n**!rod** — View your equipped rod" },
      { name: "Economy", value: "**!balance** — Check your coins\n**!daily** — Claim your daily reward\n**!sell all** — Sell all catches\n**!shop** — Browse fishing rods\n**!buy <rod id>** — Buy a rod\n**!equip <rod id>** — Equip a rod" },
      { name: "Progress", value: "**!profile [@user]** — View an angler profile\n**!leaderboard** — View top anglers\n**!collection** — Track discovered species" },
      { name: "Trading & Marketplace", value: "**!market [fish]** — Browse player listings\n**!market list <catchId> <price>** — List a fish\n**!market buy <listingId>** — Buy a fish\n**!market cancel <listingId>** — Withdraw a listing\n**!market prices <fish>** — View market statistics\n**!market history** — View your sales and purchases\n**!trade @user** — Start a direct trade\n**!trade add <tradeId> <catchId>** — Offer a fish\n**!trade coins <tradeId> <amount>** — Offer coins\n**!trade view <tradeId>** — Review a trade\n**!trade confirm <tradeId>** — Confirm a trade\n**!trade cancel <tradeId>** — Cancel a trade" }
    ).setFooter({ text: "Trades use dual confirmation. Listed and offered fish are locked until sold, cancelled, or expired." });
}

module.exports = {
  fishCommand, balanceCommand, inventoryCommand, sellCommand, dailyCommand,
  shopCommand, buyCommand, equipCommand, rodCommand, profileCommand,
  leaderboardCommand, collectionCommand, helpEmbed
};
