import * as webllm from '@mlc-ai/web-llm';
import './style.css';
import settings from './settings.html';
import demo from './demo.html';
import _ from 'lodash';

/**
 * @typedef {Object} ModelView Model view model
 * @property {string} id Model ID
 * @property {number} vram_required VRAM required in MB
 * @property {number} context_size Content window size
 */

/**
 * @typedef {Object} CompletionParam Additional parameters for completion
 * @property {number} [max_tokens] Maximum tokens to generate
 * @property {number} [temperature] Sampling temperature
 * @property {number} [top_p] Nucleus sampling probability
 * @property {number} [frequency_penalty] Frequency penalty
 * @property {number} [presence_penalty] Presence penalty
 * @property {string[]} [stop] Stop sequence
 */

class AsyncLock {
    #lock = false;
    #queue = [];

    async acquireLock() {
        if (this.#lock) {
            console.debug('Deferring lock acquisition', this);
            await new Promise(resolve => this.#queue.push(resolve));
        }
        console.debug('Acquiring lock', this);
        this.#lock = true;
    }

    releaseLock() {
        if (this.#queue.length > 0) {
            console.debug('Releasing one lock', this);
            const resolve = this.#queue.shift();
            resolve();
        } else {
            console.debug('Releasing lock', this);
            this.#lock = false;
        }
    }
}

/**
 * Provides a simplified API for generating text.
 */
class WebLLMEngineWrapper extends EventTarget {
    /**
     * Underlying model engine.
     * @type {webllm.MLCEngine}
     */
    #engine = null;
    /**
     * Current model ID.
     * @type {string}
     */
    #currentModelId = null;
    /**
     * Set to true to suppress progress messages.
     * @type {boolean}
     */
    #silent = false;
    /**
     * Default completion parameters.
     * @type {CompletionParam}
     */
    #defaultCompletionParams = null;
    /**
     * Lock to prevent concurrent requests.
     * @type {AsyncLock}
     */
    #lock = new AsyncLock();
    /**
     * Toast element for progress messages.
     * @type {JQuery}
     */
    #toast = $();

