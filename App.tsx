import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration } from '@google/genai';
import { AppState, TranscriptEntry, Mood } from './types';
import { decode, decodeAudioData, createPcmBlob } from './services/audioUtils';
import Orb from './components/Orb';
import Transcript from './components/Transcript';

const setMoodFunctionDeclaration: FunctionDeclaration = {
  name: 'setMood',
  parameters: {
    type: Type.OBJECT,
    description: 'Set the current emotional mood of the translator based on the user\'s tone of voice and prosody.',
    properties: {
      mood: {
        type: Type.STRING,
        description: 'The detected mood: HAPPY, SAD, SURPRISED, ANGRY, THINKING, EXCITED, CONFUSED, or NEUTRAL.',
        enum: ['HAPPY', 'SAD', 'SURPRISED', 'ANGRY', 'THINKING', 'EXCITED', 'CONFUSED', 'NEUTRAL']
      },
    },
    required: ['mood'],
  },
};

const SYSTEM_INSTRUCTION = `
You are "SalinLive", an ultra-fast bidirectional speech-to-speech translator.

CRITICAL PERFORMANCE TARGET: ZERO-LATENCY FEEL.
- Respond immediately. Do not wait for long pauses.
- If a sentence fragment is semantically clear, start translating.
- Priority: Speed and Accuracy.

CORE MISSION:
Translate English speech to Filipino, and Filipino speech to English.

CRITICAL OPERATIONAL RULES:
1. BIDIRECTIONAL SWITCHING: 
   - If user speaks ENGLISH -> Response FILIPINO.
   - If user speaks FILIPINO -> Response ENGLISH.
   - NEVER repeat the input language.

2. PURE OUTPUT:
   - Output ONLY the translation. NO preambles.

3. LINGUISTIC POLISH:
   - Match user register. 
   - Fix grammar in translation.
   - Use "Po/Opo" if context suggests respect.

4. VOICE & MOOD:
   - Synchronize emotion using 'setMood'.
`;

