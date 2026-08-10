# Free Creator Store Assets — Sample Catalog + Guide

**Generated:** 2026-08-10  
**Scope:** Free (`priceFilter=free`) Creator Store **Models** only  
**Limit:** MCP returns max ~20 results per query. The Store has millions of assets — this is a **starter sample**, not a full dump.

---

## How to use this guide

### When to use Creator Store free models
| Need | Use store models when… | Prefer custom / Luau when… |
|------|------------------------|----------------------------|
| **Environment** | Trees, rocks, skyboxes, roads for quick map fill | You need exact style, low part count, or streaming budget |
| **Buildings** | Blockouts, RP houses, horror maps | Unique architecture, collision precision |
| **Vehicles** | Prototype driving / spawners | Real vehicle physics you control |
| **Weapons / gear** | Placeholders, classic tools | Secure combat (validate damage on server) |
| **Furniture** | Interior fill for RP / café | Optimized low-poly sets you own |
| **Systems (admin, leaderboards)** | Speed-running features | You must own/audit every script |

### Safety rules (always)
1. **Inspect scripts** before publishing — free models often ship backdoors, admin abuse, or remote spam.
2. Prefer assets from **Roblox** or known creators; strip unknown `Script`/`LocalScript` if unsure.
3. **Paid assets** cannot be inserted until purchased — this list is free only.
4. Some free assets still **fail to insert** (moderation / package restrictions) — try the next ID.
5. Insert via MCP: `insert_asset` with `assetId`, `assetType: "Model"`, `assetName`.

### MCP search recipe
```
search_asset:
  scope: creator_store
  priceFilter: free
  assetType: Model   # or Audio, Mesh, Image, Decal, Package…
  query: "tree forest"
  maxResults: 20
```

---

## Starter / utilities

