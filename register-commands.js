require('dotenv').config();
const { REST, Routes, ApplicationCommandOptionType } = require('discord.js');

const commands = [
    {
        name: 'serverstatus',
        description: 'Gibt Status zu MC-Server aus.',
        options: [
            {
                name: 'server-address',
                description: 'Server, dessen Status überprüft werden soll.',
                type: ApplicationCommandOptionType.String,
                required: true,
            },
        ],
    },
    {
        name: 'motd',
        description: 'Gibt Motto des Tages eines Servers aus',
        options: [
            {
                name: 'server-address',
                description: 'Server, dessen Spielerliste angezeigt werden soll.',
                type: ApplicationCommandOptionType.String,
                required: true,
            },
        ],
    },
    {
        name: 'setchannelnamestatus',
        description: 'Lass einen Channelnamen die Spielerzahl eines MC-Servers anzeigen.',
        options: [
            {
                name: 'server-address',
                description: 'Server, dessen Spielerzahl angezeigt werden soll.',
                type: ApplicationCommandOptionType.String,
                required: true,
            },
            {
                name: 'channel',
                description: 'Channel, der umbenannt werden soll.',
                type: ApplicationCommandOptionType.Channel,
                required: true,
            },
            {
                name: 'prefix',
                description: 'Präfix zur Spielerzahl im Channelnamen (zB. Servername oder "Spieler: ")',
                type: ApplicationCommandOptionType.String,
                required: false,
            },
        ],
    },
];

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
    try {
        console.log('Registering slash commands...');

        await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
            { body: commands }
        );

        console.log('Slash commands were registered successfully!');
    } catch (error) {
        console.log(`Error: ${error}`);
    }
})();