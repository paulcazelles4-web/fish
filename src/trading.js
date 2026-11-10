const { EmbedBuilder } = require("discord.js");
const { pool, ensurePlayer } = require("./db");
const { fish } = require("./data/fish");

const configuredTax = Number(process.env.MARKET_TAX_PERCENT ?? 5);
const TAX_RATE = (Number.isFinite(configuredTax) ? Math.min(25, Math.max(0, configuredTax)) : 5) / 100;
const TRADE_TTL_MINUTES = 15;
const MAX_LISTING_PRICE = 1_000_000_000;
const money = value => Number(value).toLocaleString("en-US") + " coins";
const MARKET_BANNER = "https://images.unsplash.com/photo-1500375592092-40eb2168fd21?auto=format&fit=crop&w=1200&q=85";
const MARKET_COLOR = 0x123B50;
const clean = value => String(value || "").trim().toLowerCase();

async function runTx(callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function marketBrowse(message, query) {
  await ensurePlayer(message.author.id, message.author.username);
  const params = [];
  let where = "l.status = 'active' AND l.expires_at > NOW()";
  if (query) {
    params.push("%" + query + "%");
    where += " AND LOWER(l.fish_name) LIKE $1";
  }
  const result = await pool.query(
    "SELECT l.id, l.fish_name, l.rarity, l.price, p.username AS seller_name " +
    "FROM market_listings l JOIN players p ON p.user_id = l.seller_id WHERE " + where +
    " ORDER BY l.price ASC LIMIT 15", params);
  if (!result.rowCount) return message.reply("🏪 No active listings found. Try another search or list a fish with !market list <catchId> <price>.");
  const embed = new EmbedBuilder().setColor(MARKET_COLOR)
    .setTitle("THE FISH MARKET")
    .setDescription("Discover catches listed by other anglers. Compare rarity, price and seller before buying.")
    .setImage(MARKET_BANNER)
    .setThumbnail((fish.find(item => item.name.toLowerCase() === result.rows[0].fish_name.toLowerCase()) || {}).image || MARKET_BANNER)
    .addFields(
      { name: "LIVE LISTINGS", value: String(result.rowCount), inline: true },
      { name: "SORTED BY", value: "Lowest price", inline: true },
      { name: "AVAILABLE ACTION", value: "!market buy <listingId>", inline: true },
      ...result.rows.map(row => ({ name: "#" + row.id + "  ·  " + row.fish_name, value: "**" + row.rarity + "**  ·  " + money(row.price) + "\nSeller: " + row.seller_name, inline: true }))
    )
    .setFooter({ text: "15 listings shown  •  List a catch with !market list <catchId> <price>" });
  return message.reply({ embeds: [embed] });
}

async function marketList(message, catchId, rawPrice) {
  const price = Number(rawPrice);
  if (!Number.isSafeInteger(price) || price < 1 || price > MAX_LISTING_PRICE) {
    return message.reply("Enter a whole-number price between 1 and " + MAX_LISTING_PRICE.toLocaleString("en-US") + " coins.");
  }
  const listing = await runTx(async client => {
    const caught = await client.query(
      "SELECT id, fish_name, rarity FROM catches WHERE id = $1 AND user_id = $2 AND sold_at IS NULL AND locked_by_trade IS NULL AND market_listing_id IS NULL FOR UPDATE",
      [catchId, message.author.id]);
    if (!caught.rowCount) throw new Error("That catch is unavailable, already listed, or locked in a trade.");
    const item = caught.rows[0];
    const created = await client.query(
      "INSERT INTO market_listings (seller_id, catch_id, fish_name, rarity, price) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [message.author.id, item.id, item.fish_name, item.rarity, price]);
    await client.query("UPDATE catches SET market_listing_id = $2 WHERE id = $1", [item.id, created.rows[0].id]);
    return { id: created.rows[0].id, name: item.fish_name, rarity: item.rarity };
  });
  return message.reply("🏷️ Listed **" + listing.name + "** (" + listing.rarity + ") as listing **#" +
    listing.id + "** for **" + money(price) + "**. Withdraw with !market cancel " + listing.id + ".");
}

async function marketBuy(message, listingId) {
  await ensurePlayer(message.author.id, message.author.username);
  const result = await runTx(async client => {
    const found = await client.query(
      "SELECT * FROM market_listings WHERE id = $1 AND status = 'active' AND expires_at > NOW() FOR UPDATE",
      [listingId]);
    if (!found.rowCount) throw new Error("That listing is no longer available.");
    const listing = found.rows[0];
    if (listing.seller_id === message.author.id) throw new Error("You cannot buy your own listing.");
    const fishRow = await client.query(
      "SELECT id FROM catches WHERE id = $1 AND user_id = $2 AND market_listing_id = $3 AND sold_at IS NULL FOR UPDATE",
      [listing.catch_id, listing.seller_id, listing.id]);
    if (!fishRow.rowCount) throw new Error("The listed fish is no longer available.");
    const debit = await client.query(
      "UPDATE players SET coins = coins - $2 WHERE user_id = $1 AND coins >= $2 RETURNING user_id",
      [message.author.id, listing.price]);
    if (!debit.rowCount) throw new Error("You do not have enough coins.");
    const tax = Math.floor(Number(listing.price) * TAX_RATE);
    const sellerGets = Number(listing.price) - tax;
    await client.query("UPDATE players SET coins = coins + $2 WHERE user_id = $1", [listing.seller_id, sellerGets]);
    await client.query("UPDATE catches SET user_id = $2, market_listing_id = NULL WHERE id = $1", [listing.catch_id, message.author.id]);
    await client.query("UPDATE market_listings SET status = 'sold', buyer_id = $2, sold_at = NOW() WHERE id = $1", [listing.id, message.author.id]);
    await client.query(
      "INSERT INTO market_sales (listing_id, fish_name, rarity, seller_id, buyer_id, sale_price, tax_amount) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [listing.id, listing.fish_name, listing.rarity, listing.seller_id, message.author.id, listing.price, tax]);
    return { name: listing.fish_name, price: Number(listing.price), tax };
  });
  return message.reply("✅ Purchased **" + result.name + "** for **" + money(result.price) +
    "**. Marketplace fee: " + money(result.tax) + ".");
}

async function marketCancel(message, listingId) {
  const name = await runTx(async client => {
    const found = await client.query(
      "SELECT * FROM market_listings WHERE id = $1 AND seller_id = $2 AND status = 'active' FOR UPDATE",
      [listingId, message.author.id]);
    if (!found.rowCount) throw new Error("You don't own an active listing with that ID.");
    const listing = found.rows[0];
    await client.query("UPDATE market_listings SET status = 'cancelled' WHERE id = $1", [listing.id]);
    await client.query("UPDATE catches SET market_listing_id = NULL WHERE id = $1 AND market_listing_id = $2",
      [listing.catch_id, listing.id]);
    return listing.fish_name;
  });
  return message.reply("↩️ Your listing for **" + name + "** has been withdrawn. The fish is back in your inventory.");
}

async function marketHistory(message) {
  await ensurePlayer(message.author.id, message.author.username);
  const result = await pool.query(
    "SELECT fish_name, rarity, sale_price, tax_amount, sold_at FROM market_sales WHERE seller_id = $1 OR buyer_id = $1 ORDER BY sold_at DESC LIMIT 10",
    [message.author.id]);
  if (!result.rowCount) return message.reply("📜 You don't have any marketplace transactions yet.");
  const lines = result.rows.map(row => "**" + row.fish_name + "** (" + row.rarity + ") — " +
    money(row.sale_price) + " · fee " + money(row.tax_amount) + " · " + new Date(row.sold_at).toLocaleDateString("en-US"));
  return message.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("📜 Your Market History").setDescription(lines.join("\n"))] });
}

