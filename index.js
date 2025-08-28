import { voiceClient } from "./client.js";
import { addNewToken, loadAllTokens, removeToken, getTokensInfo, getAllTokens } from "./tokens-storage.js";
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 5000;
let url = "";
let uptimeDate = Date.now();
let requests = 0;
let response = null;

// Store logs and commands
let logs = [];
let commands = [];
const maxLogs = 500;
const maxCommands = 100;

// Advanced Bot management
let connectedBots = [];
let spamSettings = {
    active: false,
    message: "",
    interval: 5000, // Default 5 seconds
    timeoutIds: []
};

// Enhanced connection management for large-scale bot operations
const CONNECTION_POOL = {
    maxConcurrentConnections: 20, // Increased for better scaling
    connectionDelay: 2000, // Reduced delay for faster connection
    reconnectDelay: 60000, // 1 minute before reconnecting failed bots
    maxReconnectAttempts: 5, // More reconnection attempts
    activeConnections: 0,
    failedBots: [],
    connectionQueue: [],
    staggeredDelay: 500, // Staggered connection timing
    batchSize: 5 // Connect bots in batches
};

// Advanced bot rotation and IP protection system
const BOT_ROTATION = {
    enabled: true,
    rotationInterval: 180000, // 3 minutes - more frequent rotation
    maxBotsPerRotation: 5, // Rotate more bots at once
    currentRotationIndex: 0,
    randomDelay: true, // Add random delays
    userAgentRotation: true, // Rotate user agents
    connectionSpread: true // Spread connections over time
};

// Anti-detection measures
const ANTI_DETECTION = {
    randomUserAgents: [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ],
    connectionJitter: 3000, // Random delay up to 3 seconds
    messagePadding: true, // Add invisible characters to messages
    statusRotation: ['online', 'idle', 'dnd'], // Rotate status
    currentUserAgent: 0
};

// User management
const MAIN_ADMIN_ID = '1297633438584799335'; // Main admin who can add/remove users
let authorizedUsers = [MAIN_ADMIN_ID]; // List of users who can control the bot

// Emoji management
let reactionEmojis = ['☄']; // Default emoji
let autoReactEnabled = true; // Auto reaction toggle
const EMOJIS_FILE = './emojis.json';

// Load emojis from file on startup
async function loadEmojis() {
    try {
        const data = await fs.readFile(EMOJIS_FILE, 'utf8');
        const savedData = JSON.parse(data);
        reactionEmojis = savedData.emojis || ['☄'];
        autoReactEnabled = savedData.autoReactEnabled !== undefined ? savedData.autoReactEnabled : true;
        console.log(`✅ Loaded ${reactionEmojis.length} emojis from file`);
    } catch (error) {
        console.log(`⚠️ No emoji file found, using defaults`);
        await saveEmojis(); // Create initial file
    }
}

// Save emojis to file
async function saveEmojis() {
    try {
        const dataToSave = {
            emojis: reactionEmojis,
            autoReactEnabled: autoReactEnabled
        };
        await fs.writeFile(EMOJIS_FILE, JSON.stringify(dataToSave, null, 2), 'utf8');
        console.log(`💾 Saved ${reactionEmojis.length} emojis to file`);
    } catch (error) {
        console.error(`❌ Failed to save emojis: ${error.message}`);
    }
}

// Override console.log to capture logs
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

function captureLog(message, type = 'log') {
    logs.push(message);
    if (logs.length > maxLogs) {
        logs = logs.slice(-maxLogs);
    }
}

console.log = (...args) => {
    const message = args.join(' ');
    captureLog(message, 'log');
    originalLog(...args);
};

console.error = (...args) => {
    const message = args.join(' ');
    captureLog(message, 'error');
    originalError(...args);
};

console.warn = (...args) => {
    const message = args.join(' ');
    captureLog(message, 'warn');
    originalWarn(...args);
};

app.use(express.static('public'));
app.use(express.json());

app.use((req, res, next) => {
    const hostname = req.hostname;
    const subdomain = hostname.split('.')[0];
    const domain = hostname.replace(`${subdomain}.`, '');
    req.subdomain = subdomain;
    req.domain = domain;
    url = `https://${subdomain}.${domain}/`;
    next();
});

// API endpoints
app.get('/api/logs', async (req, res) => {
    try {
        const tokensInfo = await getTokensInfo();

        const responseData = {
            logs: logs.slice(-50) || [],
            commands: commands.slice(-20) || [],
            requests: requests || 0,
            uptime: Date.now() - uptimeDate,
            spamStatus: spamSettings.active || false,
            connectedBots: connectedBots.length || 0,
            totalBots: cleanTokens.length || 0,
            failedBots: CONNECTION_POOL.failedBots.length || 0,
            queuedBots: CONNECTION_POOL.connectionQueue.length || 0,
            activeConnections: CONNECTION_POOL.activeConnections || 0,
            tokensInfo: tokensInfo || { totalTokens: 0, tokens: [] }
        };

        res.json(responseData);
    } catch (error) {
        console.error('❌ Error in /api/logs endpoint:', error);
        res.status(500).json({
            error: 'Internal server error',
            logs: [],
            commands: [],
            requests: 0,
            uptime: Date.now() - uptimeDate,
            spamStatus: false,
            connectedBots: 0,
            totalBots: 0,
            failedBots: 0,
            queuedBots: 0,
            activeConnections: 0,
            tokensInfo: { totalTokens: 0, tokens: [] }
        });
    }
});

// New endpoint for advanced bot management
app.get('/api/bots/status', (req, res) => {
    const botStatus = connectedBots.map(bot => ({
        id: bot.id,
        username: bot.username,
        connected: bot.connected,
        lastActivity: bot.lastActivity,
        userId: bot.client ? bot.client.user_id : null
    }));

    res.json({
        connected: botStatus,
        failed: CONNECTION_POOL.failedBots.map(fb => ({
            index: fb.index + 1,
            attempts: fb.attempts,
            lastTry: fb.lastTry
        })),
        queued: CONNECTION_POOL.connectionQueue.length,
        totalManaged: cleanTokens.length
    });
});

// Endpoint to force reconnect all bots
app.post('/api/bots/reconnect', (req, res) => {
    console.log('🔄 Manual reconnection requested for all bots');

    // Disconnect all current bots
    connectedBots.forEach(bot => {
        if (bot.client && bot.client.ws) {
            bot.client.disconnect();
        }
    });

    // Clear all arrays
    connectedBots.length = 0;
    CONNECTION_POOL.failedBots.length = 0;
    CONNECTION_POOL.connectionQueue.length = 0;
    CONNECTION_POOL.activeConnections = 0;

    // Re-add all bots to queue
    for (let i = 0; i < cleanTokens.length; i++) {
        addToConnectionQueue(i, cleanTokens[i]);
    }

    // Start processing
    setTimeout(() => processConnectionQueue(), 2000);

    res.json({ success: true, message: 'All bots queued for reconnection' });
});