| Name | Asset ID | Creator | When to use | URL |
|------|----------|---------|-------------|-----|
| Spawn Point | 10498769556 | agentphilip07 | Default player spawn marker | [link](https://create.roblox.com/store/asset/10498769556) |
| Invisible Spawn Point | 9762951603 | SyncSnacks | Hidden spawn | [link](https://create.roblox.com/store/asset/9762951603) |
| spawn point | 13944666959 | its_fladi | Alternate spawn visual | [link](https://create.roblox.com/store/asset/13944666959) |
| Grass Baseplate | 10100805 | Roblox | Classic grass floor | [link](https://create.roblox.com/store/asset/10100805) |
| Grass Baseplate | 2286648632 | colorfuleagle1001 | Fits default baseplate size | [link](https://create.roblox.com/store/asset/2286648632) |
| Old stud block | 11257095071 | cnnendot4133 | Retro stud props | [link](https://create.roblox.com/store/asset/11257095071) |
| Sword | 47433 | Roblox | Classic linked sword tool | [link](https://create.roblox.com/store/asset/47433) |
| Noob NPC | 4446576906 | Vertixer1337 | Placeholder NPC | [link](https://create.roblox.com/store/asset/4446576906) |
| Shift to run | 8459456709 | ScriptedMikeey | Sprint script prototype — **audit scripts** | [link](https://create.roblox.com/store/asset/8459456709) |
| HD Admin | 857927023 | ForeverHD | Admin commands — **production risk; audit heavily** | [link](https://create.roblox.com/store/asset/857927023) |
| Time Played Leaderboard | 5352156968 | RenanMSV | Playtime board — **DataStore costs** | [link](https://create.roblox.com/store/asset/5352156968) |

---

## Sky / atmosphere

| Name | Asset ID | When to use |
|------|----------|-------------|
| Realistic Sky | 4607457995 | Generic day skybox starter |
| Aesthetic sky | 7108851308 | Mood / vibe maps |
| Classic Roblox Sky (SKYBOX) | 339406852 | Nostalgia / classic places |
| CakeUp Night Sky Galaxy Planets | 15983996673 | Night / space vibe |

---

## Nature / forest

| Name | Asset ID | When to use |
|------|----------|-------------|
| Stud Tree Classic Retro | 83155033985612 | Classic/stud aesthetic maps |
| Realistic Log Wood | 136869545721659 | Forest floor props |
| PBR Nature Pack Wild Trees | 123405066104552 | Higher-detail foliage packs |
| Forest Tower / Tree House | 72105624698726 | Adventure / hideout |
| Realistic Pine Tree | 90843648266001 | Evergreen biome |
| Winter Forest Pack | 106336474170677 | Snow maps |
| Autumn Sky Fall Tree | 139035690932109 | Fall biome |
| Cartoon Forest Lowpoly Pack | 127971452858364 | Stylized / mobile-friendly |
| Realistic Moving Tree | 105750520391033 | Animated canopy (perf cost) |
| PBR Realistic Tree Pack | 106624131560617 | Dense forest fill |

---

## Buildings / houses

| Name | Asset ID | When to use |
|------|----------|-------------|
| Classic House | 8959904556 | Simple suburban starter |
| Horror Game House Building | 16703737576 | Horror blockout |
| Horror Game House Building | 18574951722 | Variant horror house |
| Modern Apartment Building | 18888365209 | City RP |
| Small House Brookhaven-style | 77692490790411 | City RP homes |
| Apartment building Urban Loft | 114126832502867 | Dense urban |
| Modern Town City Building | 93988667845755 | Street / town strip |
| Brookhaven Villa 1 | 124487663909260 | Luxury RP house |
| Destroyed Building | 120370036715023 | Apocalypse maps |
| Buildings Walls Houses pack | 129441595821867 | Modular town pieces |

---

## Roads / vehicles

| Name | Asset ID | When to use |
|------|----------|-------------|
| Road | 14102233829 | Quick road strip |
| 2019 Sports Car | 6810376207 | Showcase car |
| Army jeep / military | 77018157368877 | War / mil RP |
| Classic Pickup Truck | 92651703326783 | Civilian traffic |
| Classic Roblox Jeep Spawner | 114110323866454 | Classic vehicle spawn |
| Free Humvee | 125960240887706 | Military transport |
| Abandoned Car | 97780315774758 | Wasteland prop |
| Parking Space | 71334976821290 | Parking lot detail |

---

## Weapons / combat (placeholders only)

| Name | Asset ID | When to use |
|------|----------|-------------|
| Low Poly Weapon Pack | 102927883946599 | Style mockups |
| Classic Weapons Rifle… | 105727800460617 | Classic FPS look |
| Classic Roblox Weapon Pack | 105002355098155 | Retro gear |
| FPS Weapon System Pack | 87452459242470 | Prototype only — **rewrite combat server-side** |

---

## Furniture / interiors

| Name | Asset ID | When to use |
|------|----------|-------------|
| Cafe Table Chair | 132188174151502 | Café / hangout |
| Table Chairs Dining Set | 81429788184908 | Dining rooms |
| Dining Table Chairs Kitchen | 106869233942930 | House interiors |
| Classic 2007 Furniture | 110463242735527 | Retro interiors |
| Furniture Couch Tables Office | 130155490858637 | Office / lobby |

---

## When *not* to use free models

- **Core game loop** (currency, inventory, combat resolution) — write your own server code.
- **Monetization / admin** — free admin kits are high abuse risk.
- **Final art pass** — many free models are high part-count or poorly optimized.
- **Anything you cannot open and understand** in Explorer.

---

## Refreshing this list

Re-run searches with different `query` / `assetType` values. Store rankings change often.  
For Audio/Mesh/Decal, set `assetType` accordingly (inventory APIs often require one type per call).

**Insert example (MCP):**
```
insert_asset:
  assetId: "47433"
  assetType: Model
  assetName: Sword
  parentPath: game.Workspace
```