async function marketPrices(message, query) {
  if (!query) return message.reply("Usage: !market prices <fish name>");
  const result = await pool.query(
    "SELECT fish_name, COUNT(*)::int AS sales, ROUND(AVG(sale_price))::bigint AS average, MIN(sale_price) AS low, MAX(sale_price) AS high " +
    "FROM market_sales WHERE LOWER(fish_name) LIKE $1 AND sold_at > NOW() - INTERVAL '30 days' GROUP BY fish_name ORDER BY sales DESC LIMIT 5",
    ["%" + query + "%"]);
  if (!result.rowCount) return message.reply("No completed sales for that fish in the last 30 days.");
  const embed = new EmbedBuilder().setColor(0x3498db).setTitle("📊 Market Price Intelligence")
    .setDescription(result.rows.map(row => "**" + row.fish_name + "** · " + row.sales + " sales\nAverage: " +
      money(row.average) + " · Low: " + money(row.low) + " · High: " + money(row.high)).join("\n\n"))
    .setFooter({ text: "Completed marketplace sales from the last 30 days." });
  return message.reply({ embeds: [embed] });
}

async function tradeStart(message, target) {
  await ensurePlayer(message.author.id, message.author.username);
  if (!target || target.bot || target.id === message.author.id) return message.reply("Mention another human player: !trade @user");
  await ensurePlayer(target.id, target.username);
  const created = await pool.query(
    "INSERT INTO trades (proposer_id, recipient_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '15 minutes') RETURNING id",
    [message.author.id, target.id]);
  const id = created.rows[0].id;
  return message.reply("🤝 Trade **#" + id + "** created with " + target.username +
    ". Both players can add fish and coins: !trade add " + id + " <catchId>, !trade coins " + id +
    " <amount>. Both must confirm with !trade confirm " + id + " within 15 minutes.");
}