app.post('/api/command', async (req, res) => {
    const { command } = req.body;

    try {
        requests++;

        if (!command || !command.startsWith('=')) {
            return res.json({ success: false, error: 'Command must start with =' });
        }

        const result = await processCommand(command);
        commands.push(`${command} - ${result.success ? 'SUCCESS' : 'FAILED'}`);

        if (commands.length > maxCommands) {
            commands = commands.slice(-maxCommands);
        }

        res.json(result);
    } catch (error) {
        console.error('Command execution error:', error);
        res.json({ success: false, error: error.message });
    }
});

app.post('/api/clear-logs', (req, res) => {
    try {
        logs.length = 0;
        commands.length = 0;
        console.log('✅ All logs and commands cleared via API');
        res.json({ success: true, message: 'Logs cleared successfully' });
    } catch (error) {
        console.error('Failed to clear logs:', error);
        res.json({ success: false, error: error.message });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Command processor
async function processCommand(command, userId = null, context = null) {
    const parts = command.substring(1).split(' ');
    const cmd = parts[0].toLowerCase();

    switch(cmd) {
        case 'spam':
            if (parts.length < 2) {
                return { success: false, error: 'Usage: =spam <message>' };
            }
            const message = parts.slice(1).join(' ');
            spamSettings.message = message;
            startSpam();
            console.log(`✅ Spam started with message: "${message}"`);
            return { success: true, message: `Spam started with message: "${message}"` };

        case 'timespam':
            if (parts.length < 2) {
                return { success: false, error: 'Usage: =timespam <number><s|m|h>' };
            }
            const timeInput = parts[1];
            const timeResult = parseTime(timeInput);
            if (!timeResult.success) {
                return timeResult;
            }
            spamSettings.interval = timeResult.milliseconds;
            console.log(`✅ Spam interval set to ${timeResult.milliseconds}ms`);
            return { success: true, message: `Spam interval set to ${timeInput}` };

        case 'spamoff':
            stopSpam();
            console.log(`❌ Spam stopped`);
            return { success: true, message: 'Spam stopped' };

        case 'join':
            // Handle different join scenarios
            if (parts.length < 2) {
                return { success: false, error: 'Usage: =join <channel_id> [server_id] أو =join here' };
            }

            // Check if user wants to join current voice channel
            if (parts[1].toLowerCase() === 'here') {
                if (!context || !context.channelId || !context.guildId) {
                    return { success: false, error: 'لا يمكن تحديد الفويس الحالي. تأكد من كتابة الأمر في فويس تشات.' };
                }

                console.log(`🎯 Joining current voice channel: ${context.channelId} in server ${context.guildId}`);
                const result = changeVoiceChannel(context.channelId, context.guildId);
                return result;
            }

            // Regular join with channel ID
            const channelId = parts[1];
            const serverId = parts[2] || (context ? context.guildId : null);
            
            if (!/^\d+$/.test(channelId)) {
                return { success: false, error: 'Channel ID must be a valid number' };
            }
            if (serverId && !/^\d+$/.test(serverId)) {
                return { success: false, error: 'Server ID must be a valid number' };
            }
            
            console.log(`🎯 Joining specified voice channel: ${channelId} in server ${serverId || 'current'}`);
            const result = changeVoiceChannel(channelId, serverId);
            return result;

        case 'leave':
            const leaveResult = leaveVoiceChannels();
            return leaveResult;

        case 'addbot':
            if (parts.length < 4) {
                return { success: false, error: 'Usage: =addbot <token> <serverId> <channelId>' };
            }
            const newToken = parts[1];
            const newServerId = parts[2];
            const newChannelId = parts[3];
            const addBotResult = await addNewToken(newToken, newServerId, newChannelId);
            if (addBotResult.success) {
                // إعادة تحميل التوكنات وإعادة تشغيل الاتصالات
                await reloadTokensAndReconnect();
                return { 
                    success: true, 
                    message: `Bot ${addBotResult.tokenKey} added successfully! Reconnecting all bots...` 
                };
            }
            return addBotResult;

        case 'reon':
            autoReactEnabled = true;
            await saveEmojis();
            console.log(`✅ Auto reaction enabled`);
            return { success: true, message: 'Auto reaction enabled' };

        case 'reoff':
            autoReactEnabled = false;
            await saveEmojis();
            console.log(`❌ Auto reaction disabled`);
            return { success: true, message: 'Auto reaction disabled' };

        case 'addimoji':
            if (parts.length < 2) {
                return { success: false, error: 'Usage: =addimoji <emoji>' };
            }
            const newEmoji = parts[1];
            if (!reactionEmojis.includes(newEmoji)) {
                reactionEmojis.push(newEmoji);
                await saveEmojis();
                console.log(`✅ Added emoji: ${newEmoji}`);
                return { success: true, message: `Added emoji: ${newEmoji}` };
            } else {
                return { success: false, error: 'Emoji already exists' };
            }

        case 'menuimoji':
            if (reactionEmojis.length === 0) {
                return { success: true, message: 'No emojis in list' };
            }
            const emojiList = reactionEmojis.map((emoji, index) => `${index + 1}. ${emoji}`).join('\n');
            console.log(`📋 Emoji list:\n${emojiList}`);
            return { success: true, message: `Emoji list:\n${emojiList}` };

        case 'removeimoji':
            if (parts.length < 2) {
                return { success: false, error: 'Usage: =removeimoji <number>' };
            }
            const emojiIndex = parseInt(parts[1]) - 1;
            if (emojiIndex < 0 || emojiIndex >= reactionEmojis.length) {
                return { success: false, error: 'Invalid emoji number' };
            }
            const removedEmoji = reactionEmojis.splice(emojiIndex, 1)[0];
            await saveEmojis();
            console.log(`❌ Removed emoji: ${removedEmoji}`);
            return { success: true, message: `Removed emoji: ${removedEmoji}` };

        case 'adduser':
            // Only main admin can add users
            if (userId && userId !== MAIN_ADMIN_ID) {
                return { success: false, error: 'Only main admin can add users' };
            }
            if (parts.length < 2) {
                return { success: false, error: 'Usage: =adduser <user_id>' };
            }
            const newUserId = parts[1];
            if (!/^\d+$/.test(newUserId)) {
                return { success: false, error: 'User ID must be a valid number' };
            }
            if (!authorizedUsers.includes(newUserId)) {
                authorizedUsers.push(newUserId);
                console.log(`✅ Added user: ${newUserId}`);
                return { success: true, message: `Added user: ${newUserId}` };
            } else {
                return { success: false, error: 'User already authorized' };
            }

        case 'removeuser':
            // Only main admin can remove users
            if (userId && userId !== MAIN_ADMIN_ID) {
                return { success: false, error: 'Only main admin can remove users' };
            }
            if (parts.length < 2) {
                return { success: false, error: 'Usage: =removeuser <user_id>' };
            }
            const removeUserId = parts[1];
            if (removeUserId === MAIN_ADMIN_ID) {
                return { success: false, error: 'Cannot remove main admin' };
            }
            const userIndex = authorizedUsers.indexOf(removeUserId);
            if (userIndex > -1) {
                authorizedUsers.splice(userIndex, 1);
                console.log(`❌ Removed user: ${removeUserId}`);
                return { success: true, message: `Removed user: ${removeUserId}` };
            } else {
                return { success: false, error: 'User not found in authorized list' };
            }

        case 'menuuser':
            if (authorizedUsers.length === 0) {
                return { success: true, message: 'No authorized users' };
            }
            const userList = authorizedUsers.map((userId, index) => {
                const role = userId === MAIN_ADMIN_ID ? ' (Main Admin)' : '';
                return `${index + 1}. ${userId}${role}`;
            }).join('\n');
            console.log(`👥 Authorized users:\n${userList}`);
            return { success: true, message: `Authorized users:\n${userList}` };

        case 'botstatus':
            const botStatusInfo = await getTokensInfo();
            const status = `🤖 Bot Status:
Connected: ${connectedBots.length}
Failed: ${CONNECTION_POOL.failedBots.length}
Queued: ${CONNECTION_POOL.connectionQueue.length}
Active Tokens: ${botStatusInfo.totalTokens}
Available Slots: ${botStatusInfo.availableSlots}
Max Tokens: ${botStatusInfo.maxTokens}
Active Connections: ${CONNECTION_POOL.activeConnections}/${CONNECTION_POOL.maxConcurrentConnections}`;
            console.log(status);
            return { success: true, message: status };

        case 'forcereconnect':
            console.log('🔄 Force reconnecting all bots');

            // Disconnect all current bots
            connectedBots.forEach(bot => {
                if (bot.client && bot.client.ws) {
                    bot.client.disconnect();
                }
            });

            // Clear and reset
            connectedBots.length = 0;
            CONNECTION_POOL.failedBots.length = 0;
            CONNECTION_POOL.connectionQueue.length = 0;
            CONNECTION_POOL.activeConnections = 0;

            // Re-queue all bots
            for (let i = 0; i < cleanTokens.length; i++) {
                addToConnectionQueue(i, cleanTokens[i]);
            }

            setTimeout(() => processConnectionQueue(), 2000);
            return { success: true, message: 'All bots queued for reconnection' };

        case 'setrotation':
            if (parts.length < 2) {
                return { success: false, error: 'Usage: =setrotation <on|off>' };
            }
            const rotationState = parts[1].toLowerCase();
            if (rotationState === 'on') {
                BOT_ROTATION.enabled = true;
                console.log(`✅ Bot rotation enabled`);
                return { success: true, message: 'Bot rotation enabled' };
            } else if (rotationState === 'off') {
                BOT_ROTATION.enabled = false;
                console.log(`❌ Bot rotation disabled`);
                return { success: true, message: 'Bot rotation disabled' };
            } else {
                return { success: false, error: 'Use "on" or "off"' };
            }

        case 'removebot':
            if (parts.length < 2) {
                return { success: false, error: 'Usage: =removebot <token_key>' };
            }
            const tokenKeyToRemove = parts[1];
            const removeBotResult = await removeToken(tokenKeyToRemove);
            if (removeBotResult.success) {
                await reloadTokensAndReconnect();
                return { 
                    success: true, 
                    message: `Bot ${tokenKeyToRemove} removed successfully! Reconnecting remaining bots...` 
                };
            }
            return removeBotResult;

        case 'listtokens':
            const tokensInfo = await getTokensInfo();
            if (tokensInfo.totalTokens === 0) {
                return { success: true, message: 'No tokens found' };
            }
            const tokensList = tokensInfo.tokens.map((token, index) => 
                `${index + 1}. ${token.tokenKey} - Server: ${token.serverId} - Channel: ${token.channelId}`
            ).join('\n');
            console.log(`📋 Tokens list:\n${tokensList}`);
            return { success: true, message: `Tokens list:\n${tokensList}` };

        case 'joinserver':
            if (parts.length < 2) {
                return { success: false, error: 'Usage: =joinserver <invite_link>' };
            }
            
            const inviteLink = parts[1];
            
            // Extract invite code from different invite formats
            let inviteCode = '';
            const inviteRegex = /(?:https?:\/\/)?(?:www\.)?discord(?:app)?\.(?:gg|com)\/invite\/([a-zA-Z0-9]+)/;
            const shortRegex = /(?:https?:\/\/)?discord\.gg\/([a-zA-Z0-9]+)/;
            
            const match = inviteLink.match(inviteRegex) || inviteLink.match(shortRegex);
            if (match) {
                inviteCode = match[1];
            } else {
                // Maybe it's just the code
                if (/^[a-zA-Z0-9]+$/.test(inviteLink)) {
                    inviteCode = inviteLink;
                } else {
                    return { success: false, error: 'Invalid invite link format' };
                }
            }
            
            console.log(`🚪 Attempting to join server using invite code: ${inviteCode}`);
            const joinResult = await joinServerWithBots(inviteCode);
            return joinResult;

        case 'cmnd':
            const commandsList = `📋 Available Commands:

🔥 SPAM COMMANDS:
=spam <message> - Start spam with message
=timespam <time> - Set spam interval (5s, 2m, 1h)
=spamoff - Stop spam

🎤 VOICE COMMANDS:
=join <channel_id> [server_id] - Join voice channel
=join here - Join current voice channel
=leave - Leave voice channels

🚪 SERVER COMMANDS:
=joinserver <invite_link> - Join server using invite link

🤖 BOT MANAGEMENT:
=addbot <token> <server_id> <channel_id> - Add new bot
=removebot <token_key> - Remove bot
=listtokens - List all tokens
=botstatus - Show bot status
=forcereconnect - Reconnect all bots
=setrotation <on|off> - Bot rotation

😀 REACTION COMMANDS:
=reon - Enable auto reactions
=reoff - Disable auto reactions
=addimoji <emoji> - Add reaction emoji
=menuimoji - List reaction emojis
=removeimoji <number> - Remove emoji by number

👥 USER MANAGEMENT:
=adduser <user_id> - Add authorized user (admin only)
=removeuser <user_id> - Remove user (admin only)
=menuuser - List authorized users

ℹ️ INFO COMMANDS:
=cmnd - Show this command list`;

            console.log(commandsList);
            return { success: true, message: commandsList };

        default:
            return { success: false, error: 'Unknown command. Use =cmnd to see all available commands.' };
    }
}

function parseTime(timeStr) {
    const match = timeStr.match(/^(\d+)([smh])$/);
    if (!match) {
        return { success: false, error: 'Invalid time format. Use: number + s/m/h (e.g., 5s, 2m, 1h)' };
    }

    const value = parseInt(match[1]);
    const unit = match[2];

    let milliseconds;
    switch(unit) {
        case 's': milliseconds = value * 1000; break;
        case 'm': milliseconds = value * 60 * 1000; break;
        case 'h': milliseconds = value * 60 * 60 * 1000; break;
    }

    if (milliseconds < 1000) {
        return { success: false, error: 'Minimum interval is 1 second' };
    }

    return { success: true, milliseconds };
}

function startSpam() {
    if (!spamSettings.message) {
        console.log('❌ No spam message set');
        return;
    }

    if (connectedBots.length === 0) {
        console.log('❌ No connected bots available for spam');
        return;
    }

    stopSpam(); // Stop any existing spam
    spamSettings.active = true;

    console.log(`🚀 Starting spam with ${connectedBots.length} bots`);
    console.log(`📝 Message: "${spamSettings.message}"`);
    console.log(`⏱️ Interval: ${spamSettings.interval}ms`);

    connectedBots.forEach((bot, index) => {
        const timeoutId = setInterval(async () => {
            if (spamSettings.active && bot.client) {
                await sendMessage(bot.client, spamSettings.message);
            }
        }, spamSettings.interval + (index * 500)); // Slight delay between bots

        spamSettings.timeoutIds.push(timeoutId);
    });
}

function stopSpam() {
    spamSettings.active = false;
    spamSettings.timeoutIds.forEach(id => clearInterval(id));
    spamSettings.timeoutIds = [];
}

function changeVoiceChannel(newChannelId, newServerId = null) {
    if (connectedBots.length === 0) {
        console.log('❌ No connected bots to change channel');
        return { success: false, error: 'No connected bots available' };
    }

    let successCount = 0;
    connectedBots.forEach((bot) => {
        if (bot.client && bot.client.ws) {
            // Update the channel ID
            bot.client.channelId = newChannelId;

            // Update server ID if provided
            if (newServerId) {
                bot.client.guildId = newServerId;
            }

            // Send voice state update to join new channel
            const voiceStateUpdate = {
                op: 4,
                d: {
                    guild_id: newServerId || bot.client.guildId,
                    channel_id: newChannelId,
                    self_mute: bot.client.selfMute,
                    self_deaf: bot.client.selfDeaf
                }
            };

            bot.client.ws.send(JSON.stringify(voiceStateUpdate));
            successCount++;

            if (newServerId) {
                console.log(`🔄 Bot ${bot.id} switching to channel ${newChannelId} in server ${newServerId}`);
            } else {
                console.log(`🔄 Bot ${bot.id} switching to channel ${newChannelId}`);
            }
        }
    });

    if (successCount > 0) {
        const serverInfo = newServerId ? ` in server ${newServerId}` : '';
        console.log(`✅ ${successCount} bot(s) switching to channel ${newChannelId}${serverInfo}`);
        return { success: true, message: `${successCount} bot(s) switching to channel ${newChannelId}${serverInfo}` };
    } else {
        console.log('❌ Failed to switch channels - no active connections');
        return { success: false, error: 'No active bot connections found' };
    }
}

function leaveVoiceChannels() {
    if (connectedBots.length === 0) {
        console.log('❌ No connected bots to disconnect');
        return { success: false, error: 'No connected bots available' };
    }

    let successCount = 0;
    connectedBots.forEach((bot) => {
        if (bot.client && bot.client.ws) {
            // Send voice state update to leave voice channel (null channel_id)
            const voiceStateUpdate = {
                op: 4,
                d: {
                    guild_id: bot.client.guildId,
                    channel_id: null,
                    self_mute: bot.client.selfMute,
                    self_deaf: bot.client.selfDeaf
                }
            };

            bot.client.ws.send(JSON.stringify(voiceStateUpdate));
            successCount++;
            console.log(`👋 Bot ${bot.id} leaving voice channel`);
        }
    });

    if (successCount > 0) {
        console.log(`✅ ${successCount} bot(s) left voice channels`);
        return { success: true, message: `${successCount} bot(s) left voice channels` };
    } else {
        console.log('❌ Failed to leave channels - no active connections');
        return { success: false, error: 'No active bot connections found' };
    }
}

// إعادة تحميل التوكنات وإعادة الاتصال
async function reloadTokensAndReconnect() {
    console.log('🔄 Reloading tokens and reconnecting all bots');

    // قطع الاتصال مع جميع البوتات الحالية
    connectedBots.forEach(bot => {
        if (bot.client && bot.client.ws) {
            bot.client.disconnect();
        }
    });

    // مسح جميع المصفوفات
    connectedBots.length = 0;
    CONNECTION_POOL.failedBots.length = 0;
    CONNECTION_POOL.connectionQueue.length = 0;
    CONNECTION_POOL.activeConnections = 0;

    // تحميل التوكنات الجديدة
    const newTokens = await loadAllTokens();
    cleanTokens.length = 0;
    cleanTokens.push(...newTokens.filter(token => 
        token?.token && token?.token?.length > 30 && token?.channelId && token?.serverId
    ));

    console.log(`📊 Loaded ${cleanTokens.length} valid tokens`);

    // إضافة جميع البوتات إلى قائمة الانتظار
    for (let i = 0; i < cleanTokens.length; i++) {
        addToConnectionQueue(i, cleanTokens[i]);
    }

    // بدء معالجة قائمة الانتظار
    setTimeout(() => processConnectionQueue(), 2000);
}

function generateRandomSuffix() {
    const chars = ['ㅤ', '⠀', '‌', '‍', '⁣', '⁡', '⁢', '⁤', '‎', '‏', '︎', '️', '᠎'];
    const symbols = ['ᅟ', 'ᅠ', '⃤', '⃥', '⃦', '⃧', '⃨', '⃩', '⃪', '⃫'];
    const numbers = ['₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉', '₀'];

    const allChars = [...chars, ...symbols, ...numbers];
    const suffixLength = Math.floor(Math.random() * 3) + 1; // 1-3 characters

    let suffix = ' ';
    for (let i = 0; i < suffixLength; i++) {
        suffix += allChars[Math.floor(Math.random() * allChars.length)];
    }

    return suffix;
}

async function sendMessage(client, message, deleteAfter = null) {
    if (!client.channelId || !client.token) return;

    const url = `https://discord.com/api/v10/channels/${client.channelId}/messages`;

    // Enhanced anti-detection message formatting
    const messageWithSuffix = message + generateRandomSuffix();

    // Get rotating user agent
    const userAgent = ANTI_DETECTION.randomUserAgents[ANTI_DETECTION.currentUserAgent % ANTI_DETECTION.randomUserAgents.length];
    ANTI_DETECTION.currentUserAgent++;

    try {
        // Add random delay before sending (0-1 second)
        await new Promise(resolve => setTimeout(resolve, Math.random() * 1000));

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': client.token,
                'Content-Type': 'application/json',
                'User-Agent': userAgent,
                'X-RateLimit-Precision': 'millisecond',
                'X-Super-Properties': 'eyJvcyI6IldpbmRvd3MiLCJicm93c2VyIjoiQ2hyb21lIiwiZGV2aWNlIjoiIiwic3lzdGVtX2xvY2FsZSI6ImVuLVVTIiwiYnJvd3Nlcl91c2VyX2FnZW50IjoiTW96aWxsYS81LjAifQ=='
            },
            body: JSON.stringify({
                content: messageWithSuffix,
                tts: false,
                flags: 0
            })
        });

        if (response.ok) {
            const responseData = await response.json();
            const messageId = responseData.id;
            console.log(`📤 Bot ${client.user_id || 'Unknown'}: "${message}" ✅`);

            // Delete message after specified time if requested
            if (deleteAfter && messageId) {
                setTimeout(async () => {
                    await deleteMessage(client, client.channelId, messageId);
                }, deleteAfter);
            }
        } else {
            const errorText = await response.text();
            console.error(`❌ Bot ${client.user_id} failed to send message (${response.status}): ${errorText}`);

            // If unauthorized, stop spam for this bot
            if (response.status === 401) {
                console.error(`🚫 Bot ${client.user_id} has invalid token - removing from active bots`);
                stopSpam();
            }
        }
    } catch (error) {
        console.error(`❌ Failed to send message: ${error.message}`);
    }
}