    constructor(modelId = null, silent = false) {
        super();
        this.#currentModelId = modelId;
        this.#silent = silent;

        if (!silent) {
            this.#toast = toastr.info('Please wait...', 'WebLLM', {
                timeOut: 0,
                extendedTimeOut: 0,
                closeButton: true,
                tapToDismiss: false,
                progressBar: false,
            }).hide();
        }
    }

    /**
     * Gets an instance of the engine.
     * @param {string?} modelId Model ID
     * @param {boolean?} silent Set to true to suppress progress messages
     * @returns
     */
    getEngine(modelId = null, silent = false) {
        return new WebLLMEngineWrapper(modelId, silent);
    }

    /**
     * Get a progress bar to show the initialization progress.
     * @returns {(report: webllm.InitProgressReport) => void}
     */
    #getProgressBar() {
        if (this.#silent) {
            return (progress) => {
                if (!isNaN(progress?.progress)) {
                    console.debug(progress);
                }
            };
        }

        return (progress) => {
            if (!isNaN(progress?.progress)) {
                console.debug(progress);
            }
            if (progress?.text) {
                this.#toast.show();
                this.#toast.find('.toast-message').text(progress.text);
            }
            const value = Math.floor(progress?.progress * 100);
            if (isNaN(value)) {
                return this.#toast.hide();
            }
        };
    }

    /**
     * Convert a model object to a model view model.
     * @param {webllm.ModelRecord} model Model object
     * @returns {ModelView} Model view model
     */
    #modelToViewModel(model) {
        if (!model) {
            return null;
        }

        return {
            id: model.model_id,
            vram_required: model.vram_required_MB,
            context_size: model.overrides?.context_window_size,
            toString: () => `${model.model_id} | ${Number(model.vram_required_MB / 1024).toFixed(1)} GB | ${model.overrides?.context_window_size} ctx`,
        };
    }

    #tryParse(json) {
        try {
            return JSON.parse(json);
        } catch (error) {
            return null;
        }
    }

    /**
     * Initialize the engine with the given model.
     * @param {string} [modelId] Model ID
     * @returns {Promise<void>}
     */
    async #initEngine(modelId = null) {
        const updateProgress = this.#getProgressBar();

        try {
            await this.#lock.acquireLock();

            if (!modelId && this.#currentModelId) {
                modelId = this.#currentModelId;
            }

            if (!modelId) {
                throw new Error('Model ID is required');
            }

            if (!this.#engine) {
                this.#currentModelId = modelId;
                this.#engine = await webllm.CreateMLCEngine(modelId, {
                    initProgressCallback: updateProgress,
                });
            }

            if (this.#currentModelId !== modelId) {
                this.#currentModelId = modelId;
                await this.#engine.reload(modelId);
            }

            updateProgress({ progress: NaN });
            this.dispatchEvent(new CustomEvent('modelReady', { detail: { modelId } }));
        } catch (error) {
            if (!this.#silent) toastr.error(error.message, 'Failed to initialize model');
            console.error(error);
            updateProgress({ progress: NaN });
            throw error;
        } finally {
            this.#lock.releaseLock();
        }
    }

    /**
     * Get a list of models available in the prebuilt app.
     * @returns {ModelView[]} Array of model view models
     */
    getModels() {
        return webllm
            .prebuiltAppConfig
            .model_list
            .map(this.#modelToViewModel)
            .sort((a, b) => a.id.localeCompare(b.id));
    }

    /**
     * Load the default completion parameters.
     * @param {CompletionParam} params
     */
    setDefaultParams(params) {
        this.#defaultCompletionParams = { ...params };
    }

    /**
     * Gets combined completion parameters.
     * @param {CompletionParam} params Override completion parameters
     * @returns {CompletionParam} Combined completion parameters
     */
    #getParams(params) {
        return { ...this.#defaultCompletionParams, ...params };
    }

    /**
     * Get the information for the current model. Null if no model is loaded.
     * @returns {ModelView | null} Model view model
     */
    getCurrentModelInfo() {
        if (!this.#currentModelId) {
            return null;
        }

        return this.#modelToViewModel(webllm.prebuiltAppConfig.model_list.find(model => model.model_id === this.#currentModelId));
    }

    /**
     * Load the specified model.
     * @param {string} [modelId] Model ID
     * @returns {Promise<void>}
     */
    async loadModel(modelId = null) {
        await this.#initEngine(modelId);
    }

    /**
     * Generates text based on the given prompt using the specified model.
     * @param {webllm.ChatCompletionMessageParam[]} messages Array of messages
     * @param {CompletionParam} [params] Additional parameters for completion
     * @returns {Promise<string>} Promise that resolves to the generated text
     */
    async generateChatPrompt(messages, params = null) {
        await this.#initEngine();
        /** @type {webllm.ChatCompletionRequestNonStreaming} */
        const request = {
            ...this.#getParams(params),
            messages,
        };
        const completion = await this.#generateWithRetry(() => this.#engine.chatCompletion(request));
        return completion?.choices?.[0]?.message?.content ?? '';
    }

    /**
     * Generates a JSON object based on the given prompt using the specified model.
     * @param {webllm.ChatCompletionMessageParam[]} messages Array of messages
     * @param {CompletionParam} [params] Additional parameters for completion
     * @returns {Promise<Object>} Promise that resolves to the generated JSON object
     */
    async generateJSON(messages, params = null) {
        await this.#initEngine();
        /** @type {webllm.ChatCompletionRequestNonStreaming} */
        const request = {
            ...this.#getParams(params),
            messages,
            response_format: {
                type: 'json_object',
            },
        };
        const completion = await this.#generateWithRetry(() => this.#engine.chatCompletion(request));
        return this.#tryParse(completion?.choices?.[0]?.message?.content ?? null);
    }

    /**
     * Generates a stream based on the given prompt using the specified model.
     * Compatible with StreamingProcessor interface.
     * @param {webllm.ChatCompletionMessageParam[]} messages Array of messages
     * @param {CompletionParam} [params] Additional parameters for completion
     * @returns {AsyncGenerator<{ text: string, swipes: any[], logprobs: null }>} Async generator that yields the generated
     */
    async* generateChatStream(messages, params = null) {
        await this.#initEngine();
        /** @type {webllm.ChatCompletionRequestStreaming} */
        const request = {
            ...this.#getParams(params),
            messages,
            stream: true,
        };
        const completion = await this.#generateWithRetry(() => this.#engine.chatCompletion(request));

        let text = '';
        for await (const choice of completion) {
            text += choice?.choices?.[0]?.delta?.content ?? '';
            yield { text: text, swipes: [], logprobs: null };
        }
    }

    /**
     * Executes the given function with retries.
     * @template T
     * @param {() => Promise<T>} func - The function to retry.
     * @param {number} maxRetries - The maximum number of retries.
     * @returns {Promise<T>} The result of the function.
     */
    async #generateWithRetry(func, maxRetries = 1) {
        try {
            await this.#lock.acquireLock();

            let i = 0;
            while (i++ < maxRetries) {
                try {
                    return await func();
                } catch (error) {
                    console.error(error);

                    if (maxRetries <= 0) {
                        if (!this.#silent) toastr.error(error.message, 'Failed to generate text');
                        throw error;
                    }

                    console.warn('Generation failed. Reloading model, retry #', i);
                    await this.#engine.reload(this.#currentModelId);
                }
            }
        } finally {
            this.#lock.releaseLock();
        }
    }
}

