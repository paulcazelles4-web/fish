const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require("discord.js");
const { pool, ensurePlayer } = require("./db");
const { weightedFish, rarityColors, fish } = require("./data/fish");
const { rods } = require("./data/rods");

const FISH_COOLDOWN_MS = 30_000;
const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const THEME = 0x123B50;
const divider = "━━━━━━━━━━━━━━━━━━━━";
function progressBar(current, total, size = 12) {
  const ratio = total > 0 ? Math.max(0, Math.min(1, current / total)) : 0;
  const filled = Math.round(ratio * size);
  return "▰".repeat(filled) + "▱".repeat(size - filled);
}
function baseEmbed(title, description, banner) {
  const embed = new EmbedBuilder().setColor(THEME).setTitle(title);
  if (description) embed.setDescription(description);
  return embed;
}

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
    .setTitle((caught.emoji || "🐟") + "  FISH CAUGHT!")
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
  const totalValue = result.rows.reduce((sum, row) => sum + Number(row.value), 0);
  const embed = baseEmbed("YOUR CATCHES", "A clean look at your latest catches. Locked fish cannot be sold or listed.")
    .setAuthor({ name: message.author.username + "'s inventory", iconURL: message.author.displayAvatarURL() })
    .addFields(
      { name: "CATCHES SHOWN", value: String(result.rowCount) + " / 20", inline: true },
      { name: "DISPLAYED VALUE", value: coins(totalValue), inline: true }
    )
    .setDescription(lines.join("\n"))
    .setFooter({ text: "Use !market list <catchId> <price> or !trade add <tradeId> <catchId>" });
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
    const sold = await client.query(
      "UPDATE catches SET sold_at = NOW() WHERE " + condition +
      " AND locked_by_trade IS NULL AND market_listing_id IS NULL RETURNING value",
      params
    );
    const quantity = sold.rowCount;
    const amount = sold.rows.reduce((sum, row) => sum + Number(row.value), 0);
    if (!quantity) {
      await client.query("ROLLBACK");
      return message.reply("You don't have any matching fish available to sell.");
    }
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
  const embed = baseEmbed("🛠️  THE TACKLE SHOP", "Choose your next upgrade. Better rods increase your luck on every cast.")
    .addFields(
      { name: "YOUR WALLET", value: coins(player.coins), inline: true },
      { name: "RODS AVAILABLE", value: String(rods.length), inline: true },
      ...rods.map(rod => ({
        name: (ownedSet.has(rod.id) ? "✓ " : "＋ ") + rod.name + "  ·  " + rod.id,
        value: rod.description + "\nLuck **+" + rod.luck + "**  ·  " + (ownedSet.has(rod.id) ? "**Owned**" : "**" + coins(rod.price) + "**"),
        inline: false
      }))
    )
    .setFooter({ text: "Purchase with !buy <rod id>  •  Equip with !equip <rod id>" });
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
  const nextLevelXp = Number(player.level) * Number(player.level) * 100;
  const previousLevelXp = Math.max(0, (Number(player.level) - 1) ** 2 * 100);
  const levelProgress = Math.max(0, Number(player.xp) - previousLevelXp);
  const levelSpan = Math.max(1, nextLevelXp - previousLevelXp);
  const embed = baseEmbed("ANGLER PROFILE", "A snapshot of this angler\'s progress.")
    .setAuthor({ name: user.username, iconURL: user.displayAvatarURL() })
    .setThumbnail(user.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: "LEVEL", value: "**" + player.level + "**\n" + progressBar(levelProgress, levelSpan) + "\n" + levelProgress.toLocaleString("en-US") + " / " + levelSpan.toLocaleString("en-US") + " XP", inline: false },
      { name: "WALLET", value: coins(player.coins), inline: true },
      { name: "TOTAL XP", value: Number(player.xp).toLocaleString("en-US"), inline: true },
      { name: "FISH CAUGHT", value: String(caught.rows[0].total), inline: true },
      { name: "SPECIES", value: String(caught.rows[0].species), inline: true },
      { name: "IN INVENTORY", value: String(unsold.rows[0].count), inline: true }
    );
  return message.reply({ embeds: [embed] });
}

async function leaderboardCommand(message) {
  await playerFor(message);
  const result = await pool.query("SELECT username, xp, level FROM players ORDER BY xp DESC LIMIT 10");
  const lines = result.rows.map((row, index) =>
    "**" + (index + 1) + ".** " + row.username + " — Level " + row.level + " · " +
    Number(row.xp).toLocaleString("en-US") + " XP");
  const embed = baseEmbed("🏆  ANGLER RANKINGS", "The most experienced anglers in the waters.")
    .setDescription(lines.length ? lines.join("\n") : "No anglers yet.")
    .setFooter({ text: "Ranked by total XP • Keep fishing to climb the board" });
  return message.reply({ embeds: [embed] });
}