async function deleteMessage(client, channelId, messageId) {
    if (!client.token) return;

    const url = `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`;

    try {
        const response = await fetch(url, {
            method: 'DELETE',
            headers: {
                'Authorization': client.token,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        if (response.ok || response.status === 204) {
            console.log(`🗑️ Deleted message ${messageId} in channel ${channelId}`);
        } else {
            console.error(`❌ Failed to delete message ${messageId} (${response.status})`);
        }
    } catch (error) {
        console.error(`❌ Failed to delete message: ${error.message}`);
    }
}

function isMainAdmin(userId = null) {
    // If no userId provided, we can't check in voice chat commands
    // This function is mainly for API commands where we know the user
    return userId === MAIN_ADMIN_ID;
}

// دالة للانضمام إلى سيرفر باستخدام رابط الدعوة
async function joinServerWithBots(inviteCode) {
    if (connectedBots.length === 0) {
        console.log('❌ No connected bots available to join server');
        return { success: false, error: 'No connected bots available' };
    }

    let successCount = 0;
    let failedCount = 0;
    const results = [];

    console.log(`🚪 Starting server join process with ${connectedBots.length} bots`);

    for (const bot of connectedBots) {
        if (!bot.client || !bot.client.token) {
            failedCount++;
            results.push(`Bot ${bot.id}: No valid client`);
            continue;
        }

        try {
            // Get rotating user agent
            const userAgent = ANTI_DETECTION.randomUserAgents[ANTI_DETECTION.currentUserAgent % ANTI_DETECTION.randomUserAgents.length];
            ANTI_DETECTION.currentUserAgent++;

            // Add random delay between requests (1-3 seconds)
            await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));

            const response = await fetch(`https://discord.com/api/v10/invites/${inviteCode}`, {
                method: 'POST',
                headers: {
                    'Authorization': bot.client.token,
                    'Content-Type': 'application/json',
                    'User-Agent': userAgent,
                    'X-RateLimit-Precision': 'millisecond'
                },
                body: JSON.stringify({})
            });

            if (response.ok) {
                const serverData = await response.json();
                successCount++;
                console.log(`✅ Bot ${bot.id} (${bot.username}) successfully joined server: ${serverData.guild?.name || 'Unknown'}`);
                results.push(`Bot ${bot.id}: ✅ Joined ${serverData.guild?.name || 'Unknown'}`);
            } else {
                const errorText = await response.text();
                let errorData = {};
                try {
                    errorData = JSON.parse(errorText);
                } catch (e) {
                    errorData = { message: errorText };
                }

                failedCount++;
                
                if (response.status === 400 && errorData.code === 10006) {
                    console.log(`⚠️ Bot ${bot.id}: Invite expired or invalid`);
                    results.push(`Bot ${bot.id}: ⚠️ Invalid/expired invite`);
                } else if (response.status === 403) {
                    console.log(`⚠️ Bot ${bot.id}: No permission or banned`);
                    results.push(`Bot ${bot.id}: ⚠️ No permission/banned`);
                } else if (response.status === 429) {
                    console.log(`⚠️ Bot ${bot.id}: Rate limited`);
                    results.push(`Bot ${bot.id}: ⚠️ Rate limited`);
                } else if (response.status === 401) {
                    console.log(`❌ Bot ${bot.id}: Invalid token`);
                    results.push(`Bot ${bot.id}: ❌ Invalid token`);
                } else {
                    console.log(`❌ Bot ${bot.id} failed to join: ${response.status} ${errorData.message || errorText}`);
                    results.push(`Bot ${bot.id}: ❌ ${response.status} ${errorData.message || 'Unknown error'}`);
                }
            }

            // Additional delay to avoid rate limits
            await new Promise(resolve => setTimeout(resolve, 1500));

        } catch (error) {
            failedCount++;
            console.error(`❌ Bot ${bot.id} error: ${error.message}`);
            results.push(`Bot ${bot.id}: ❌ ${error.message}`);
        }
    }

    const resultMessage = `🚪 Server Join Results:
✅ Successfully joined: ${successCount} bots
❌ Failed: ${failedCount} bots

Details:
${results.join('\n')}`;

    console.log(resultMessage);
    
    if (successCount > 0) {
        return { success: true, message: resultMessage };
    } else {
        return { success: false, error: resultMessage };
    }
}

async function reactToMessage(client, channelId, messageId) {
    if (!client.token || !autoReactEnabled || reactionEmojis.length === 0) {
        console.log(`🔇 Auto react disabled or no emojis available`);
        return;
    }

    console.log(`🎭 Starting auto react for message ${messageId} in channel ${channelId} with ${reactionEmojis.length} emojis`);
    console.log(`📋 Emojis to use: ${reactionEmojis.join(', ')}`);

    // Get rotating user agent for reactions
    const userAgent = ANTI_DETECTION.randomUserAgents[ANTI_DETECTION.currentUserAgent % ANTI_DETECTION.randomUserAgents.length];
    ANTI_DETECTION.currentUserAgent++;

    // React with all emojis in the list
    for (const emoji of reactionEmojis) {
        try {
            let encodedEmoji;
            let isCustomEmoji = false;

            // Enhanced custom emoji detection and formatting
            const customEmojiMatch = emoji.match(/^<(a?):([^:]+):(\d+)>$/);

            if (customEmojiMatch) {
                const isAnimated = customEmojiMatch[1] === 'a';
                const emojiName = customEmojiMatch[2];
                const emojiId = customEmojiMatch[3];

                // For custom emojis, use name:id format for API calls
                encodedEmoji = `${emojiName}:${emojiId}`;
                isCustomEmoji = true;

                console.log(`🎭 Processing custom emoji: ${emojiName} (ID: ${emojiId}, Animated: ${isAnimated})`);
            } else {
                // Regular Unicode emoji
                encodedEmoji = encodeURIComponent(emoji);
                isCustomEmoji = false;
                console.log(`😀 Processing Unicode emoji: ${emoji}`);
            }

            const url = `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}/reactions/${encodedEmoji}/@me`;
            console.log(`🌐 Reaction URL: ${url}`);

            // Add random delay between reactions (500-1000ms)
            await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 500));

            const response = await fetch(url, {
                method: 'PUT',
                headers: {
                    'Authorization': client.token,
                    'Content-Type': 'application/json',
                    'User-Agent': userAgent,
                    'X-RateLimit-Precision': 'millisecond'
                }
            });

            if (response.ok || response.status === 204) {
                console.log(`✅ Bot ${client.user_id || 'Unknown'} successfully reacted with ${emoji}`);
            } else {
                const errorText = await response.text();
                let errorData = {};
                try {
                    errorData = JSON.parse(errorText);
                } catch (e) {
                    errorData = { message: errorText };
                }

                if (isCustomEmoji && (errorData.code === 10014 || errorData.code === 50001 || response.status === 400 || response.status === 403)) {
                    console.log(`⚠️ Bot cannot use custom emoji ${emoji} (server restriction or permission issue)`);
                } else {
                    console.error(`❌ Bot failed to react with ${emoji} (Status: ${response.status})`);
                    console.error(`📄 Error details: ${JSON.stringify(errorData, null, 2)}`);
                }
            }

            // Delay between reactions to avoid rate limits
            await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
            console.error(`❌ Exception while reacting with ${emoji}: ${error.message}`);
        }
    }

    console.log(`🎭 Completed auto-reaction process for message ${messageId}`);
}