async function tradeAddFish(message, tradeId, catchId) {
  const item = await runTx(async client => {
    const t = await client.query("SELECT * FROM trades WHERE id = $1 AND status = 'open' AND expires_at > NOW() FOR UPDATE", [tradeId]);
    if (!t.rowCount) throw new Error("That trade is not open or has expired.");
    const trade = t.rows[0];
    if (![trade.proposer_id, trade.recipient_id].includes(message.author.id)) throw new Error("You are not part of this trade.");
    const caught = await client.query(
      "SELECT id, fish_name, rarity FROM catches WHERE id = $1 AND user_id = $2 AND sold_at IS NULL AND locked_by_trade IS NULL AND market_listing_id IS NULL FOR UPDATE",
      [catchId, message.author.id]);
    if (!caught.rowCount) throw new Error("That fish is unavailable, listed, or already locked in another trade.");
    await client.query("UPDATE catches SET locked_by_trade = $2 WHERE id = $1", [catchId, tradeId]);
    await client.query("INSERT INTO trade_items (trade_id, owner_id, catch_id, fish_name, rarity) VALUES ($1,$2,$3,$4,$5)",
      [tradeId, message.author.id, catchId, caught.rows[0].fish_name, caught.rows[0].rarity]);
    await client.query("UPDATE trades SET proposer_confirmed = FALSE, recipient_confirmed = FALSE WHERE id = $1", [tradeId]);
    return caught.rows[0];
  });
  return message.reply("➕ Added **" + item.fish_name + "** (" + item.rarity + ") to trade #" + tradeId + ". Confirmations reset.");
}

async function tradeCoins(message, tradeId, amountRaw) {
  const amount = Number(amountRaw);
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > 1_000_000_000) {
    return message.reply("Enter a whole-number coin amount between 0 and 1,000,000,000.");
  }
  await runTx(async client => {
    const found = await client.query("SELECT * FROM trades WHERE id = $1 AND status = 'open' AND expires_at > NOW() FOR UPDATE", [tradeId]);
    if (!found.rowCount) throw new Error("That trade is not open or has expired.");
    const t = found.rows[0];
    if (message.author.id === t.proposer_id) {
      await client.query("UPDATE trades SET proposer_coins = $2, proposer_confirmed = FALSE, recipient_confirmed = FALSE WHERE id = $1", [tradeId, amount]);
    } else if (message.author.id === t.recipient_id) {
      await client.query("UPDATE trades SET recipient_coins = $2, proposer_confirmed = FALSE, recipient_confirmed = FALSE WHERE id = $1", [tradeId, amount]);
    } else throw new Error("You are not part of this trade.");
  });
  return message.reply("🪙 Your coin offer for trade #" + tradeId + " is now **" + money(amount) + "**. Confirmations reset.");
}

