const fish = [
  { id: "anchovy", name: "Anchovy", rarity: "Common", weight: 22, minValue: 4, maxValue: 9, xp: 3 },
  { id: "sardine", name: "Sardine", rarity: "Common", weight: 20, minValue: 5, maxValue: 10, xp: 3 },
  { id: "bluegill", name: "Bluegill", rarity: "Common", weight: 18, minValue: 6, maxValue: 12, xp: 4 },
  { id: "mackerel", name: "Mackerel", rarity: "Uncommon", weight: 13, minValue: 12, maxValue: 22, xp: 7 },
  { id: "trout", name: "Rainbow Trout", rarity: "Uncommon", weight: 12, minValue: 14, maxValue: 26, xp: 8 },
  { id: "pufferfish", name: "Pufferfish", rarity: "Rare", weight: 7, minValue: 35, maxValue: 60, xp: 15 },
  { id: "swordfish", name: "Swordfish", rarity: "Rare", weight: 6, minValue: 45, maxValue: 75, xp: 18 },
  { id: "anglerfish", name: "Anglerfish", rarity: "Epic", weight: 3, minValue: 100, maxValue: 160, xp: 35 },
  { id: "crystal_koi", name: "Crystal Koi", rarity: "Legendary", weight: 1.2, minValue: 300, maxValue: 500, xp: 80 },
  { id: "golden_shark", name: "Golden Shark", rarity: "Mythic", weight: 0.35, minValue: 900, maxValue: 1400, xp: 180 },
  { id: "sea_dragon", name: "Sea Dragon", rarity: "Secret", weight: 0.05, minValue: 5000, maxValue: 9000, xp: 500 }
];

const rarityColors = {
  Common: 0x95a5a6, Uncommon: 0x2ecc71, Rare: 0x3498db,
  Epic: 0x9b59b6, Legendary: 0xf1c40f, Mythic: 0xe67e22, Secret: 0xe84393
};

function weightedFish() {
  const total = fish.reduce((sum, item) => sum + item.weight, 0);
  let roll = Math.random() * total;
  for (const item of fish) {
    roll -= item.weight;
    if (roll <= 0) return item;
  }
  return fish[0];
}

module.exports = { fish, rarityColors, weightedFish };