// Function to convert regular text to bold Unicode text
function toBoldUnicode(text) {
    const boldMap = {
        'A': '𝐀', 'B': '𝐁', 'C': '𝐂', 'D': '𝐃', 'E': '𝐄', 'F': '𝐅', 'G': '𝐆', 'H': '𝐇', 'I': '𝐈', 'J': '𝐉',
        'K': '𝐊', 'L': '𝐋', 'M': '𝐌', 'N': '𝐍', 'O': '𝐎', 'P': '𝐏', 'Q': '𝐐', 'R': '𝐑', 'S': '𝐒', 'T': '𝐓',
        'U': '𝐔', 'V': '𝐕', 'W': '𝐖', 'X': '𝐗', 'Y': '𝐘', 'Z': '𝐙',
        'a': '𝐚', 'b': '𝐛', 'c': '𝐜', 'd': '𝐝', 'e': '𝐞', 'f': '𝐟', 'g': '𝐠', 'h': '𝐡', 'i': '𝐢', 'j': '𝐣',
        'k': '𝐤', 'l': '𝐥', 'm': '𝐦', 'n': '𝐧', 'o': '𝐨', 'p': '𝐩', 'q': '𝐪', 'r': '𝐫', 's': '𝐬', 't': '𝐭',
        'u': '𝐮', 'v': '𝐯', 'w': '𝐰', 'x': '𝐱', 'y': '𝐲', 'z': '𝐳',
        '0': '𝟎', '1': '𝟏', '2': '𝟐', '3': '𝟑', '4': '𝟒', '5': '𝟓', '6': '𝟔', '7': '𝟕', '8': '𝟖', '9': '𝟗'
    };

    return text.split('').map(char => boldMap[char] || char).join('');
}

