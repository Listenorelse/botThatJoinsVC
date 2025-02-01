require('dotenv').config();
const { Client, GatewayIntentBits, IntentsBitField, ChannelType, EmbedBuilder, GuildVoiceStates, setPosition } = require('discord.js');
const {joinVoiceChannel, getVoiceConnection } = require('@discordjs/voice');
const mysql = require('mysql2');
const {token, dbConfig} = require('./config.json');
const pool = require("./db");

//i do not know what the fuck i am doing like seriously help meeeeeee
//chatgpt is a godsend


/*
current milestones: (list created 10/22/24, updated 10/22/24)
bot can register and respond to slash commands(done prior to oct 22, 2024)
bot can join vcs(done oct 22, 2024)
bot can leave its current vc(done oct 22, 2024)
bot can respond to certain messages(done prior to oct 22, 2024)

goal:
join a vc, refresh member data once per sec
if member is not present in database, create entry and set (event_activity) to 1
else if member is already present in database, increment event_activity by 1
if member is present in database and event_activity >299, increment corresponding memeber's (event_pts) and then
 stop incrementing
clear database on slash command
export database on slash command
join vc channel on slash command with param field (all above done oct 22, 2024)
export database corresponding to userID that send the command (done oct 23, 2024)
export only selected columns (done oct 23, 2024)
leaderboard to show top 20 members of each house (done oct 28, 2024)
give hosts an extra point on event end (when the bot is called to leave the vc) (done oct 28, 2024)
made points given per event customizable, defaults to 1 point per event (done oct 31, 2024 in a yuyuko cosplay, commited 10/31/24)
scrape a channel for bot messages and take pieces of it to match to the database for usernames

dev journal:
10/31/24
cant fucking believe that i forgot to make the bot respond to people wiht certain roles only


*/

let awardpoint;
const allowedRoles = {
    makehost: ['The Vonamors', 'The Duma', 'Minor Nobility'],       //only vonamors/duma/minor nob(for now) can use /makehost
    joinvc: ['The Vonamors', 'The Duma', 'Minor Nobility'], 
    leavevc: ['The Vonamors', 'The Duma', 'Minor Nobility'], 
    removedata: ['The Vonamors', 'The Duma', 'Minor Nobility'],
    setpoints: ['The Vonamors', 'The Duma', 'Minor Nobility']
};



// Create tables

const connection = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'Factions101',
    port: 3306,
    database: 'eventData'
});

const query = `
    CREATE TABLE IF NOT EXISTS members (
        minecraft_username VARCHAR(255) PRIMARY KEY,
        discord_username VARCHAR(255),
        discord_user_id VARCHAR(255),
        event_activity INT,
        givepoint INT,
        event_pts FLOAT,
        house VARCHAR(255),
        pts_total INT,
        g_raids_done FLOAT,
        is_host TINYINT(1),
        is_winner TINYINT(1)
    )
`;

connection.query(query, (err, results) => {
    if (err) {
        console.error('Error creating table:', err);
    } else {
        console.log('Table created successfully:', results);
    }
    connection.end();
});

async function assignHouse(userId, connection) {
    const [rows] = await connection.execute('SELECT * FROM members WHERE discord_user_id = ?', [userId]);
    
    if (rows.length === 0) {
        // Check current count of houses
        const [[{ count: lantanaCount }]] = await connection.execute('SELECT COUNT(*) as count FROM members WHERE house = "Lantana"');
        const [[{ count: dracaenaCount }]] = await connection.execute('SELECT COUNT(*) as count FROM members WHERE house = "Dracaena"');

        // Determine house assignment
        let house = lantanaCount > dracaenaCount ? 'Dracaena' : 'Lantana';
        
        return house;
    }

    return null; // User already exists
}
const client = new Client({
    intents: [
        IntentsBitField.Flags.Guilds,
        IntentsBitField.Flags.GuildMembers,
        IntentsBitField.Flags.GuildMessages,
        IntentsBitField.Flags.MessageContent,
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers
    ],
});

function hasRole(interaction, requiredRoles) {
    // Check if the member has any of the required roles
    const member = interaction.member;
    return member.roles.cache.some(role => requiredRoles.includes(role.name));
}

// Function to track members
let refreshInterval = null;

