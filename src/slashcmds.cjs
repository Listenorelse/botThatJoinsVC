require('dotenv').config();
const { REST, Routes, ChannelType, EmbedBuilder, SlashCommandBuilder, VoiceChannel} = require('discord.js')

const commands = [
        new SlashCommandBuilder().setName('sayhey')
    .setDescription('replies to slash with hey')
    .toJSON(),
        new SlashCommandBuilder().setName('joinvc')
    .setDescription('joins vc specified in params')
    .addChannelOption((option) => 
    option.setName('channel')
    .setDescription('the channel to join')
    .setRequired(true)
    .addChannelTypes(ChannelType.GuildVoice))
    .toJSON(),
        new SlashCommandBuilder().setName('leavevc')
    .setDescription('leaves current vc')
    .toJSON(),
        new SlashCommandBuilder().setName('removedata')
    .setDescription('clears all data from house points database')
    .toJSON(),
        new SlashCommandBuilder().setName('exportdata')
    .setDescription('exports house point data')
    .toJSON(),
        new SlashCommandBuilder().setName('leaderboard')
    .setDescription('outputs current top 20 members of each house')
    .toJSON(),
        new SlashCommandBuilder().setName('makehost')
    .setDescription('sets a user to host for this event only')
    .addUserOption((option) => 
    option.setName('user')
    .setDescription('the user to assign as host')
    .setRequired(true))
    .toJSON(),
        new SlashCommandBuilder().setName('setpoints')
    .setDescription('set the point award for the current event')
    .addNumberOption((option) => 
    option.setName('points')
    .setDescription('points to award attendees for this event')
    .setRequired(true))
    .toJSON(),
];

const rest = new REST({ version: '10'}).setToken(process.env.token);

(async () => {
    try{
        console.log('registering slash commands...');

        await rest.put(
            Routes.applicationGuildCommands(process.env.client_id, process.env.test_guild_id),
            {body: commands}
        )

        console.log('slash commands registering successful!');
    }catch(error){
        console.log(`there was an error: ${error}`);
    }

})();