// Function to handle commands received in voice chat
async function handleVoiceChatCommand(command, channelId, userId = null, guildId = null, enhancedContext = null) {
    console.log(`🎤 Processing voice chat command: "${command}"`);
    console.log(`📍 Channel: ${channelId}, Guild: ${guildId}, User: ${userId}`);
    console.log(`👥 Authorized users: ${authorizedUsers.join(', ')}`);
    console.log(`🤖 Connected bots: ${connectedBots.length}`);

    // Store context for join command with enhanced info
    const commandContext = enhancedContext || { channelId, guildId, userId };
    console.log(`🔍 Enhanced context: ${JSON.stringify(commandContext)}`);
    
    const result = await processCommand(command, userId, commandContext);
    console.log(`📋 Command result: ${JSON.stringify(result)}`);

    // Find any connected bot to send response
    let responseBot = connectedBots.find(bot => bot.client && bot.client.token)?.client;

    if (responseBot) {
        let responseMessage;
        if (result.success) {
            responseMessage = `✅ ${toBoldUnicode(result.message || 'Command executed successfully')}`;
        } else {
            responseMessage = `❌ ${toBoldUnicode(result.error || 'Command failed')}`;
        }

        // Store original channel
        const originalChannel = responseBot.channelId;
        responseBot.channelId = channelId; // Temporarily set channel for response

        // Check if this is a spam command - if not, delete after 10 seconds
        const isSpamCommand = command.toLowerCase().includes('spam');
        const deleteAfter = isSpamCommand ? null : 10000; // 10 seconds for non-spam commands

        console.log(`📤 Sending response: "${responseMessage}"`);
        await sendMessage(responseBot, responseMessage, deleteAfter);
        
        // Restore original channel
        responseBot.channelId = originalChannel;
        
        console.log(`✅ Response sent successfully${deleteAfter ? ' (will auto-delete in 10s)' : ''}`);
    } else {
        console.error(`❌ No connected bots available to send response`);
    }
}