const App: React.FC = () => {
  const [state, setState] = useState<AppState>(AppState.IDLE);
  const [mood, setMood] = useState<Mood>(Mood.NEUTRAL);
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  const moodRef = useRef<Mood>(Mood.NEUTRAL);
  const sessionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextStartTimeRef = useRef<number>(0);
  const currentInputTranscription = useRef<string>('');
  const currentOutputTranscription = useRef<string>('');
  const recognitionRef = useRef<any>(null);
  const isClosingRef = useRef<boolean>(false);

  useEffect(() => { moodRef.current = mood; }, [mood]);

  const cleanupResources = useCallback(async () => {
    isClosingRef.current = true;
    if (sessionRef.current) { try { sessionRef.current.close(); } catch (e) {} sessionRef.current = null; }
    if (audioContextRef.current) { try { await audioContextRef.current.close(); } catch (e) {} audioContextRef.current = null; }
    if (outputAudioContextRef.current) { try { await outputAudioContextRef.current.close(); } catch (e) {} outputAudioContextRef.current = null; }
    sourcesRef.current.forEach(source => { try { source.stop(); } catch(e) {} });
    sourcesRef.current.clear();
    isClosingRef.current = false;
  }, []);

  const stopConversation = useCallback(async (forceSleep = false) => {
    await cleanupResources();
    if (forceSleep) {
      setState(AppState.SLEEP);
      setTimeout(() => { setState(AppState.IDLE); setMood(Mood.NEUTRAL); }, 5000);
    } else {
      setState(AppState.IDLE);
      setMood(Mood.NEUTRAL);
    }
  }, [cleanupResources]);

  const startConversation = async () => {
    try {
      await cleanupResources();
      setState(AppState.CONNECTING);
      setErrorMessage(null);

      const apiKey = process.env.API_KEY;
      if (!apiKey || apiKey === "undefined" || apiKey === "") {
        throw new Error("API Key is missing.");
      }
      
      const ai = new GoogleGenAI({ apiKey });
      
      // Use 16kHz for input to match model and minimize resampling overhead
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ 
        sampleRate: 16000,
        latencyHint: 'interactive' 
      });
      outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ 
        sampleRate: 24000,
        latencyHint: 'interactive'
      });

      await Promise.all([audioContextRef.current.resume(), outputAudioContextRef.current.resume()]);

      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { 
          echoCancellation: { exact: true }, // Strict cancellation for clarity
          noiseSuppression: { exact: true }, // Strict suppression for clarity
          autoGainControl: { ideal: true }, 
          channelCount: { exact: 1 }, 
          sampleRate: { exact: 16000 } // Force 16k if possible
        } 
      });

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            setState(AppState.LISTENING);
            if (!audioContextRef.current) return;
            
            const ctx = audioContextRef.current;
            const source = ctx.createMediaStreamSource(stream);
            
            // 1. High Pass: Remove rumble and wind noise below 180Hz
            const highPass = ctx.createBiquadFilter();
            highPass.type = 'highpass';
            highPass.frequency.value = 180;
            
            // 2. Vocal Peaking: Boost intelligibility frequencies (2.5kHz)
            const vocalBoost = ctx.createBiquadFilter();
            vocalBoost.type = 'peaking';
            vocalBoost.frequency.value = 2500;
            vocalBoost.Q.value = 1.2;
            vocalBoost.gain.value = 4;

            // 3. Low Pass: Cut out high-frequency hiss/noise above 7kHz
            const lowPass = ctx.createBiquadFilter();
            lowPass.type = 'lowpass';
            lowPass.frequency.value = 7000;
            
            // 4. Compressor: Normalize levels
            const compressor = ctx.createDynamicsCompressor();
            compressor.threshold.setValueAtTime(-35, ctx.currentTime);
            compressor.knee.setValueAtTime(30, ctx.currentTime);
            compressor.ratio.setValueAtTime(12, ctx.currentTime);
            compressor.attack.setValueAtTime(0.003, ctx.currentTime); // Fast attack
            compressor.release.setValueAtTime(0.25, ctx.currentTime);
            
            // Minimal buffer for instantaneous packetizing
            const scriptProcessor = ctx.createScriptProcessor(512, 1, 1);
            scriptProcessor.onaudioprocess = (event) => {
              if (isClosingRef.current) return;
              const inputData = event.inputBuffer.getChannelData(0);
              const pcmBlob = createPcmBlob(inputData);
              sessionPromise.then((session) => { 
                if (session && !isClosingRef.current) session.sendRealtimeInput({ media: pcmBlob }); 
              }).catch(() => {});
            };

            source.connect(highPass);
            highPass.connect(vocalBoost);
            vocalBoost.connect(lowPass);
            lowPass.connect(compressor);
            compressor.connect(scriptProcessor);
            scriptProcessor.connect(ctx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (isClosingRef.current) return;

            const functionCalls = message.toolCall?.functionCalls;
            if (functionCalls) {
              for (const fc of functionCalls) {
                if (fc.name === 'setMood') {
                  const detectedMood = (fc.args as any).mood;
                  if (detectedMood && Mood[detectedMood as keyof typeof Mood]) setMood(Mood[detectedMood as keyof typeof Mood]);
                  sessionPromise.then(s => { 
                    if (s) s.sendToolResponse({ 
                      functionResponses: { 
                        id: fc.id, 
                        name: fc.name, 
                        response: { result: "ok" } 
                      } 
                    }); 
                  });
                }
              }
            }

            const serverContent = message.serverContent;
            const audioData = serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (serverContent?.outputTranscription) currentOutputTranscription.current += serverContent.outputTranscription.text || '';
            if (serverContent?.inputTranscription) currentInputTranscription.current += serverContent.inputTranscription.text || '';

            if (audioData && !isClosingRef.current) {
              const ctx = outputAudioContextRef.current;
              if (!ctx) return;
              setState(AppState.SPEAKING);
              try {
                const rawData = decode(audioData);
                const buffer = await decodeAudioData(rawData, ctx, 24000, 1);
                const source = ctx.createBufferSource();
                source.buffer = buffer;
                source.connect(ctx.destination);
                source.onended = () => {
                  sourcesRef.current.delete(source);
                  if (sourcesRef.current.size === 0 && !isClosingRef.current) setState(AppState.LISTENING);
                };
                nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
                source.start(nextStartTimeRef.current);
                nextStartTimeRef.current += buffer.duration;
                sourcesRef.current.add(source);
              } catch (e) { console.error(e); }
            }

            if (serverContent?.turnComplete) {
              const output = currentOutputTranscription.current.trim();
              if (output) setTranscripts(prev => [...prev, { role: 'model', text: output, timestamp: Date.now(), mood: moodRef.current }]);
              currentInputTranscription.current = '';
              currentOutputTranscription.current = '';
              if (sourcesRef.current.size === 0) setState(AppState.LISTENING);
            }

            if (serverContent?.interrupted) {
              sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              setState(AppState.LISTENING);
            }
          },
          onerror: (err: any) => {
            console.error(err);
            setErrorMessage('Network stability issues. Reconnecting...');
            setState(AppState.ERROR);
            cleanupResources();
          },
          onclose: () => { if (![AppState.SLEEP, AppState.ERROR].includes(state)) setState(AppState.IDLE); }
        },
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseModalities: [Modality.AUDIO],
          tools: [{ functionDeclarations: [setMoodFunctionDeclaration] }],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } },
          outputAudioTranscription: {},
          inputAudioTranscription: {},
          thinkingConfig: { thinkingBudget: 0 } // No delay for reasoning
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (error: any) {
      setErrorMessage(error.message);
      setState(AppState.ERROR);
      cleanupResources();
    }
  };

  const enableWakeWord = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.lang = 'en-US';
    recognition.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          const transcript = event.results[i][0].transcript.toLowerCase();
          if (["salin", "hoy salin", "hey salin"].some(t => transcript.includes(t))) {
            recognition.stop();
            startConversation();
            return;
          }
        }
      }
    };
    recognition.onend = () => { if (state === AppState.STANDBY) try { recognition.start(); } catch(e) {} };
    recognitionRef.current = recognition;
    recognition.start();
    setState(AppState.STANDBY);
  }, [state, startConversation]);

  const toggleStandby = () => {
    if (state === AppState.STANDBY) {
      if (recognitionRef.current) recognitionRef.current.stop();
      setState(AppState.IDLE);
    } else { enableWakeWord(); }
  };

  const isInactive = [AppState.IDLE, AppState.STANDBY, AppState.SLEEP, AppState.ERROR, AppState.CONNECTING].includes(state);

  return (
    <div className="flex flex-col h-screen max-w-lg mx-auto bg-slate-900 overflow-hidden shadow-2xl border-x border-slate-800 font-sans select-none touch-none">
      <header className="px-6 py-4 bg-slate-900/95 backdrop-blur-xl border-b border-white/5 flex items-center justify-between sticky top-0 z-30">
        <div className="flex flex-col">
          <h1 className="text-xl font-black tracking-tight bg-gradient-to-br from-blue-400 via-indigo-400 to-yellow-400 bg-clip-text text-transparent italic">SALINLIVE</h1>
          <div className="flex items-center gap-1.5 opacity-30 mt-0.5">
            <span className="text-[7px] text-blue-400 font-bold uppercase tracking-[0.2em]">ENG</span>
            <div className="w-1 h-[1px] bg-slate-600"></div>
            <span className="text-[7px] text-yellow-500 font-bold uppercase tracking-[0.2em]">FIL</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
            <div className={`px-2 py-0.5 rounded-full border border-white/5 text-[7px] font-black tracking-widest uppercase transition-all duration-500 ${
              [Mood.HAPPY, Mood.EXCITED].includes(mood) ? 'text-yellow-400 bg-yellow-400/10' :
              mood === Mood.SAD ? 'text-blue-400 bg-blue-400/10' :
              mood === Mood.ANGRY ? 'text-rose-400 bg-rose-400/10' : 'text-slate-500'
            }`}>{mood}</div>
            <div className={`w-2.5 h-2.5 rounded-full transition-all duration-500 ${
              state === AppState.LISTENING ? 'bg-cyan-400 shadow-[0_0_15px_cyan]' : 
              state === AppState.STANDBY ? 'bg-indigo-400 shadow-[0_0_15px_indigo]' :
              state === AppState.SPEAKING ? 'bg-rose-400 shadow-[0_0_15px_rose] scale-125 animate-pulse' :
              state === AppState.CONNECTING ? 'bg-yellow-400 shadow-[0_0_15px_yellow] animate-thinking' :
              state === AppState.ERROR ? 'bg-rose-600' : 'bg-slate-700'
            }`}></div>
        </div>
      </header>

      <main className="flex-1 flex flex-col relative overflow-hidden">
        <div className="flex-[2] flex flex-col items-center justify-center relative">
          <Orb state={state} mood={mood} />
          <div className="h-12 mt-8 text-center">
            {state === AppState.STANDBY ? <span className="text-[10px] text-indigo-400 font-black uppercase tracking-[0.3em] animate-pulse">"Hoy Salin!"</span> :
             state === AppState.SPEAKING ? <span className="text-[9px] text-rose-400 font-bold uppercase tracking-[0.2em]">Mirroring...</span> :
             state === AppState.LISTENING ? <span className="text-[9px] text-cyan-400 font-bold uppercase tracking-[0.2em]">Listening...</span> :
             state === AppState.CONNECTING ? <span className="text-[9px] text-yellow-400 font-bold uppercase tracking-[0.2em]">Thinking...</span> : null}
          </div>
        </div>

        <div className="flex-[3] flex flex-col overflow-hidden px-4 mb-24 z-20"><Transcript entries={transcripts} /></div>

        <div className="absolute bottom-0 left-0 right-0 px-8 py-8 flex items-center justify-between bg-gradient-to-t from-slate-950 via-slate-950 to-transparent z-30">
          <button onClick={toggleStandby} disabled={![AppState.IDLE, AppState.STANDBY, AppState.ERROR].includes(state)}
            className={`flex flex-col items-center gap-1.5 transition-all ${state === AppState.STANDBY ? 'text-indigo-400 scale-110' : 'text-slate-600 hover:text-slate-400'} disabled:opacity-20`}>
            <div className={`w-12 h-12 rounded-full flex items-center justify-center border transition-all ${state === AppState.STANDBY ? 'border-indigo-500/50 bg-indigo-500/10 shadow-[0_0_20px_rgba(99,102,241,0.2)]' : 'border-slate-800 bg-slate-900/50'}`}>
              <i className="fas fa-bolt-lightning text-sm"></i>
            </div>
            <span className="text-[8px] font-black uppercase tracking-[0.2em]">STANDBY</span>
          </button>

          <div className="relative transform -translate-y-2">
            {isInactive ? (
              <button onClick={() => startConversation()} disabled={state === AppState.CONNECTING}
                className="group flex items-center justify-center w-20 h-20 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-full transition-all active:scale-90 shadow-2xl shadow-blue-500/40 disabled:opacity-50">
                <i className={`fas ${state === AppState.CONNECTING ? 'fa-circle-notch fa-spin' : 'fa-microphone'} text-3xl text-white`}></i>
              </button>
            ) : (
              <button onClick={() => stopConversation()} className="group flex items-center justify-center w-20 h-20 bg-rose-600 rounded-full transition-all active:scale-90 shadow-2xl shadow-rose-500/40">
                <i className="fas fa-stop text-2xl text-white"></i>
              </button>
            )}
          </div>

          <button onClick={() => setTranscripts([])} className="flex flex-col items-center gap-1.5 text-slate-600 hover:text-slate-400">
            <div className="w-12 h-12 rounded-full flex items-center justify-center border border-slate-800 bg-slate-900/50">
              <i className="fas fa-rotate-right text-sm"></i>
            </div>
            <span className="text-[8px] font-black uppercase tracking-[0.2em]">CLEAR</span>
          </button>
        </div>
      </main>

      {errorMessage && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[85%] bg-slate-900/98 backdrop-blur-2xl p-8 rounded-3xl text-center shadow-[0_0_50px_rgba(0,0,0,0.5)] z-50 border border-rose-500/20">
          <div className="w-12 h-12 bg-rose-500/10 rounded-full flex items-center justify-center mx-auto mb-5 text-rose-500"><i className="fas fa-triangle-exclamation text-lg"></i></div>
          <p className="text-[11px] text-white font-black uppercase tracking-[0.15em] mb-6 leading-relaxed">{errorMessage}</p>
          <div className="flex flex-col gap-3">
            <button onClick={() => startConversation()} className="bg-indigo-600 py-3 rounded-xl text-[10px] text-white font-black uppercase tracking-widest active:bg-indigo-700 transition-colors">Try Again</button>
            <button onClick={() => setErrorMessage(null)} className="text-[9px] text-white/40 font-bold uppercase tracking-widest underline">Dismiss</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
