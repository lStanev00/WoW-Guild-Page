import fs from 'fs';

// Token storing
let accessToken = null;
let tokenExpiry = null; // Store the expiration timestamp

// Blizzard API credentials
const clientId = '16a030025f8c4eae9bbed0d25b6f5cd4';
const clientSecret = '1f6RcKWmzeXrH4vhgvrxkH0wH8Ym34Bs';
const tokenUrl = 'https://eu.battle.net/oauth/token';

// Blizzard API Configuration
const REGION = "eu";
const GUILD_REALM = "chamber-of-aspects"; // Guild's realm slug
const GUILD_NAME = "pvp-scalpel"; // Guild name slugified
const BASE_URL = `https://${REGION}.api.blizzard.com`;
const NAMESPACE = "profile-eu";

// Helper function for delay
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Helper function to fetch data with retry logic
async function blizzFetch(endpoint, playerName, bracket, retries = 3) {
  const url = `${BASE_URL}${endpoint}&namespace=${NAMESPACE}&locale=en_GB`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`, // Use header for authentication
        },
      });
      // console.log(accessToken)
      if (response.ok) {
        return await response.json();
      }

      if (response.status === 503) {
        console.log(
          `Blizzard API unavailable (503). Retry ${attempt}/${retries} for ${playerName} in ${bracket}...`
        );
        await delay(5); // Wait before retrying
      } else {
        if (response.status != 404) console.log(`Player "${playerName}" has no data for ${bracket}. Status: ${response.status}`);
        return null; // Non-retriable errors
      }
    } catch (error) {
      console.log(`Error fetching data for ${playerName} in ${bracket}: ${error.message}`);
      if (attempt < retries) {
        console.log(`Retry ${attempt}/${retries} after error...`);
        await delay(5); // Wait before retrying
      } else {
        throw error; // Give up after retries
      }
    }
  }

  return null; // Return null if all retries fail
}

// Function to dynamically fetch PvP ratings for each bracket
async function fetchPvPData(realm, name, characterClass, spec) {
  const brackets = {
    solo: `shuffle-${characterClass.toLowerCase()}-${spec.toLowerCase()}`,
    solo_bg: `blitz-${characterClass.toLowerCase()}-${spec.toLowerCase()}`,
    "2v2": "2v2",
    "3v3": "3v3",
    rbg: "rbg",
  };

  const results = {};
  for (const [key, value] of Object.entries(brackets)) {
    await delay(1); // Prevent hitting rate limits
    const data = await blizzFetch(`/profile/wow/character/${realm}/${name}/pvp-bracket/${value}?`, name, key);
    results[key] = data?.rating || undefined;
  }

  return results;
}

// Fetch character profile and PvP data
async function fetchCharacterData(member) {
  const { name, realm } = member.character;
  const playerRealmSlug = realm.slug.toLowerCase();
  const playerNameSlug = name.toLowerCase();

  // Fetch character profile
  // await delay(5); 
  const characterProfile = await blizzFetch(
    `/profile/wow/character/${playerRealmSlug}/${playerNameSlug}?`,
    name,
    "Profile"
  );

  if (!characterProfile) {

    console.log(`Player "${name}" has no character profile.\n` + playerRealmSlug + playerNameSlug);
    return null;
  }

  // Fetch PvP ratings
  const playerPvPData = await fetchPvPData(
    playerRealmSlug,
    playerNameSlug,
    characterProfile.character_class.name,
    characterProfile.active_spec?.name || "Unknown"
  );
  
//   console.log(`THIS IS ERRORING HERE:`, `eu`, (name).toLowerCase(), playerRealmSlug, ACCESS_TOKEN);
  return {
    name,
    playerRealmSlug,
    innerID : member.character["id"],
    rank: member.rank,
    race: characterProfile.race?.name || "Unknown",
    class: characterProfile.character_class?.name || "Unknown",
    spec: characterProfile.active_spec?.name || "Unknown",
    rating: playerPvPData,
    achieves : await fetchPvPAchievements(`eu`, playerRealmSlug, (name).toLowerCase(), accessToken),
    media: await fetchImage(`eu`, (name).toLowerCase(), playerRealmSlug, accessToken),
  };
}

// Fetch all guild members and their PvP data
async function getGuildPvPData() {
  console.log("Fetching guild roster...");
  const guildRoster = await blizzFetch(`/data/wow/guild/${GUILD_REALM}/${GUILD_NAME}/roster?`, "Guild", "Roster");

  if (!guildRoster || !guildRoster.members) {
    throw new Error("Failed to fetch guild roster.");
  }

  const members = guildRoster.members;

  console.log("Fetching PvP data for each guild member...");
  const results = [];
  for (const member of members) {
    const playerData = await fetchCharacterData(member);
    if (playerData) {
      results.push(playerData);
    }
  }

  // Sort by rank
  return results.sort((a, b) => a.rank - b.rank);
}

// Save the data to a file
async function savePvPDataToFile() {
    accessToken = await getAccessToken()
    const now = new Date(); 
    console.log(`Execution Time: ${now.toLocaleDateString()} ${now.toLocaleTimeString()}`);

  try {
    const data = await getGuildPvPData();
    const roasterJSON = JSON.stringify(data, null, 2);
    fs.writeFileSync(`./pages/DBS/roaster.json`, roasterJSON, 'utf8');
    console.log("PvP data successfully saved to roaster.json!");
  } catch (error) {
    console.error("Error saving PvP data:", error.message);
  }
}

// !!!Run the function
savePvPDataToFile();
setInterval(savePvPDataToFile, 1800000); // Close to 40 minutes refresh




async function fetchPvPAchievements(region, realm, characterName, accessToken) {
    const delay = (ms) => new Promise((res) => setTimeout(res, ms)); // Helper for rate limiting

    const characterAchievementsUrl = `https://${region}.api.blizzard.com/profile/wow/character/${realm}/${characterName}/achievements?namespace=profile-${region}&locale=en_GB`;
    const achievementDetailUrl = (id) =>
        `https://${region}.api.blizzard.com/data/wow/achievement/${id}?namespace=static-${region}&locale=en_GB`;

    // Arena achievements
    const arena2sAchievements = ["Gladiator", "Duelist", "Rival", "Challenger"];
    const arena3sAchievements = [
        "Three's Company: 2700", "Three's Company: 2400", "Three's Company: 2200",
        "Three's Company: 2000", "Three's Company: 1750", "Three's Company: 1550"
    ];

    // Full Battleground achievements list
    const battlegroundAchievements = [
        "Veteran of the Alliance", "Battleground Blitzest", "Warbound Veteran of the Alliance", "High Warlord",
        "Hero of the Alliance", "Hero of the Horde", "Grand Marshal", "Veteran of the Horde", "General",
        "Knight-Lieutenant", "Knight-Captain", "Knight-Champion", "Sergeant Major", "Master Sergeant",
        "Battleground Blitz Veteran", "Battleground Blitz Master", "Setting Records", "Battle-scarred Battler", 'Legionnaire'
    ];

    try {
        // Step 1: Fetch character achievements
        const response = await fetch(characterAchievementsUrl, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (!response.ok) throw new Error(`Error fetching character achievements: ${response.status}`);
        const charData = await response.json();
        const completedAchievements = charData.achievements;

        // Step 2: Fetch achievement details with rate limiting
        const achievementDetails = [];
        for (const ach of completedAchievements) {
            if (
                arena2sAchievements.includes(ach.achievement.name) ||
                arena3sAchievements.includes(ach.achievement.name) ||
                battlegroundAchievements.includes(ach.achievement.name)
            ) {
                // await delay(5); 
                const detailResponse = await fetch(achievementDetailUrl(ach.achievement.id), {
                    headers: { Authorization: `Bearer ${accessToken}` },
                });

                if (detailResponse.ok) {
                    const detail = await detailResponse.json();
                    achievementDetails.push({
                        name: detail.name,
                        description: detail.description || "No description",
                    });
                }
            }
        }

        // Step 3: Filter 2v2 Arena achievements
        const arena2s = achievementDetails
            .filter((ach) => arena2sAchievements.includes(ach.name))
            .pop() || `No XP yet`;

        // Step 4: Filter 3v3 Arena achievements
        const arena3s = achievementDetails
            .filter((ach) => arena3sAchievements.includes(ach.name))
            .pop() || `No XP yet`;

        // Step 5: Filter Battleground achievements
        const bgAchievements = [];
        let bestRatingAchievement = { name: "None", description: "" };
        let maxRating = 0;

        for (const ach of achievementDetails) {
            if (battlegroundAchievements.includes(ach.name)) {
                // Look for rating achievements in the description
                const ratingMatch = ach.description.match(/Earn a rating of (\d+)/);
                if (ratingMatch) {
                    const rating = parseInt(ratingMatch[1], 10);
                    if (rating > maxRating) {
                        maxRating = rating;
                        bestRatingAchievement = ach;
                    }
                } else {
                    bgAchievements.push(ach); // Push non-rating BG achievements
                }
            }
        }

        if (bestRatingAchievement.name !== "None") {
            bgAchievements.push({
                name: bestRatingAchievement.name,
                description: bestRatingAchievement.description,
            });
        }

        // Step 6: Return the results
        const result = {
            "2s": arena2s,
            "3s": arena3s,
            "BG": bgAchievements,
        };
        if (result[`2s`] === undefined) delete result[`2s`];
        if (result[`3s`] === undefined) delete result[`3s`];
        if (result[`BG`].length === 0) delete result[`BG`];
        // console.log(` PvP Achievements for ${characterName} are fetched`);
        return result;
    } catch (error) {
        console.error(`Error fetching PvP achievements for ${characterName}:`, error.message);
        return {
            "2s": { name: "None", description: "" },
            "3s": { name: "None", description: "" },
            "BG": [],
        };
    }
}
// https://eu.api.blizzard.com/profile/wow/character/chamber-of-aspects/nikolbg/character-media?namespace=profile-eu ??TEST
async function fetchImage(server, name, realm, token) {
    const URL = `https://${server}.api.blizzard.com/profile/wow/character/${realm}/${name.toLowerCase()}/character-media?namespace=profile-${server}`;

    try {
        const data = await(await fetch(URL, {
            headers: {
                Authorization: `Bearer ${token}`,
            }
        })).json();
        const assets = data.assets;       
        const media = {
            avatar: (assets[0])[`value`],
            banner: (assets[1])[`value`],
            charImg: (assets[2])[`value`],
        }
        // console.log(`Media success!`);
        
        return media
    } catch (error) {
        console.log(`Cant retreve media`);
        
    }
}

// "assets": [
//     {
//         "key": "avatar",
//         "value": "https://render.worldofwarcraft.com/eu/character/chamber-of-aspects/24/219201048-avatar.jpg"
//     },
//     {
//         "key": "inset",
//         "value": "https://render.worldofwarcraft.com/eu/character/chamber-of-aspects/24/219201048-inset.jpg"
//     },
//     {
//         "key": "main-raw",
//         "value": "https://render.worldofwarcraft.com/eu/character/chamber-of-aspects/24/219201048-main-raw.png"
//     }
// ]

// Function to dynamically fetch the access token
async function getAccessToken() {
    const now = Date.now();

    // Check if the token is still valid
    if (accessToken && tokenExpiry && now < tokenExpiry) {
        return accessToken;
    }

    try {
        const response = await fetch(tokenUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
            },
            body: 'grant_type=client_credentials',
        });

        if (!response.ok) {
            throw new Error(`!! Failed to fetch token: ${response.statusText}`);
        }

        const data = await response.json();

        // Store the token and calculate its expiration time
        accessToken = data.access_token;
        tokenExpiry = now + data.expires_in * 1000;

        console.log('>> New token fetched:', accessToken);
        return accessToken;
    } catch (error) {
        console.error('Error fetching access token:', error);
        throw error;
    }
}