app.listen(port, '0.0.0.0', () => console.log(`🖥️ Console Interface running at ${url}`));

// Enhanced process monitoring for Replit deployment stability
process.on('uncaughtException', (err) => {
    console.error(`Uncaught Exception: ${err.message}`);
    // Don't exit - keep the application running on Replit
    console.log('🔄 Application will continue running on Replit hosting...');
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // Don't exit - keep the application running on Replit
    console.log('🔄 Application will continue running on Replit hosting...');
});

// Replit-specific health check and stability monitoring
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        uptime: Date.now() - uptimeDate,
        connectedBots: connectedBots.length,
        totalBots: cleanTokens.length,
        timestamp: new Date().toISOString(),
        platform: 'Replit'
    });
});

// Prevent Replit from sleeping the application
app.get('/ping', (req, res) => {
    res.status(200).send('pong');
});

// Auto-ping system to keep Replit deployment active
const REPLIT_PING_INTERVAL = 300000; // 5 minutes
setInterval(() => {
    if (url) {
        fetch(`${url}ping`)
            .then(response => {
                if (response.ok) {
                    console.log('🏓 Replit keep-alive ping successful');
                } else {
                    console.warn(`⚠️ Replit ping returned status: ${response.status}`);
                }
            })
            .catch(error => {
                console.warn(`⚠️ Replit ping failed: ${error.message}`);
            });
    }
}, REPLIT_PING_INTERVAL);