async function collectionCommand(message) {
  await playerFor(message);
  const result = await pool.query("SELECT DISTINCT fish_id FROM catches WHERE user_id = $1", [message.author.id]);
  const found = new Set(result.rows.map(row => row.fish_id));
  const lines = fish.map(item => (found.has(item.id) ? "✅" : "⬛") + " **" + item.name + "** — " + item.rarity);
  const embed = baseEmbed("📖  THE FISH FIELD GUIDE", "Every species has a story. Discover them all.")
    .addFields(
      { name: "DISCOVERY PROGRESS", value: "**" + found.size + " / " + fish.length + "** species\n" + progressBar(found.size, fish.length) },
      { name: "SPECIES INDEX", value: lines.join("\n") }
    )
    .setFooter({ text: "Select a species below to view its profile and stats" });
  return message.reply({ embeds: [embed], components: [fishGuideMenu()] });
}

const HELP_CATEGORIES = {
  getting_started: { label: "Getting started", emoji: "🎣", description: "Your first steps in the ocean.", commands: [["!fish", "Cast your line and catch a random fish."], ["!daily", "Claim your daily coin reward."], ["!profile [@user]", "View your angler profile."], ["!help", "Open this interactive command guide."]] },
  fishing: { label: "Fishing & collection", emoji: "🐟", description: "Catch, collect and discover rare species.", commands: [["!fish", "Catch a fish (30-second cooldown)."], ["!inventory", "View your latest catches and locked items."], ["!collection", "Open the fish field guide."], ["!rod", "Check your equipped fishing rod."]] },
  economy: { label: "Coins & shop", emoji: "🪙", description: "Earn coins and upgrade your equipment.", commands: [["!balance", "Check your wallet."], ["!daily", "Claim your daily reward."], ["!sell all", "Sell every eligible catch."], ["!sell <fish name>", "Sell matching eligible catches."], ["!shop", "Browse fishing rods."], ["!buy <rod id>", "Purchase a fishing rod."], ["!equip <rod id>", "Equip an owned rod."]] },
  progression: { label: "Progression", emoji: "🏆", description: "Track your level and compete with other anglers.", commands: [["!profile [@user]", "View an angler profile."], ["!leaderboard", "See the top anglers by XP."]] },
  marketplace: { label: "Marketplace", emoji: "🛒", description: "Buy and sell individual catches.", commands: [["!market", "Browse active listings."], ["!market <fish>", "Find listings for a fish."], ["!market list <catchId> <price>", "List one of your catches."], ["!market buy <listingId>", "Purchase a listing."], ["!market cancel <listingId>", "Cancel your listing."], ["!market prices <fish>", "View recent price statistics."], ["!market history", "View your market history."]] },
  trading: { label: "Player trading", emoji: "🤝", description: "Exchange catches and coins directly with another player.", commands: [["!trade @user", "Start a trade with a player."], ["!trade add <tradeId> <catchId>", "Add a catch to your offer."], ["!trade coins <tradeId> <amount>", "Add coins to your offer."], ["!trade view <tradeId>", "Review both sides of a trade."], ["!trade confirm <tradeId>", "Confirm your side of the trade."], ["!trade cancel <tradeId>", "Cancel an open trade."]] }
};
function helpEmbed(category = "getting_started") {
  const selected = HELP_CATEGORIES[category] || HELP_CATEGORIES.getting_started;
  const commands = selected.commands.map(([name, description]) => "**`" + name + "`**\n" + description).join("\n\n");
  return baseEmbed("🐠  FISH BOT  /  COMMAND CENTER", selected.description)
    .addFields({ name: selected.emoji + "  " + selected.label.toUpperCase(), value: commands })
    .setFooter({ text: "Choose a category from the menu below • Prefix: !" });
}
function helpMenu() {
  return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
    .setCustomId("fish_help_category")
    .setPlaceholder("Browse command categories")
    .addOptions(Object.entries(HELP_CATEGORIES).map(([value, item]) => ({ label: item.label, value, emoji: item.emoji, description: item.description }))));
}
function fishGuideMenu() {
  return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
    .setCustomId("fish_guide_select")
    .setPlaceholder("Choose a species to view its stats")
    .addOptions(fish.map(item => ({ label: item.name, value: item.id, description: item.rarity + " species", emoji: item.emoji || "🐟" }))));
}
function fishDetailEmbed(item, discovered = true) {
  return new EmbedBuilder().setColor(rarityColors[item.rarity]).setTitle((item.emoji || "🐟") + "  " + item.name.toUpperCase())
    .setDescription(discovered ? "**" + item.rarity + "** species\n" + item.description : "This species has not been discovered yet. Keep fishing!")
    .addFields(
      { name: "RARITY", value: item.rarity, inline: true },
      { name: "SELL VALUE", value: discovered ? item.minValue + "–" + item.maxValue + " coins" : "???", inline: true },
      { name: "XP REWARD", value: discovered ? String(item.xp) + " XP" : "???", inline: true }
    ).setFooter({ text: "Fish Field Guide  •  Discover all species" });
}

module.exports = {
  fishCommand, balanceCommand, inventoryCommand, sellCommand, dailyCommand,
  shopCommand, buyCommand, equipCommand, rodCommand, profileCommand,
  leaderboardCommand, collectionCommand, helpEmbed, helpMenu, fishGuideMenu, fishDetailEmbed
};