async function trackMembers(channel, connection) {
    if (refreshInterval) clearInterval(refreshInterval);

    refreshInterval = setInterval(async () => {
        if (!channel || !channel.members) {
            console.log('Channel or members list is not accessible.');
            return;
        }

        for (const member of channel.members.values()) {
            const userId = member.user.id;
            const username = member.user.username;

            const [rows] = await connection.execute('SELECT * FROM members WHERE discord_user_id = ?', [userId]);

            if (rows.length === 0) {
                const house = await assignHouse(userId, connection);
                console.log(house);

                await connection.execute(
                    'INSERT INTO members (discord_user_id, discord_username, event_activity, givepoint, event_pts, house) VALUES (?, ?, ?, ?, ?, ?)',
                    [userId, username, 1, 0, 0, house]
                );
            } else {
                const userRecord = rows[0];

                if (userRecord.event_activity < 300) {
                    await connection.execute('UPDATE members SET event_activity = event_activity + 1 WHERE discord_user_id = ?', [userId]);
                }

                if (userRecord.event_activity >= 299 && userRecord.givepoint === 0) {
                    await connection.execute('UPDATE members SET givepoint = 1 WHERE discord_user_id = ?', [userId]);
                }
            }
        }
    }, 1000);
}

//Stop tracking when the bot leaves the voice channel
function stopTracking() {
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = null; // Clear the interval ID
}

async function givePts(connection, awardpoint) {
    await connection.execute('UPDATE members SET event_pts = event_pts + ?, givepoint = 0 WHERE givepoint = 1', [awardpoint]);
    await connection.execute('UPDATE members SET event_pts = event_pts + 1, is_host = 0 WHERE is_host = 1');
    await connection.execute('UPDATE members SET event_pts = event_pts + 1, is_winner = 0 WHERE is_winner = 1');
    await connection.execute('UPDATE members SET event_activity = 0');

    console.log('House points updated and event activity reset.');
}

const RAID_CHANNEL = 'raid-completions';

// **🛠️ Listen for messages in #raid-completions**
client.on('messageCreate', async (message) => {
    // Ignore messages not from the bot or from the wrong channel
    if (message.channel.name !== RAID_CHANNEL || !message.author.bot) return;

    // Extract player names
    const playerNames = extractUsernames(message.content);

    // Process each player
    for (const username of playerNames) {
        await processRaidCompletion(username, message);
    }
});

// **🔎 Extract Minecraft usernames from the message**
function extractUsernames(messageContent) {
    const regex = /Player \d+: (\w+)/g;
    let match, players = [];
    while ((match = regex.exec(messageContent)) !== null) {
        players.push(match[1]);
    }
    return players;
}

// **🚀 Process each raid completion**
async function processRaidCompletion(minecraftUsername, message) {
    let connection;
    try {
        // ✅ Connect to REMOTE MySQL database
        connection = await pool.getConnection();

        // **🔍 Check if user exists in the remote database**
        const [rows] = await connection.execute(
            "SELECT discordUserID FROM User WHERE minecraftUsername = ?",
            [minecraftUsername]
        );

        let discordUserID;
        
        if (rows.length > 0 && rows[0].discordUserID) {
            // ✅ User exists → Retrieve their Discord ID
            discordUserID = rows[0].discordUserID;
            console.log(`[REMOTE DB] Found: ${minecraftUsername} -> Discord ID: ${discordUserID}`);
        } else {
            // ❌ No entry found → Try to find their Discord ID in the Discord guild
            const discordUser = await findDiscordUserByUsername(minecraftUsername, message.guild);

            if (discordUser) {
                discordUserID = discordUser.id;

                // **🆕 Insert new user into the REMOTE database**
                await connection.execute(
                    "INSERT INTO User (minecraftUsername, discordUserID) VALUES (?, ?)",
                    [minecraftUsername, discordUserID]
                );
                console.log(`[REMOTE DB] New user added: ${minecraftUsername} -> Discord ID: ${discordUserID}`);
            } else {
                console.log(`[REMOTE DB] ❌ No Discord match found for ${minecraftUsername}`);
                return;
            }
        }

        // ✅ **Update raid completion count in REMOTE database**
        await connection.execute(
            "UPDATE User SET g_raids_done = g_raids_done + 1 WHERE minecraftUsername = ?",
            [minecraftUsername]
        );

        console.log(`[REMOTE DB] Raid completion updated for ${minecraftUsername}`);

    } catch (error) {
        console.error(`[REMOTE DB] Error processing raid completion for ${minecraftUsername}:`, error);
    } finally {
        if (connection) await connection.release(); // Always release DB connection
    }
}

// **🔎 Find a Discord user by their Minecraft username**


client.on('ready', (c) => {
    console.log(`✅${c.user.tag} is online.`);
});