async function tradeShow(message, tradeId) {
  const result = await pool.query(
    "SELECT t.*, p.username AS proposer_name, r.username AS recipient_name FROM trades t " +
    "JOIN players p ON p.user_id = t.proposer_id JOIN players r ON r.user_id = t.recipient_id WHERE t.id = $1",
    [tradeId]);
  if (!result.rowCount) return message.reply("Trade not found.");
  const t = result.rows[0];
  if (![t.proposer_id, t.recipient_id].includes(message.author.id)) return message.reply("You are not part of that trade.");
  const items = await pool.query("SELECT owner_id, fish_name, rarity FROM trade_items WHERE trade_id = $1 ORDER BY id", [tradeId]);
  const left = items.rows.filter(x => x.owner_id === t.proposer_id);
  const right = items.rows.filter(x => x.owner_id === t.recipient_id);
  const lines = [
    "**" + t.proposer_name + " gives:**",
    ...(left.length ? left.map(x => "• " + x.fish_name + " (" + x.rarity + ")") : ["• No fish"]),
    "• " + money(t.proposer_coins), "",
    "**" + t.recipient_name + " gives:**",
    ...(right.length ? right.map(x => "• " + x.fish_name + " (" + x.rarity + ")") : ["• No fish"]),
    "• " + money(t.recipient_coins), "",
    "Confirmations: " + (t.proposer_confirmed ? "✅" : "⌛") + " " + t.proposer_name + " · " +
      (t.recipient_confirmed ? "✅" : "⌛") + " " + t.recipient_name,
    "Status: **" + t.status + "**"
  ];
  return message.reply({ embeds: [new EmbedBuilder().setColor(0x9b59b6).setTitle("🤝 Trade #" + tradeId).setDescription(lines.join("\n"))] });
}

async function tradeConfirm(message, tradeId) {
  const result = await runTx(async client => {
    const found = await client.query("SELECT * FROM trades WHERE id = $1 AND status = 'open' AND expires_at > NOW() FOR UPDATE", [tradeId]);
    if (!found.rowCount) throw new Error("That trade is not open or has expired.");
    const t = found.rows[0];
    if (message.author.id !== t.proposer_id && message.author.id !== t.recipient_id) throw new Error("You are not part of this trade.");
    const column = message.author.id === t.proposer_id ? "proposer_confirmed" : "recipient_confirmed";
    await client.query("UPDATE trades SET " + column + " = TRUE WHERE id = $1", [tradeId]);
    const state = await client.query("SELECT * FROM trades WHERE id = $1", [tradeId]);
    const current = state.rows[0];
    if (!current.proposer_confirmed || !current.recipient_confirmed) return { complete: false };
    const balances = await client.query(
      "SELECT user_id, coins FROM players WHERE user_id = ANY($1::text[]) ORDER BY user_id FOR UPDATE",
      [[t.proposer_id, t.recipient_id]]);
    const byId = new Map(balances.rows.map(row => [row.user_id, Number(row.coins)]));
    if (byId.get(t.proposer_id) < Number(t.proposer_coins) || byId.get(t.recipient_id) < Number(t.recipient_coins)) {
      throw new Error("A player no longer has enough coins for this offer. Update the coin offer or earn more coins, then confirm again.");
    }
    const items = await client.query("SELECT catch_id, owner_id FROM trade_items WHERE trade_id = $1 FOR UPDATE", [tradeId]);
    for (const item of items.rows) {
      const recipient = item.owner_id === t.proposer_id ? t.recipient_id : t.proposer_id;
      const moved = await client.query(
        "UPDATE catches SET user_id = $2, locked_by_trade = NULL WHERE id = $1 AND user_id = $3 AND locked_by_trade = $4 AND sold_at IS NULL",
        [item.catch_id, recipient, item.owner_id, tradeId]);
      if (!moved.rowCount) throw new Error("A trade item could not be transferred. No trade was completed.");
    }
    await client.query("UPDATE players SET coins = coins - $2 + $3 WHERE user_id = $1",
      [t.proposer_id, t.proposer_coins, t.recipient_coins]);
    await client.query("UPDATE players SET coins = coins - $2 + $3 WHERE user_id = $1",
      [t.recipient_id, t.recipient_coins, t.proposer_coins]);
    await client.query("UPDATE trades SET status = 'completed', closed_at = NOW() WHERE id = $1", [tradeId]);
    return { complete: true };
  });
  if (result.complete) return message.reply("🎉 Trade #" + tradeId + " completed! All fish and coins were transferred.");
  return message.reply("✅ Your confirmation was recorded. The trade completes only after both players confirm. Review it with !trade view " + tradeId + ".");
}