class WebLLMSettingsManager {
    static ID = 'webllm';

    /**
     * Engine instance.
     * @type {WebLLMEngineWrapper}
     */
    #engine = null;

    constructor() { }

    attachEngine(engine) {
        this.#engine = engine;
        this.pushSettingsToEngine();
        this.render();
    }

    render() {
        const parent = document.getElementById('extensions_settings');
        const existingSettings = parent.querySelector('#webllm_settings');

        if (existingSettings) {
            existingSettings.remove();
        }

        const renderer = document.createElement('template');
        renderer.innerHTML = settings;
        parent.appendChild(renderer.content);

        const modelSelect = parent.querySelector('#webllm_model');
        const models = this.#engine.getModels();
        const defaultModel = this.readValue('model');

        for (const model of models) {
            const option = document.createElement('option');
            option.value = model.id;
            option.text = model.toString();
            option.selected = model.id === defaultModel;
            modelSelect.appendChild(option);
        }

        const temperatureInput = parent.querySelector('#webllm_temperature');
        temperatureInput.value = this.readValue('temperature');

        const topPInput = parent.querySelector('#webllm_top_p');
        topPInput.value = this.readValue('top_p');

        const frequencyPenaltyInput = parent.querySelector('#webllm_frequency_penalty');
        frequencyPenaltyInput.value = this.readValue('frequency_penalty');

        const presencePenaltyInput = parent.querySelector('#webllm_presence_penalty');
        presencePenaltyInput.value = this.readValue('presence_penalty');

        const maxTokensInput = parent.querySelector('#webllm_max_tokens');
        maxTokensInput.value = this.readValue('max_tokens');

        const seedInput = parent.querySelector('#webllm_seed');
        seedInput.value = this.readValue('seed');

        const demoButton = parent.querySelector('#webllm_demo');
        demoButton.addEventListener('click', () => this.openDemo());

        this.#engine.addEventListener('modelReady', () => {
            const currentModel = this.#engine.getCurrentModelInfo();
            if (currentModel) {
                modelSelect.value = currentModel.id;
            }
        });

        modelSelect.addEventListener('input', () => {
            this.writeValue('model', modelSelect.value);
            const currentModel = this.#engine.getCurrentModelInfo();
            if (currentModel?.id !== modelSelect.value) {
                this.#engine.loadModel(modelSelect.value);
            }
        });

        temperatureInput.addEventListener('input', () => this.writeValue('temperature', temperatureInput.value ? Number(temperatureInput.value) : void 0));
        topPInput.addEventListener('input', () => this.writeValue('top_p', topPInput.value ? Number(topPInput.value) : void 0));
        frequencyPenaltyInput.addEventListener('input', () => this.writeValue('frequency_penalty', frequencyPenaltyInput.value ? Number(frequencyPenaltyInput.value) : void 0));
        presencePenaltyInput.addEventListener('input', () => this.writeValue('presence_penalty', presencePenaltyInput.value ? Number(presencePenaltyInput.value) : void 0));
        maxTokensInput.addEventListener('input', () => this.writeValue('max_tokens', maxTokensInput.value ? Number(maxTokensInput.value) : void 0));
        seedInput.addEventListener('input', () => this.writeValue('seed', seedInput.value ? Number(seedInput.value) : void 0));
    }

    readValue(key, defaultValue = null) {
        const context = SillyTavern.getContext();
        return _.get(context.extensionSettings, `${WebLLMSettingsManager.ID}.${key}`, defaultValue);
    }

    writeValue(key, value) {
        const context = SillyTavern.getContext();
        _.set(context.extensionSettings, `${WebLLMSettingsManager.ID}.${key}`, value);
        context.saveSettingsDebounced();
        this.pushSettingsToEngine();
    }

    pushSettingsToEngine() {
        const context = SillyTavern.getContext();
        const settings = structuredClone(context.extensionSettings[WebLLMSettingsManager.ID] || {});
        delete settings.model;
        this.#engine.setDefaultParams(settings);
    }

    openDemo() {
        const context = SillyTavern.getContext();
        const renderer = document.createElement('template');
        renderer.innerHTML = demo;

        const popup = document.createElement('div');
        popup.classList.add('webllm-demo-popup');
        popup.appendChild(renderer.content);

        const systemPrompt = popup.querySelector('#webllm_demo_system_prompt');
        systemPrompt.value = 'You are a helpful AI assistant.';

        const userPrompt = popup.querySelector('#webllm_demo_user_message');
        userPrompt.value = 'What is the capital of France?';

        const modelReply = popup.querySelector('#webllm_demo_model_reply');
        modelReply.value = '';

        const generateButton = popup.querySelector('#webllm_demo_generate');
        generateButton.addEventListener('click', async () => {
            modelReply.value = '';

            const messages = [
                { role: 'system', content: systemPrompt.value },
                { role: 'user', content: userPrompt.value },
            ];

            const modelId = document.getElementById('webllm_model').value;
            await this.#engine.loadModel(modelId);
            const completion = await this.#engine.generateChatPrompt(messages);

            modelReply.value = completion;
        });

        const streamButton = popup.querySelector('#webllm_demo_stream');
        streamButton.addEventListener('click', async () => {
            modelReply.value = '';

            const messages = [
                { role: 'system', content: systemPrompt.value },
                { role: 'user', content: userPrompt.value },
            ];

            const modelId = document.getElementById('webllm_model').value;
            await this.#engine.loadModel(modelId);
            const stream = this.#engine.generateChatStream(messages);

            for await (const { text } of stream) {
                modelReply.value = text;
                modelReply.scrollTop = modelReply.scrollHeight;
            }
        });

        context.callGenericPopup($(popup), context.POPUP_TYPE.TEXT, '', { wide: true, large: true });
    }
}

// Expose the API to the SillyTavern global object
(function () {
    const settingsManager = new WebLLMSettingsManager();
    const defaultModel = settingsManager.readValue('model');
    const defaultEngine = new WebLLMEngineWrapper(defaultModel, false);
    settingsManager.attachEngine(defaultEngine);
    Object.assign(SillyTavern, { llm: defaultEngine });
}());