client.on('interactionCreate', async (interaction) => {
    console.log(interaction.user.id);

    if (!interaction.isCommand()) return;

    const connection = await pool.getConnection();

    try {
        if (interaction.commandName === 'sayhey') {
            return interaction.reply('hey!');
        }

        else if (interaction.commandName === 'joinvc') {
            const requiredRoles = allowedRoles.joinvc;

            if (!hasRole(interaction, requiredRoles)) {
                return interaction.reply("You don't have permission to use this command.");
            }

            const voiceChannel = interaction.options.getChannel('channel');

            if (!voiceChannel || voiceChannel.type !== 'GUILD_VOICE') {
                return interaction.reply('Please provide a valid voice channel.');
            }

            joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: interaction.guild.id,
                adapterCreator: voiceChannel.guild.voiceAdapterCreator,
            });

            trackMembers(voiceChannel);
            return interaction.reply('VC joined!');
        }

        else if (interaction.commandName === 'leavevc') {
            const requiredRoles = allowedRoles.leavevc;

            if (!hasRole(interaction, requiredRoles)) {
                return interaction.reply("You don't have permission to use this command.");
            }

            const connection = getVoiceConnection(interaction.guild.id);

            if (!connection) {
                return interaction.reply('I am not currently in a VC!');
            }

            connection.destroy();
            givePts();
            stopTracking();
            return interaction.reply('Disconnected from the VC!');
        }

        else if (interaction.commandName === 'exportdata') {
            const userId = interaction.user.id;
            const [rows] = await connection.execute('SELECT username, event_pts, house FROM members WHERE discord_user_id = ?', [userId]);

            if (rows.length === 0) {
                return interaction.reply('No members found in the database.');
            }

            return interaction.reply(`Exported Database:\n${JSON.stringify(rows[0], null, 2)}`);
        }

        else if (interaction.commandName === 'leaderboard') {
            const [topLantana] = await connection.execute(`
                SELECT username, event_pts 
                FROM members 
                WHERE house = 'Lantana' 
                ORDER BY event_pts DESC 
                LIMIT 20;
            `);

            const [topDracaena] = await connection.execute(`
                SELECT username, event_pts 
                FROM members 
                WHERE house = 'Dracaena' 
                ORDER BY event_pts DESC 
                LIMIT 20;
            `);

            let response = '**Top 20 Members in Lantana by Points:**\n';
            topLantana.forEach((member, index) => {
                response += `#${index + 1} ${member.username} - ${member.event_pts} points\n`;
            });

            response += '\n**Top 20 Members in Dracaena by Points:**\n';
            topDracaena.forEach((member, index) => {
                response += `#${index + 1} ${member.username} - ${member.event_pts} points\n`;
            });

            return interaction.reply(response);
        }

        else if (interaction.commandName === 'removedata') {
            const requiredRoles = allowedRoles.removedata;

            if (!hasRole(interaction, requiredRoles)) {
                return interaction.reply("You don't have permission to use this command.");
            }

            await connection.execute('DELETE FROM members');
            return interaction.reply('Database cleared!');
        }

        else if (interaction.commandName === 'makehost') {
            const requiredRoles = allowedRoles.makehost;

            if (!hasRole(interaction, requiredRoles)) {
                return interaction.reply("You don't have permission to use this command.");
            }

            const user = interaction.options.getUser('user');

            if (!user) {
                return interaction.reply('Please specify a user to make host.');
            }

            const [rows] = await connection.execute('SELECT * FROM members WHERE discord_user_id = ?', [user.id]);

            if (rows.length === 0) {
                await connection.execute(`
                    INSERT INTO members (discord_user_id, username, event_activity, givepoint, event_pts, house, is_host)
                    VALUES (?, ?, 0, 0, 0, 'Unassigned', 1);
                `, [user.id, user.username]);

                return interaction.reply(`${user.username} has been added to the database and set as host.`);
            } else {
                await connection.execute('UPDATE members SET is_host = 1 WHERE discord_user_id = ?', [user.id]);
                return interaction.reply(`${user.username} is now set as host.`);
            }
        }

        else if (interaction.commandName === 'setpoints') {
            const requiredRoles = allowedRoles.setpoints;

            if (!hasRole(interaction, requiredRoles)) {
                return interaction.reply("You don't have permission to use this command.");
            }

            const awardpoint = interaction.options.getNumber('points');

            if (!awardpoint) {
                return interaction.reply('Enter a real number!');
            }

            return interaction.reply('Points to award this event per attendee updated!');
        }

        else if (interaction.commandName === 'updateign') {
            const id = interaction.user.id;
            const ign = interaction.options.getString('in_game_name');

            await connection.execute('UPDATE members SET minecraft_username = ? WHERE discord_user_id = ?', [ign, id]);

            return interaction.reply(`The Minecraft account associated with your Discord is now ${ign}.`);
        }
    } catch (error) {
        console.error('Error executing command:', error);
        interaction.reply('An error occurred while processing the command.');
    } finally {
        connection.release(); // Release connection back to pool
    }
});



// Listen for messages in the specified channel
client.on('messageCreate', async (message) => {
    if (message.channel.name !== 'raid-completions' || !message.author.bot){
        if(message.channel.name === 'raid-completions') console.log('non bot message');
        return;
    }
    console.log('bot message recieved!');
       console.log(message.content);
    // Extract player names from the bot message
    const playerNames = extractUsernames(message.content);

    // Process each player's raid completion
    for (const username of playerNames) {
        await processRaidCompletion(username, message);
    }
});

client.login(token);