async function tradeCancel(message, tradeId) {
  await runTx(async client => {
    const found = await client.query("SELECT * FROM trades WHERE id = $1 AND status = 'open' FOR UPDATE", [tradeId]);
    if (!found.rowCount) throw new Error("That trade is not open.");
    const t = found.rows[0];
    if (![t.proposer_id, t.recipient_id].includes(message.author.id)) throw new Error("You are not part of this trade.");
    await client.query("UPDATE trades SET status = 'cancelled', closed_at = NOW() WHERE id = $1", [tradeId]);
    await client.query("UPDATE catches SET locked_by_trade = NULL WHERE locked_by_trade = $1", [tradeId]);
  });
  return message.reply("Trade #" + tradeId + " cancelled. Your fish have been unlocked.");
}

async function tradeCommand(message, args) {
  const sub = clean(args[0]);
  if (!sub || message.mentions.users.first()) {
    const target = message.mentions.users.first();
    if (!target) return message.reply("Mention another player: !trade @user");
    return tradeStart(message, target);
  }
  if (sub === "add") return tradeAddFish(message, args[1], args[2]);
  if (sub === "coins") return tradeCoins(message, args[1], args[2]);
  if (sub === "confirm") return tradeConfirm(message, args[1]);
  if (sub === "cancel") return tradeCancel(message, args[1]);
  if (sub === "view") return tradeShow(message, args[1]);
  return message.reply("**Trade commands**\n!trade @user — Start a trade\n!trade add <tradeId> <catchId> — Add a fish\n!trade coins <tradeId> <amount> — Set your coin offer\n!trade view <tradeId> — Review both offers\n!trade confirm <tradeId> — Confirm the exact trade\n!trade cancel <tradeId> — Cancel and unlock your fish");
}

async function marketCommand(message, args) {
  const sub = clean(args[0]);
  if (sub === "list") return marketList(message, args[1], args[2]);
  if (sub === "buy") return marketBuy(message, args[1]);
  if (sub === "cancel") return marketCancel(message, args[1]);
  if (sub === "history") return marketHistory(message);
  if (sub === "prices") return marketPrices(message, args.slice(1).join(" "));
  return marketBrowse(message, args.join(" "));
}

async function expireTrades() {
  await runTx(async client => {
    const expired = await client.query("SELECT id FROM trades WHERE status = 'open' AND expires_at <= NOW() FOR UPDATE SKIP LOCKED");
    for (const row of expired.rows) {
      await client.query("UPDATE trades SET status = 'expired', closed_at = NOW() WHERE id = $1", [row.id]);
      await client.query("UPDATE catches SET locked_by_trade = NULL WHERE locked_by_trade = $1", [row.id]);
    }
    const listings = await client.query("SELECT id, catch_id FROM market_listings WHERE status = 'active' AND expires_at <= NOW() FOR UPDATE SKIP LOCKED");
    for (const listing of listings.rows) {
      await client.query("UPDATE market_listings SET status = 'expired' WHERE id = $1", [listing.id]);
      await client.query("UPDATE catches SET market_listing_id = NULL WHERE id = $1 AND market_listing_id = $2",
        [listing.catch_id, listing.id]);
    }
  });
}

module.exports = { marketCommand, tradeCommand, expireTrades };
