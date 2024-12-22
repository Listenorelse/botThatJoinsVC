require('dotenv').config();
const { Client, GatewayIntentBits, IntentsBitField, ChannelType, EmbedBuilder, GuildVoiceStates, setPosition } = require('discord.js');
const {joinVoiceChannel, getVoiceConnection } = require('@discordjs/voice');
const Database = require('better-sqlite3');
const {token} = require('./config.json')

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
if member is present in database and event_activity >299, increment corresponding memeber's (house_pts) and then
 stop incrementing
clear database on slash command
export database on slash command
join vc channel on slash command with param field (all above done oct 22, 2024)
export database corresponding to userID that send the command (done oct 23, 2024)
export only selected columns (done oct 23, 2024)
leaderboard to show top 20 members of each house (done oct 28, 2024)
give hosts an extra point on event end (when the bot is called to leave the vc) (done oct 28, 2024)
made points given per event customizable, defaults to 1 point per event (done oct 31, 2024 in a yuyuko cosplay, commited 10/31/24)

dev journal:
10/31/24
cant fucking believe that i forgot to make the bot respond to people wiht certain roles only

*/
// In-memory database or use SQLite
const db = new Database('eventData.db');
let awardpoint;
const allowedRoles = {
    makehost: ['The Vonamors', 'The Duma', 'Minor Nobility'],       //only vonamors/duma/minor nob(for now) can use /makehost
    joinvc: ['The Vonamors', 'The Duma', 'Minor Nobility'], 
    leavevc: ['The Vonamors', 'The Duma', 'Minor Nobility'], 
    removedata: ['The Vonamors', 'The Duma', 'Minor Nobility'],
    setpoints: ['The Vonamors', 'The Duma', 'Minor Nobility']
};

