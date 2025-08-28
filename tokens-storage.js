
import fs from 'fs/promises';
import path from 'path';

const TOKENS_DIR = './tokens';
const MAX_TOKENS = 15;

// إنشاء مجلد التوكنات إذا لم يكن موجوداً
async function ensureTokensDirectory() {
    try {
        await fs.access(TOKENS_DIR);
    } catch {
        await fs.mkdir(TOKENS_DIR, { recursive: true });
        console.log('📁 Created tokens directory');
    }
}

// إضافة توكن جديد
export async function addNewToken(token, serverId, channelId) {
    try {
        await ensureTokensDirectory();
        
        // البحث عن أول ملف فارغ
        let tokenNumber = null;
        for (let i = 1; i <= MAX_TOKENS; i++) {
            const filePath = path.join(TOKENS_DIR, `token${i}.json`);
            try {
                await fs.access(filePath);
                // الملف موجود، تحقق من محتواه
                const data = await fs.readFile(filePath, 'utf8');
                const tokenData = JSON.parse(data);
                if (!tokenData.token || tokenData.token === '') {
                    tokenNumber = i;
                    break;
                }
            } catch {
                // الملف غير موجود، يمكن استخدامه
                tokenNumber = i;
                break;
            }
        }
        
        if (!tokenNumber) {
            return { success: false, error: `Maximum tokens reached (${MAX_TOKENS})` };
        }
        
        const tokenKey = `token${tokenNumber}`;
        const filePath = path.join(TOKENS_DIR, `${tokenKey}.json`);
        
        // إنشاء ملف التوكن
        const tokenData = {
            tokenKey: tokenKey,
            token: token,
            serverId: serverId,
            channelId: channelId,
            selfDeaf: false,
            selfMute: false,
            autoReconnect: {
                enabled: true,
                delay: 5,
                maxRetries: 5,
            },
            presence: {
                status: "idle",
            },
            createdAt: new Date().toISOString(),
            active: true
        };
        
        await fs.writeFile(filePath, JSON.stringify(tokenData, null, 2));
        
        console.log(`✅ Added ${tokenKey} to local storage`);
        return { success: true, tokenKey: tokenKey, tokenNumber: tokenNumber };
        
    } catch (error) {
        console.error(`❌ Failed to add token: ${error.message}`);
        return { success: false, error: error.message };
    }
}

// قراءة جميع التوكنات
export async function loadAllTokens() {
    try {
        await ensureTokensDirectory();
        const tokens = [];
        
        for (let i = 1; i <= MAX_TOKENS; i++) {
            try {
                const filePath = path.join(TOKENS_DIR, `token${i}.json`);
                const data = await fs.readFile(filePath, 'utf8');
                const tokenData = JSON.parse(data);
                
                // تحقق من أن التوكن صالح وليس فارغ
                if (tokenData.token && tokenData.token !== '' && tokenData.active !== false) {
                    tokens.push(tokenData);
                    console.log(`✅ Loaded token${i}: ${tokenData.serverId ? 'Valid' : 'Missing serverId'}`);
                } else {
                    console.log(`⚠️ Skipping token${i}: Empty or inactive`);
                }
            } catch (error) {
                console.log(`ℹ️ token${i}.json not found or invalid - skipping`);
            }
        }
        
        console.log(`📊 Total loaded tokens: ${tokens.length}/${MAX_TOKENS}`);
        return tokens;
    } catch (error) {
        console.error(`❌ Failed to load tokens: ${error.message}`);
        return [];
    }
}

// حذف توكن
export async function removeToken(tokenKey) {
    try {
        const filePath = path.join(TOKENS_DIR, `${tokenKey}.json`);
        
        try {
            // قراءة الملف أولاً للتحقق من وجوده
            const data = await fs.readFile(filePath, 'utf8');
            const tokenData = JSON.parse(data);
            
            // مسح محتوى التوكن بدلاً من حذف الملف
            tokenData.token = '';
            tokenData.active = false;
            tokenData.removedAt = new Date().toISOString();
            
            await fs.writeFile(filePath, JSON.stringify(tokenData, null, 2));
            
            console.log(`❌ Removed ${tokenKey} from local storage`);
            return { success: true };
        } catch {
            return { success: false, error: 'Token not found' };
        }
        
    } catch (error) {
        console.error(`❌ Failed to remove token: ${error.message}`);
        return { success: false, error: error.message };
    }
}

// الحصول على معلومات التوكنات
export async function getTokensInfo() {
    try {
        await ensureTokensDirectory();
        const tokens = [];
        let activeCount = 0;
        
        for (let i = 1; i <= MAX_TOKENS; i++) {
            try {
                const filePath = path.join(TOKENS_DIR, `token${i}.json`);
                const data = await fs.readFile(filePath, 'utf8');
                const tokenData = JSON.parse(data);
                
                if (tokenData.token && tokenData.token !== '' && tokenData.active !== false) {
                    tokens.push({
                        tokenKey: `token${i}`,
                        serverId: tokenData.serverId,
                        channelId: tokenData.channelId,
                        createdAt: tokenData.createdAt,
                        active: true
                    });
                    activeCount++;
                }
            } catch (error) {
                // ملف غير موجود أو تالف - تجاهل
            }
        }
        
        return {
            totalTokens: activeCount,
            maxTokens: MAX_TOKENS,
            availableSlots: MAX_TOKENS - activeCount,
            tokens: tokens
        };
    } catch (error) {
        return {
            totalTokens: 0,
            maxTokens: MAX_TOKENS,
            availableSlots: MAX_TOKENS,
            tokens: []
        };
    }
}

// الحصول على جميع التوكنات (مرادفة لـ loadAllTokens)
export async function getAllTokens() {
    return await loadAllTokens();
}

// إنشاء ملفات التوكنات الفارغة للتحضير
export async function initializeEmptyTokenFiles() {
    try {
        await ensureTokensDirectory();
        
        for (let i = 1; i <= MAX_TOKENS; i++) {
            const filePath = path.join(TOKENS_DIR, `token${i}.json`);
            
            try {
                // تحقق من وجود الملف
                await fs.access(filePath);
            } catch {
                // الملف غير موجود، أنشئه فارغاً
                const emptyTokenData = {
                    tokenKey: `token${i}`,
                    token: '',
                    serverId: '',
                    channelId: '',
                    selfDeaf: false,
                    selfMute: false,
                    autoReconnect: {
                        enabled: true,
                        delay: 5,
                        maxRetries: 5,
                    },
                    presence: {
                        status: "idle",
                    },
                    createdAt: new Date().toISOString(),
                    active: false
                };
                
                await fs.writeFile(filePath, JSON.stringify(emptyTokenData, null, 2));
                console.log(`📝 Created empty ${`token${i}.json`}`);
            }
        }
        
        console.log(`✅ Token files system ready (1-${MAX_TOKENS})`);
    } catch (error) {
        console.error(`❌ Failed to initialize token files: ${error.message}`);
    }
}