// Auto-reconnect system for deployment stability
setInterval(async () => {
    try {
        const tokens = await getAllTokens();
        if (tokens.length > 0 && connectedBots.length === 0 && CONNECTION_POOL.activeConnections === 0) {
            console.log('🔄 No bots connected - auto-restarting connections...');

            // Re-add all bots to connection queue
            for (let i = 0; i < tokens.length; i++) {
                addToConnectionQueue(i, tokens[i]);
            }

            // Start processing
            setTimeout(() => processConnectionQueue(), 2000);
        }
    } catch (error) {
        console.error('Auto-reconnect check failed:', error);
    }
}, 120000); // Check every 2 minutes

// Keep-alive system for deployment
setInterval(async () => {
    try {
        const tokens = await getAllTokens();
        console.log(`💓 Heartbeat - Bots: ${connectedBots.length}/${tokens.length} | Active: ${CONNECTION_POOL.activeConnections} | Failed: ${CONNECTION_POOL.failedBots.length}`);
    } catch (error) {
        console.error('Heartbeat check failed:', error);
    }
}, 300000); // Every 5 minutes

// Token validation function
async function validateToken(token) {
    try {
        const response = await fetch('https://discord.com/api/v10/users/@me', {
            headers: {
                'Authorization': token,
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            const userData = await response.json();
            console.log(`✅ Token validation successful: ${userData.username}#${userData.discriminator}`);
            return { valid: true, user: userData };
        } else {
            console.error(`❌ Token validation failed: ${response.status} ${response.statusText}`);
            return { valid: false, error: `${response.status} ${response.statusText}` };
        }
    } catch (error) {
        console.error(`❌ Token validation error: ${error.message}`);
        return { valid: false, error: error.message };
    }
}

// Initialize tokens function
async function initializeTokens() {
    try {
        const tokens = await getAllTokens();
        console.log(`📊 Total tokens found: ${tokens.length}`);

        // Validate each token
        const validTokens = [];
        for (const tokenData of tokens) {
            console.log(`🔍 Validating token: ${tokenData.tokenKey}`);
            const validation = await validateToken(tokenData.token);

            if (validation.valid) {
                validTokens.push(tokenData);
                console.log(`✅ Token ${tokenData.tokenKey} is valid`);
            } else {
                console.error(`❌ Token ${tokenData.tokenKey} is invalid: ${validation.error}`);
            }
        }

        console.log(`✅ Valid tokens loaded: ${validTokens.length}/${tokens.length}`);
        return validTokens;
    } catch (error) {
        console.error('❌ Failed to initialize tokens:', error.message);
        return [];
    }
}

// Load emojis on startup
loadEmojis();

// Initialize tokens on startup
initializeTokens();

// Placeholder for cleanTokens which will be populated by initializeTokens
let cleanTokens = []; 

// Function to manage bot reconnections
function startReconnectionSystem() {
    // This function might be expanded later for more complex reconnection logic
    console.log('⚙️ Reconnection system initialized');
}

// Function to manage bot rotation
function startBotRotation() {
    if (!BOT_ROTATION.enabled) {
        console.log('🔄 Bot rotation is disabled');
        return;
    }

    console.log(`🔄 Starting bot rotation system (Interval: ${BOT_ROTATION.rotationInterval / 1000}s)`);

    setInterval(async () => {
        console.log('🔄 Performing bot rotation...');
        // Implement bot rotation logic here (e.g., switching user agents, IPs if applicable)
        // For now, it's a placeholder.
    }, BOT_ROTATION.rotationInterval);
}

// Placeholder functions for connection management
function addToConnectionQueue(index, tokenData) {
    CONNECTION_POOL.connectionQueue.push({ index, tokenData });
}

async function processConnectionQueue() {
    if (CONNECTION_POOL.connectionQueue.length === 0) {
        // console.log('ℹ️ Connection queue is empty.');
        return;
    }

    if (CONNECTION_POOL.activeConnections >= CONNECTION_POOL.maxConcurrentConnections) {
        // console.log(`ℹ️ Max connections reached (${CONNECTION_POOL.activeConnections}/${CONNECTION_POOL.maxConcurrentConnections}). Waiting.`);
        return;
    }

    const botsToConnect = CONNECTION_POOL.connectionQueue.splice(0, CONNECTION_POOL.batchSize);

    for (const { index, tokenData } of botsToConnect) {
        const botId = index + 1; // Simple bot ID based on index
        const token = tokenData.token;
        const serverId = tokenData.serverId;
        const channelId = tokenData.channelId;

        if (connectedBots.some(bot => bot.id === botId)) {
            console.log(`ℹ️ Bot ${botId} is already connected. Skipping.`);
            continue;
        }

        // Simulate connection delay and jitter
        const delay = CONNECTION_POOL.connectionDelay + Math.random() * CONNECTION_POOL.staggeredDelay;
        await new Promise(resolve => setTimeout(resolve, delay));

        if (CONNECTION_POOL.activeConnections >= CONNECTION_POOL.maxConcurrentConnections) {
            console.log(`ℹ️ Max connections reached while processing queue. Re-queuing bot ${botId}.`);
            CONNECTION_POOL.connectionQueue.unshift({ index, tokenData }); // Add back to the front
            break; // Stop processing for this batch
        }

        console.log(`🚀 Connecting Bot ${botId} (Token: ${tokenData.tokenKey})...`);
        CONNECTION_POOL.activeConnections++;

        const client = new voiceClient({
            token: token,
            serverId: serverId,
            channelId: channelId,
            selfMute: false,
            selfDeaf: false,
            autoReconnect: {
                enabled: true,
                delay: 5,
                maxRetries: 5
            },
            presence: {
                status: "idle"
            }
        });

        client.connect();

        client.on('ready', (userData) => {
            console.log(`✅ Bot ${botId} connected: ${userData.username}#${userData.discriminator}`);
            connectedBots.push({ 
                id: botId, 
                client: client, 
                username: userData.username, 
                connected: true, 
                lastActivity: Date.now() 
            });
            const tokenIndex = cleanTokens.findIndex(t => t.token === token);
            if (tokenIndex > -1) {
                cleanTokens[tokenIndex] = { ...cleanTokens[tokenIndex], clientInstance: client };
            }
        });

        client.on('error', async (err) => {
            console.error(`❌ Bot ${botId} connection error: ${err.message}`);
            console.error(`🔍 Token: ${tokenData.tokenKey}, Server: ${serverId}, Channel: ${channelId}`);

            CONNECTION_POOL.activeConnections--;

            // Remove from connected bots if exists
            const connectedBotIndex = connectedBots.findIndex(bot => bot.id === botId);
            if (connectedBotIndex > -1) {
                connectedBots.splice(connectedBotIndex, 1);
            }

            const failedBot = CONNECTION_POOL.failedBots.find(fb => fb.index === index);
            if (failedBot) {
                failedBot.attempts++;
                failedBot.lastTry = Date.now();
            } else {
                CONNECTION_POOL.failedBots.push({ index, attempts: 1, lastTry: Date.now(), tokenKey: tokenData.tokenKey });
            }

            // Don't retry if token is invalid
            if (err.message.includes('401') || err.message.includes('Unauthorized') || err.message.includes('Invalid token')) {
                console.error(`🚫 Bot ${botId} has invalid token - not retrying`);
                return;
            }

            // Attempt to reconnect after a delay
            if (failedBot && failedBot.attempts >= CONNECTION_POOL.maxReconnectAttempts) {
                console.error(`❌ Bot ${botId} failed ${failedBot.attempts} times. Not attempting further reconnections.`);
                return;
            }

            setTimeout(() => {
                console.log(`🔄 Attempting to reconnect Bot ${botId} (Attempt ${failedBot ? failedBot.attempts + 1 : 1})...`);
                addToConnectionQueue(index, tokenData);
                processConnectionQueue();
            }, CONNECTION_POOL.reconnectDelay);
        });

        client.on('disconnected', () => {
            console.log(`👋 Bot ${botId} disconnected`);
            const connectedBotIndex = connectedBots.findIndex(bot => bot.id === botId);
            if (connectedBotIndex > -1) {
                connectedBots.splice(connectedBotIndex, 1);
            }
            CONNECTION_POOL.activeConnections--;

            // Only reconnect if it's not an invalid token
            setTimeout(() => {
                console.log(`🔄 Attempting to reconnect Bot ${botId}...`);
                addToConnectionQueue(index, tokenData);
                processConnectionQueue();
            }, CONNECTION_POOL.reconnectDelay);
        });

        // Add other event listeners as needed (e.g., message, voiceStateUpdate)
        client.on('message', async (message) => {
            console.log(`📝 Received message from ${message.author?.username || 'Unknown'}: "${message.content}"`);
            console.log(`🏢 Guild ID: ${message.guild_id}, Channel ID: ${message.channel_id}`);
            console.log(`👤 Author ID: ${message.author?.id}, Is Bot: ${message.author?.bot}`);
            
            if (!message.guild_id || !message.channel_id || message.author?.bot) return;

            // Handle voice chat commands first (for authorized users only)
            if (message.content.startsWith('=')) {
                console.log(`🎤 Command detected: ${message.content} from user ${message.author.id}`);
                
                // Check if user is authorized
                if (authorizedUsers.includes(message.author.id)) {
                    console.log(`✅ User ${message.author.id} is authorized for commands`);
                    
                    // Get channel information to determine if it's a voice channel
                    let isVoiceChannel = false;
                    try {
                        const channelResponse = await fetch(`https://discord.com/api/v10/channels/${message.channel_id}`, {
                            headers: {
                                'Authorization': client.token,
                                'Content-Type': 'application/json'
                            }
                        });
                        
                        if (channelResponse.ok) {
                            const channelData = await channelResponse.json();
                            isVoiceChannel = channelData.type === 2; // Type 2 = Voice Channel
                            console.log(`📍 Channel type: ${channelData.type} (${isVoiceChannel ? 'Voice' : 'Text'})`);
                        }
                    } catch (error) {
                        console.warn(`⚠️ Could not fetch channel info: ${error.message}`);
                    }
                    
                    try {
                        // Create enhanced context with channel type info
                        const commandContext = {
                            channelId: message.channel_id,
                            guildId: message.guild_id,
                            userId: message.author.id,
                            isVoiceChannel: isVoiceChannel
                        };
                        
                        await handleVoiceChatCommand(message.content, message.channel_id, message.author.id, message.guild_id, commandContext);
                    } catch (error) {
                        console.error(`❌ Error processing voice chat command: ${error.message}`);
                    }
                } else {
                    console.log(`❌ User ${message.author.id} is not authorized for commands`);
                    console.log(`📋 Authorized users: ${authorizedUsers.join(', ')}`);
                }
                return; // Don't react to commands
            }

            // Trigger auto-reactions for non-command messages (from other users, not the bot itself)
            if (autoReactEnabled && message.author.id !== client.user_id) {
                console.log(`🎭 Auto-reaction enabled, reacting to message from ${message.author.username}`);
                try {
                    await reactToMessage(client, message.channel_id, message.id);
                } catch (error) {
                    console.error(`❌ Error during auto-reaction: ${error.message}`);
                }
            }
        });

        // Update last activity time periodically
        setInterval(() => {
            const bot = connectedBots.find(b => b.id === botId);
            if (bot) {
                bot.lastActivity = Date.now();
            }
        }, 60000); // Update every minute
    }

    // Process the rest of the queue after a short delay
    setTimeout(() => processConnectionQueue(), CONNECTION_POOL.staggeredDelay);
}

// Initialize tokens and start systems
async function startApplication() {
    try {
        // Initialize empty token files system (1-15)
        const { initializeEmptyTokenFiles } = await import('./tokens-storage.js');
        await initializeEmptyTokenFiles();
        
        cleanTokens = await initializeTokens(); // Load tokens into cleanTokens
        console.log(`📊 Initializing connection pool for ${cleanTokens.length} bots`);
        console.log(`📝 Token system ready (1-15 tokens max)`);
        console.log(`⚙️ Max concurrent connections: ${CONNECTION_POOL.maxConcurrentConnections}`);
        console.log(`🔄 Bot rotation: ${BOT_ROTATION.enabled ? 'ENABLED' : 'DISABLED'}`);

        // Add all bots to connection queue
        for (let i = 0; i < cleanTokens.length; i++) {
            addToConnectionQueue(i, cleanTokens[i]);
        }

        // Start processing the connection queue
        processConnectionQueue();

        startReconnectionSystem();
        startBotRotation();

    } catch (error) {
        console.error("❌ Failed to start application:", error);
    }
}

// Call the start function to initialize everything
startApplication();