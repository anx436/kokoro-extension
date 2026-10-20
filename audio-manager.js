export class AudioManager {
    constructor() {
        this.audioCache = new Map(); // index -> Promise<BlobUrl>
        this.sentences = [];
        this.abortController = new AbortController();
        this.requestQueue = Promise.resolve(); // For sequential processing
    }

    clear() {
        this.audioCache.clear();
        this.sentences = [];
        if (this.abortController) this.abortController.abort();
        this.abortController = new AbortController();
        this.requestQueue = Promise.resolve();
    }

    setSentences(sentences) {
        this.sentences = sentences;
    }

    async getAudio(index) {
        if (index >= this.sentences.length) return null;

        if (this.audioCache.has(index)) {
            return this.audioCache.get(index);
        }

        const promise = this.fetchAudio(this.sentences[index].text);
        this.audioCache.set(index, promise);
        return promise;
    }

    prefetch(index) {
        if (index < this.sentences.length && !this.audioCache.has(index)) {
            this.getAudio(index);
        }
    }

    async fetchAudio(text) {
        const localData = await browser.storage.local.get(['pendingVoice', 'pendingApiUrl', 'pendingNormalizationOptions']);
        const syncData = await browser.storage.sync.get({
            en_apiUrl: 'http://127.0.0.1:8880/v1/',
            en_voice: 'af_sarah',
            ru_apiUrl: 'http://127.0.0.1:8881/v1/',
            ru_voice: 'xenia'
        });

        // Use queue to ensure sequential requests to the API
        // Catching here ensures the chain doesn't break for subsequent requests
        return this.requestQueue = this.requestQueue.catch(() => { }).then(async () => {
            try {
                // Slices are strictly monolingual: if Cyrillic -> Russian (Silero), else English (Kokoro)
                const isRussian = /[\u0400-\u04FF]/.test(text);

                let targetApiUrl = isRussian
                    ? (syncData.ru_apiUrl || localData.pendingApiUrl)
                    : (syncData.en_apiUrl || localData.pendingApiUrl);
                const targetVoice = isRussian
                    ? (syncData.ru_voice || 'xenia')
                    : (syncData.en_voice || localData.pendingVoice);
                const targetModel = isRussian ? 'silero-v5' : 'kokoro';

                if (!targetApiUrl) {
                    throw new Error("Missing API URL");
                }
                if (!targetApiUrl.endsWith('/')) {
                    targetApiUrl += '/';
                }
                const endpoint = new URL('audio/speech', targetApiUrl).href;

                const result = await browser.runtime.sendMessage({
                    action: "FETCH_TTS_AUDIO",
                    endpoint: endpoint,
                    payload: {
                        model: targetModel,
                        input: text,
                        voice: targetVoice,
                        response_format: 'mp3',
                        speed: 1.0,
                        normalization_options: localData.pendingNormalizationOptions
                    }
                });

                if (!result || !result.success) {
                    throw new Error(result?.error || "Background fetch failed");
                }

                return result.dataUrl;
            } catch (e) {
                if (e.name === 'AbortError') throw e;

                let msg = e.message;
                if (msg === "Failed to fetch") {
                    msg = `Connection failed to TTS server. Is it running?`;
                }
                console.error("Fetch failed:", e);
                throw new Error(msg);
            }
        });
    }
}
