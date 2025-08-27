
import { voiceClient } from "./client.js";
import tokens from "./token.js";
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;
let url = "";
let uptimeDate = Date.now();
let requests = 0;
let response = null;

// Store logs and commands
let logs = [];
let commands = [];
const maxLogs = 500;
const maxCommands = 100;

// Bot management
let connectedBots = [];
let spamSettings = {
    active: false,
    message: "",
    interval: 5000, // Default 5 seconds
    timeoutIds: []
};

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
app.get('/api/logs', (req, res) => {
    res.json({
        logs: logs.slice(-50),
        commands: commands.slice(-20),
        requests: requests,
        uptime: Date.now() - uptimeDate,
        spamStatus: spamSettings.active,
        connectedBots: connectedBots.length
    });
});

app.post('/api/command', (req, res) => {
    const { command } = req.body;
    if (!command || !command.startsWith('=')) {
        return res.json({ success: false, error: 'Command must start with =' });
    }

    const result = processCommand(command);
    commands.push(`${new Date().toLocaleTimeString()}: ${command}`);
    
    if (commands.length > maxCommands) {
        commands = commands.slice(-maxCommands);
    }

    res.json(result);
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Command processor
function processCommand(command) {
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
            if (parts.length < 2) {
                return { success: false, error: 'Usage: =join <channel_id>' };
            }
            const channelId = parts[1];
            if (!/^\d+$/.test(channelId)) {
                return { success: false, error: 'Channel ID must be a valid number' };
            }
            const result = changeVoiceChannel(channelId);
            return result;
            
        case 'leave':
            const leaveResult = leaveVoiceChannels();
            return leaveResult;
            
        default:
            return { success: false, error: 'Unknown command. Available: =spam, =timespam, =spamoff, =join, =leave' };
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

function changeVoiceChannel(newChannelId) {
    if (connectedBots.length === 0) {
        console.log('❌ No connected bots to change channel');
        return { success: false, error: 'No connected bots available' };
    }
    
    let successCount = 0;
    connectedBots.forEach((bot) => {
        if (bot.client && bot.client.ws) {
            // Update the channel ID
            bot.client.channelId = newChannelId;
            
            // Send voice state update to join new channel
            const voiceStateUpdate = {
                op: 4,
                d: {
                    guild_id: bot.client.guildId,
                    channel_id: newChannelId,
                    self_mute: bot.client.selfMute,
                    self_deaf: bot.client.selfDeaf
                }
            };
            
            bot.client.ws.send(JSON.stringify(voiceStateUpdate));
            successCount++;
            console.log(`🔄 Bot ${bot.id} switching to channel ${newChannelId}`);
        }
    });
    
    if (successCount > 0) {
        console.log(`✅ ${successCount} bot(s) switching to channel ${newChannelId}`);
        return { success: true, message: `${successCount} bot(s) switching to channel ${newChannelId}` };
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

async function sendMessage(client, message) {
    if (!client.channelId || !client.token) return;
    
    const url = `https://discord.com/api/v10/channels/${client.channelId}/messages`;
    
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': client.token, // User tokens don't need 'Bot' prefix
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            body: JSON.stringify({
                content: message
            })
        });
        
        if (response.ok) {
            console.log(`📤 Bot ${client.user_id || 'Unknown'}: "${message}" ✅`);
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

app.listen(port, '0.0.0.0', () => console.log(`🖥️ Console Interface running at ${url}`));

process.on('uncaughtException', (err) => {
    console.error(`Uncaught Exception: ${err.message}`);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

setInterval(async () => {
    console.log(url);
    try {
        response = await fetch(url, { method: 'HEAD' });
        requests += 1;
        console.log(`Request done with status ${response.status} ${requests}`);
    } catch (error) {
        if (error.response) {
            requests += 1;
            console.log(`Response status: ${error.response.status}${requests}`);
        }
    } finally {
        response = null;
    }
}, 15000);

const cleanTokens = tokens.reduce((acc, token) => {
    const isValid = token?.token?.length > 30;
    const isDuplicate = acc.some(t => t.token === token.token);
    if (isValid && !isDuplicate) {
        acc.push(token);
    } else {
        console.warn('Invalid or duplicate token configuration:', token);
    }
    return acc;
}, []);

console.log(`Total valid tokens found: ${cleanTokens.length}`);

for (let i = 0; i < cleanTokens.length; i++) {
    const token = cleanTokens[i];
    console.log(`Starting bot ${i + 1} with token: ${token.token ? token.token.substring(0, 10) + '...' : 'MISSING'}`);
    
    setTimeout(() => {
        const client = new voiceClient(token);
        
        client.on('ready', (user) => {
            console.log(`✅ Bot ${i + 1} logged in as ${user.username}#${user.discriminator}`);
            // Store token and channelId for REST API calls
            client.token = token.token;
            client.channelId = token.channelId;
            
            connectedBots.push({ 
                id: i + 1, 
                client: client, 
                username: user.username,
                connected: true 
            });
        });
        
        client.on('connected', () => {
            console.log(`🔗 Bot ${i + 1} connected to Discord`);
        });
        
        client.on('disconnected', () => {
            console.log(`❌ Bot ${i + 1} disconnected from Discord`);
            connectedBots = connectedBots.filter(bot => bot.id !== i + 1);
        });
        
        client.on('voiceReady', () => {
            console.log(`🎤 Bot ${i + 1} voice is ready (User ID: ${client.user_id})`);
        });
        
        client.on('error', (error) => {
            console.error(`❌ Bot ${i + 1} error:`, error);
        });
        
        client.on('debug', (message) => {
            console.debug(`🔍 Bot ${i + 1}: ${message}`);
        });
        
        client.connect();
    }, i * 3000);
}