// Create tables
db.prepare(`
    CREATE TABLE IF NOT EXISTS members (
        discord_user_id TEXT PRIMARY KEY,
        discord_username TEXT,
        minecraft_username TEXT,
        event_activity INTEGER,
        givepoint INTEGER,
        house_pts REAL,
        house TEXT,
        is_host INTEGER,
        is_winner INTEGER
    )
`).run();
let refreshInterval;
function assignHouse(userId) {
    let member = db.prepare('SELECT * FROM members WHERE discord_user_id = ?').get(userId);
    if(!member){
        //check current count of house

        const lantanaCount = db.prepare('SELECT COUNT(*) as count FROM members WHERE house = \'Lantana\'').get().count;
        const dracaenaCount = db.prepare('SELECT COUNT(*) as count FROM members WHERE house = \'Dracaena\'').get().count;

        // Determine house assignment based on counts
        house = 'Lantana'; // Default to Lantana if counts are equal
        if (lantanaCount > dracaenaCount) {
            house = 'Dracaena';
        }
    }
    

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
function trackMembers(channel) {
    if (refreshInterval) clearInterval(refreshInterval); // Clear any previous tracking intervals
    
    refreshInterval = setInterval(() => {
        // Check if the channel is still valid and has members
        if (!channel || !channel.members) {
            console.log('Channel or members list is not accessible.');
            return;
        }

        channel.members.forEach(member => { // Make sure channel.members is valid
            const userId = member.user.id;
            const username = member.user.username;

            // Check if user exists in the database
            const userRecord = db.prepare('SELECT * FROM members WHERE discord_user_id = ?').get(userId);

            if (!userRecord) {
                // Add member if not in database
                assignHouse(userId);
                console.log(house);
                db.prepare('INSERT INTO members (discord_user_id, discord_username, event_activity, givepoint, house_pts, house) VALUES (?, ?, ?, ?, ?, ?)')
                    .run(userId, username, 1, 0, 0, house);
                    
            } else {
                // If already present, update event_activity
                if (userRecord.event_activity < 300) {
                    db.prepare('UPDATE members SET event_activity = event_activity + 1 WHERE discord_user_id = ?').run(userId);
                }

                // If event_activity >= 300, set givepoint to true
                if (userRecord.event_activity >= 299 && userRecord.givepoint === 0) {
                    db.prepare('UPDATE members SET givepoint = 1 WHERE discord_user_id = ?').run(userId);
                }
            }
        });
    }, 1000); // Refresh every 1 second
}

//Stop tracking when the bot leaves the voice channel
function stopTracking() {
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = null; // Clear the interval ID
}

function givePts() {
    // Increment house_pts for members whose givepoint is true, and reset event_activity
    db.prepare('UPDATE members SET house_pts = house_pts + ?, givepoint = 0 WHERE givepoint = 1').run(awardpoint);

    // increment house_pts for host(s), resets hosts afterwards
    db.prepare('UPDATE members SET house_pts = house_pts + 1, is_host = 0 WHERE is_host = 1').run();

    //increment house_pts for winner(s), resets winners afterwards
    db.prepare('UPDATE members SET house_pts = house_pts + 1, is_winner = 0 WHERE is_winner = 1').run();

    // Reset event_activity for all members
    db.prepare('UPDATE members SET event_activity = 0').run();



    console.log('House points updated and event activity reset.');
    
}

client.on('ready', (c) => {
    console.log(`✅${c.user.tag} is online.`);
});

client.on('interactionCreate', async (interaction) => {
    console.log(interaction.user.id);
    if(!interaction.isCommand()) return;
    if(interaction.commandName === 'sayhey'){
        interaction.reply('hey!');
    }
    else if(interaction.commandName === 'joinvc'){
        const requiredRoles = allowedRoles.joinvc;

        if (!hasRole(interaction, requiredRoles)) {
            return interaction.reply("You don't have permission to use this command.");
        }
        const voiceChannel = interaction.options.getChannel('channel');
        const voiceConnection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: interaction.guild.id,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        });
        trackMembers(voiceChannel);
        interaction.reply('vc joined!');
    }
    else if(interaction.commandName === 'leavevc'){
        const requiredRoles = allowedRoles.leavevc;

        if (!hasRole(interaction, requiredRoles)) {
            return interaction.reply("You don't have permission to use this command.");
        }
        const connection = getVoiceConnection(interaction.guild.id);
        if (connection) {
            connection.destroy(); // Disconnects the bot from the voice channel
            givePts();
            stopTracking();
            await interaction.reply('Disconnected from the vc!');
        } else {
            await interaction.reply('I am not currently in a vc!');
        }
    }
    else if(interaction.commandName === 'exportdata'){
        try {
            // Fetch member from the database
            const userId = interaction.user.id;
            const member = db.prepare('SELECT username, house_pts, house FROM members WHERE discord_user_id = ?').get(userId);

            if (member.length === 0) {
                return interaction.reply('No members found in the database.');
            }

            // Return the exported database
            return interaction.reply(`Exported Database:\n${JSON.stringify(member, null, 2)}`)
        }catch (error) {
        console.error('Error fetching members from the database:', error);
        return interaction.reply('There was an error fetching the database.');
    }
    }
    else if(interaction.commandName === 'leaderboard'){
        try {
            // Query the top 20 members for Lantana ordered by points
            const topLantana = db.prepare(`
                SELECT username, house_pts 
                FROM members 
                WHERE house = 'Lantana' 
                ORDER BY house_pts DESC 
                LIMIT 20;
            `).all();
    
            // Query the top 20 members for Dracaena ordered by points
            const topDracaena = db.prepare(`
                SELECT username, house_pts 
                FROM members 
                WHERE house = 'Dracaena' 
                ORDER BY house_pts DESC 
                LIMIT 20;
            `).all();
    
            // Formatting the output for each house
            let response = '**Top 20 Members in Lantana by Points:**\n';
            topLantana.forEach((member, index) => {
                response += `#${index + 1} ${member.username} - ${member.house_pts} points\n`;
            });
    
            response += '\n**Top 20 Members in Dracaena by Points:**\n';
            topDracaena.forEach((member, index) => {
                response += `#${index + 1} ${member.username} - ${member.house_pts} points\n`;
            });
    
            // Reply with the result
            return interaction.reply(response);
        } catch (error) {
            console.error('Error fetching top members:', error);
            return interaction.reply('There was an error retrieving the top members.');
        }
    }
    else if(interaction.commandName === 'removedata'){
        const requiredRoles = allowedRoles.removedata;

        if (!hasRole(interaction, requiredRoles)) {
            return interaction.reply("You don't have permission to use this command.");
        }
        db.prepare(`DELETE FROM members`).run();
        return interaction.reply('Database cleared!');
    }
    else if (interaction.commandName === 'makehost') {
        const requiredRoles = allowedRoles.makehost;

        if (!hasRole(interaction, requiredRoles)) {
            return interaction.reply("You don't have permission to use this command.");
        }
        // Assuming the command accepts a user mention (user parameter)
        const user = interaction.options.getUser('user'); // Get the specified user from the command
    
        if (!user) {
            return interaction.reply('Please specify a user to make host.');
        }
    
        try {
            // Check if the user is in the database
            let member = db.prepare('SELECT * FROM members WHERE discord_user_id = ?').get(user.id);
    
            if (!member) {
                // If user doesn't exist, add them as a new member and set them as host
                db.prepare(`INSERT INTO members (discord_user_id, username, event_activity, givepoint, house_pts, house, is_host)
                            VALUES (?, ?, 0, 0, 0, 'Unassigned', 1);`).run(user.id, user.username);
                return interaction.reply(`${user.username} has been added to the database and set as host.`);
            } else {
                // If user exists, update their host status
                db.prepare('UPDATE members SET is_host = 1 WHERE discord_user_id = ?').run(user.id);
                return interaction.reply(`${user.username} is now set as host.`);
            }
        } catch (error) {
            console.error('Error setting user as host:', error);
            return interaction.reply('There was an error setting the user as host.');
        }
    }
    else if(interaction.commandName === 'setpoints'){
        const requiredRoles = allowedRoles.setpoints;

        if (!hasRole(interaction, requiredRoles)) {
            return interaction.reply("You don't have permission to use this command.");
        }
        awardpoint = interaction.options.getNumber('points');
        if(!awardpoint)
            interaction.reply('Enter a real number!');
        else
            interaction.reply('Points to award this event per attendee updated!');
    }
    else if(interaction.commandName === 'updateign'){
        let id=interaction.user.id, ign=interaction.options.getString('in_game_name');
        db.prepare('UPDATE members SET minecraft_username = ? WHERE discord_user_id = ?').run(ign, id);

        interaction.reply(`The minecraft account associated to your discord is now ${ign}.`)
    }
    
});



client.on('messageCreate', (msg) => {
    console.log('   ', msg.author.globalName, ': ');
    console.log(msg.content);
    if (msg.author.bot){
        return;
    }
    if (msg.content === 'hello'){
    }


});

client.login(token);