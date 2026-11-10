require("dotenv").config();

const { Client, GatewayIntentBits, Partials } = require("discord.js");
const { initDatabase } = require("./db");
const game = require("./game");
const trading = require("./trading");

const token = process.env.DISCORD_TOKEN;
const prefix = process.env.BOT_PREFIX || "!";

if (!token) {
  console.error("Missing DISCORD_TOKEN. Add it to your environment variables.");
  process.exit(1);
}
if (!process.env.NEON_DATABASE_URL && !process.env.DATABASE_URL) {
  console.error("Missing NEON_DATABASE_URL. Configure your Neon PostgreSQL connection before starting.");
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel]
});

const commands = new Map([
  ["fish", message => game.fishCommand(message)],
  ["balance", message => game.balanceCommand(message)],
  ["inventory", message => game.inventoryCommand(message)],
  ["inv", message => game.inventoryCommand(message)],
  ["sell", (message, args) => game.sellCommand(message, args)],
  ["daily", message => game.dailyCommand(message)],
  ["shop", message => game.shopCommand(message)],
  ["buy", (message, args) => game.buyCommand(message, args)],
  ["equip", (message, args) => game.equipCommand(message, args)],
  ["rod", message => game.rodCommand(message)],
  ["profile", message => game.profileCommand(message, message.mentions.users.first())],
  ["leaderboard", message => game.leaderboardCommand(message)],
  ["collection", message => game.collectionCommand(message)],
  ["market", (message, args) => trading.marketCommand(message, args)],
  ["trade", (message, args) => trading.tradeCommand(message, args)],
  ["help", message => message.reply({ embeds: [game.helpEmbed()], components: [game.helpMenu()] })]
]);

client.on("interactionCreate", async interaction => {
  if (!interaction.isStringSelectMenu()) return;
  try {
    if (interaction.customId === "fish_help_category") {
      await interaction.update({ embeds: [game.helpEmbed(interaction.values[0])], components: [game.helpMenu()] });
    } else if (interaction.customId === "fish_guide_select") {
      const species = require("./data/fish").fish.find(item => item.id === interaction.values[0]);
      if (!species) return interaction.reply({ content: "That species could not be found.", ephemeral: true });
      await interaction.update({ embeds: [game.fishDetailEmbed(species)], components: [game.fishGuideMenu()] });
    }
  } catch (error) {
    console.error("Select menu interaction failed:", error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "Something went wrong while opening that menu.", ephemeral: true }).catch(() => {});
    }
  }
});

client.once("ready", () => {
  console.log("🐟 " + client.user.tag + " is online. Prefix: " + prefix);
  client.user.setActivity("the ocean | !help");
  const timer = setInterval(() => trading.expireTrades().catch(error =>
    console.error("Trading expiry worker failed:", error)), 60_000);
  timer.unref?.();
});

client.on("messageCreate", async message => {
  if (message.author.bot || !message.content.startsWith(prefix)) return;
  const input = message.content.slice(prefix.length).trim();
  if (!input) return;
  const parts = input.split(/\s+/);
  const commandName = parts.shift().toLowerCase();
  const args = parts;

  if (commandName === "ping") return message.reply("🏓 Pong! " + client.ws.ping + "ms");
  const command = commands.get(commandName);
  if (!command) return;

  try {
    await command(message, args);
  } catch (error) {
    console.error("Command !" + commandName + " failed:", error);
    await message.reply("⚠️ " + (error.message || "Something went wrong. Please try again later."));
  }
});

process.on("unhandledRejection", error => console.error("Unhandled promise rejection:", error));

async function start() {
  try {
    await initDatabase();
    await client.login(token);
  } catch (error) {
    console.error("Failed to start Fish Bot:", error);
    process.exit(1);
  }
}

start();
