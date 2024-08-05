require('dotenv').config();
const { Client, GatewayIntentBits, TextChannel } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = './status.json';
const { v4: uuidv4 } = require('uuid');

const apiBaseUrl = 'https://api.mcsrvstat.us/3';

const updateInterval = 60000; // 1 Minute für Serverstatus Updates
const channelUpdateInterval = 300000; // 5 Minuten für Kanalnamen Updates

// Funktion zum Speichern des Status in eine Datei
function saveStatus(data) {
    let currentStatus = {};
    if (fs.existsSync(path)) {
        currentStatus = JSON.parse(fs.readFileSync(path));
    }
    // Merge existing status with new data
    const updatedStatus = {
        ...currentStatus,
        ...data
    };
    fs.writeFileSync(path, JSON.stringify(updatedStatus, null, 2));
    console.log('Status gespeichert:', updatedStatus);
}

// Funktion zum Laden des Status aus der Datei
function loadStatus() {
    if (fs.existsSync(path)) {
        const statusData = JSON.parse(fs.readFileSync(path));
        console.log('Statusdaten geladen:', statusData);
        return statusData;
    } else {
        console.log('Keine Status-Datei gefunden. Es werden keine vorherigen Statusdaten geladen.');
        return {};
    }
}

// Funktion zum Entfernen des Status eines beendeten Prozesses
function removeStatus(processId) {
    if (!fs.existsSync(path)) return;

    const statusData = JSON.parse(fs.readFileSync(path));
    for (const key in statusData) {
        if (statusData[key][processId]) {
            delete statusData[key][processId];
            if (Object.keys(statusData[key]).length === 0) {
                delete statusData[key];
            }
        }
    }
    fs.writeFileSync(path, JSON.stringify(statusData, null, 2));
    console.log(`Status für Prozess-ID ${processId} entfernt.`);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

client.once('ready', () => {
    console.log(`${client.user.tag} ist online.`);
    
    // Sicherstellen, dass die Status-Datei existiert
    if (!fs.existsSync(path)) {
        console.log('Status-Datei nicht gefunden. Erstelle eine neue Datei.');
        saveStatus({});
    } else {
        console.log('Status-Datei gefunden.');
    }

    // Nach einem Neustart, geladene Status prüfen und wiederherstellen
    const loadedStatus = loadStatus();

    // Wiederherstellen der Serverstatus-Nachrichten
    for (const [statusType, processes] of Object.entries(loadedStatus)) {
        for (const [processId, status] of Object.entries(processes)) {
            if (statusType === 'serverStatuses') {
                const channel = client.channels.cache.get(status.channelId);
                if (channel && channel instanceof TextChannel) {
                    channel.messages.fetch(status.messageId).then(message => {
                        const interval = setInterval(async () => {
                            try {
                                console.log('Updating server status...');
                                const updatedResponse = await axios.get(`${apiBaseUrl}/${status.serverAddress}`);
                                const updatedStatus = updatedResponse.data;
                                let updatedMessage;
                                if (updatedStatus.online) {
                                    updatedMessage = `Der Server ${status.serverAddress} ist online mit ${updatedStatus.players.online} Spieler(n).`;
                                } else {
                                    updatedMessage = `Der Server ${status.serverAddress} ist offline.`;
                                }
                                if (message.content !== updatedMessage) {
                                    await message.edit({ content: updatedMessage });
                                    console.log('Status message updated.');
                                    // Status speichern
                                    saveStatus({
                                        [statusType]: {
                                            [processId]: {
                                                messageId: message.id,
                                                channelId: message.channel.id,
                                                serverAddress: status.serverAddress,
                                                endInterval: status.endInterval || 900000 // 15 Minuten
                                            }
                                        }
                                    });
                                }
                            } catch (error) {
                                console.error('Error updating server status:', error);
                                await message.edit({ content: 'Fehler beim Abrufen des Serverstatus.' });
                            }
                        }, updateInterval);

                        setTimeout(async () => {
                            clearInterval(interval);
                            await message.edit({ content: 'Der Befehl ist abgelaufen.' });
                            setTimeout(async () => {
                                await message.delete();
                                // Status entfernen
                                removeStatus(processId);
                            }, 60000); // 1 Minute warten, dann löschen
                        }, status.endInterval || 900000); // 15 Minuten
                    }).catch(console.error);
                } else {
                    // Falls Nachricht nicht gefunden wird, Status entfernen
                    removeStatus(processId);
                }
            } else if (statusType === 'channelStatuses') {
                const channel = client.channels.cache.get(status.channelId);
                if (channel && channel instanceof TextChannel) {
                    // Nachricht für das Umbenennen des Kanals existiert bereits, diese wird nach 1 Minute gelöscht
                    channel.messages.fetch({ limit: 1 }).then(messages => {
                        const renameMessage = messages.find(msg => msg.content === 'Der Kanalname wird nun entsprechend der Spielerzahl aktualisiert.');
                        if (renameMessage) {
                            setTimeout(async () => {
                                await renameMessage.delete();
                            }, 60000); // Nachricht nach 1 Minute löschen
                        }
                    }).catch(console.error);

                    const interval = setInterval(async () => {
                        try {
                            console.log('Updating channel name with player count...');
                            const updatedResponse = await axios.get(`${apiBaseUrl}/${status.serverAddress}`);
                            const updatedStatus = updatedResponse.data;
                            let updatedChannelName;
                            if (updatedStatus.online) {
                                updatedChannelName = `${status.prefix}-${updatedStatus.players.online}-spielen`;
                            } else {
                                updatedChannelName = 'offline';
                            }
                            if (channel.name !== updatedChannelName) {
                                await channel.setName(updatedChannelName);
                                console.log(`Channel name updated to "${updatedChannelName}"`);
                                // Status speichern
                                saveStatus({
                                    [statusType]: {
                                        [processId]: {
                                            serverAddress: status.serverAddress,
                                            prefix: status.prefix,
                                            channelId: channel.id
                                        }
                                    }
                                });
                            } else {
                                console.log(`Channel name "${updatedChannelName}" is already up-to-date`);
                            }
                        } catch (error) {
                            console.error('Error updating channel name with player count:', error);
                        }
                    }, channelUpdateInterval);
                } else {
                    // Falls Kanal nicht gefunden wird, Status entfernen
                    removeStatus(processId);
                }
            }
        }
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;

    const processId = uuidv4(); // Eindeutige Prozess-ID erstellen

    if (interaction.commandName === 'serverstatus') {
        const serverAddress = interaction.options.getString('server-address');
        if (!serverAddress) {
            return interaction.reply('Bitte gib eine Server-Adresse an.');
        }

        console.log(`Handling /serverstatus command for server: ${serverAddress}`);
        await interaction.deferReply();

        const apiUrl = `${apiBaseUrl}/${serverAddress}`;

        try {
            console.log('Fetching initial server status...');
            const response = await axios.get(apiUrl);
            const serverStatus = response.data;

            console.log(`Initial server status: Players online - ${serverStatus.players.online}`);
            
            let message;
            if (serverStatus.online) {
                message = `Der Server ${serverAddress} ist online mit ${serverStatus.players.online} Spieler(n).`;
            } else {
                message = `Der Server ${serverAddress} ist offline.`;
            }

            const replyMessage = await interaction.editReply({ content: message });
            console.log('Initial status message sent.');

            const statusData = {
                serverStatuses: {
                    [processId]: {
                        messageId: replyMessage.id,
                        channelId: replyMessage.channel.id,
                        serverAddress: serverAddress,
                        endInterval: 900000 // 15 Minuten
                    }
                }
            };

            // Speichern des Status
            saveStatus(statusData);

            const interval = setInterval(async () => {
                try {
                    console.log('Updating server status...');
                    const updatedResponse = await axios.get(apiUrl);
                    const updatedStatus = updatedResponse.data;
                    let updatedMessage;
                    if (updatedStatus.online) {
                        updatedMessage = `Der Server ${serverAddress} ist online mit ${updatedStatus.players.online} Spieler(n).`;
                    } else {
                        updatedMessage = `Der Server ${serverAddress} ist offline.`;
                    }
                    if (replyMessage.content !== updatedMessage) {
                        await replyMessage.edit({ content: updatedMessage });
                        console.log('Status message updated.');
                        // Status speichern
                        saveStatus({
                            serverStatuses: {
                                [processId]: {
                                    messageId: replyMessage.id,
                                    channelId: replyMessage.channel.id,
                                    serverAddress: serverAddress,
                                    endInterval: 900000 // 15 Minuten
                                }
                            }
                        });
                    }
                } catch (error) {
                    console.error('Error updating server status:', error);
                    await replyMessage.edit({ content: 'Fehler beim Abrufen des Serverstatus.' });
                }
            }, updateInterval);

            // Stoppen und löschen der Nachricht nach 15 Minuten
            setTimeout(async () => {
                clearInterval(interval);
                await replyMessage.edit({ content: 'Der Befehl ist abgelaufen.' });
                setTimeout(async () => {
                    await replyMessage.delete();
                    // Status entfernen
                    removeStatus(processId);
                }, 60000); // 1 Minute warten, dann löschen
            }, 900000); // 15 Minuten

        } catch (error) {
            console.error('Error fetching server status:', error);
            await interaction.editReply({ content: 'Konnte den Serverstatus nicht abrufen.' });
        }
    } else if (interaction.commandName === 'motd') {
        const serverAddress = interaction.options.getString('server-address');
        if (!serverAddress) {
            return interaction.reply('Bitte gib eine Server-Adresse an.');
        }

        console.log(`Handling /motd command for server: ${serverAddress}`);
        await interaction.deferReply();

        const apiUrl = `${apiBaseUrl}/${serverAddress}`;

        try {
            console.log('Fetching server MOTD...');
            const response = await axios.get(apiUrl);
            const serverStatus = response.data;

            console.log(`Server MOTD: ${serverStatus.motd.clean}`);
            
            let motdMessage;
            if (serverStatus.online) {
                motdMessage = `Server MOTD: ${serverStatus.motd.clean}`;
            } else {
                motdMessage = 'Der Server ist offline.';
            }

            await interaction.editReply({ content: motdMessage });
        } catch (error) {
            console.error('Error fetching server MOTD:', error);
            await interaction.editReply({ content: 'Konnte das Server-MOTD nicht abrufen.' });
        }
    } else if (interaction.commandName === 'setchannelnamestatus') {
        const serverAddress = interaction.options.getString('server-address');
        const channel = interaction.options.getChannel('channel');
        const prefix = interaction.options.getString('prefix') || 'online-';

        if (!serverAddress) {
            return interaction.reply('Bitte gib eine Server-Adresse an.');
        }
        if (!(channel instanceof TextChannel)) {
            return interaction.reply('Bitte gib einen gültigen Textkanal an.');
        }

        console.log(`Handling /setchannelnamestatus command for server: ${serverAddress} and channel: ${channel.name}`);
        await interaction.deferReply();

        const apiUrl = `${apiBaseUrl}/${serverAddress}`;

        try {
            console.log('Fetching initial server player count...');
            const response = await axios.get(apiUrl);
            const serverStatus = response.data;

            console.log(`Initial server player count: ${serverStatus.players.online}`);

            let newChannelName;
            if (serverStatus.online) {
                newChannelName = `${prefix}-${serverStatus.players.online}-spielen`;
            } else {
                newChannelName = 'offline';
            }
            
            await channel.setName(newChannelName);
            console.log(`Initial channel name set to "${newChannelName}"`);

            await interaction.editReply('Der Kanalname wird nun entsprechend der Spielerzahl aktualisiert.');

            // Bestehende Nachricht für das Umbenennen des Kanals suchen und nach 1 Minute löschen
            const messages = await channel.messages.fetch({ limit: 10 });
            const renameMessage = messages.find(msg => msg.content === 'Der Kanalname wird nun entsprechend der Spielerzahl aktualisiert.');
            if (renameMessage) {
                setTimeout(async () => {
                    await renameMessage.delete();
                }, 60000); // Nachricht nach 1 Minute löschen
            }

            const statusData = {
                channelStatuses: {
                    [processId]: {
                        serverAddress: serverAddress,
                        prefix: prefix,
                        channelId: channel.id
                    }
                }
            };

            // Speichern des Status
            saveStatus(statusData);

            setInterval(async () => {
                try {
                    console.log('Updating channel name with player count...');
                    const updatedResponse = await axios.get(apiUrl);
                    const updatedStatus = updatedResponse.data;
                    let updatedChannelName;
                    if (updatedStatus.online) {
                        updatedChannelName = `${prefix}-${updatedStatus.players.online}-spielen`;
                    } else {
                        updatedChannelName = 'offline';
                    }
                    if (channel.name !== updatedChannelName) {
                        await channel.setName(updatedChannelName);
                        console.log(`Channel name updated to "${updatedChannelName}"`);
                        // Status speichern
                        saveStatus({
                            channelStatuses: {
                                [processId]: {
                                    serverAddress: serverAddress,
                                    prefix: prefix,
                                    channelId: channel.id
                                }
                            }
                        });
                    } else {
                        console.log(`Channel name "${updatedChannelName}" is already up-to-date`);
                    }
                } catch (error) {
                    console.error('Error updating channel name with player count:', error);
                }
            }, channelUpdateInterval);

        } catch (error) {
            console.error('Error fetching player count:', error);
            await interaction.editReply({ content: 'Konnte die Spieleranzahl nicht abrufen.' });
        }
    }
});

client.login(process.env.TOKEN);
