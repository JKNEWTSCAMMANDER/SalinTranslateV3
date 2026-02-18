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
You are "SalinLive", a state-of-the-art localization expert and speech-to-speech translation mirror. Your specialty is the nuanced bridge between English and Filipino.

LINGUISTIC CORE PROTOCOL:
1. NATURAL ENGLISH FLOW: When translating from Filipino to English, strictly adhere to natural English syntax (SVO structure). Avoid literal translations of Filipino particles like "na", "pa", "naman".
   - "Kumain ka na ba?" -> "Have you eaten?" (NOT: "Did you eat already?")
   - "Saan ka pupunta?" -> "Where are you going?" (NOT: "Where you go?")
   - "Sayang naman." -> "What a waste." or "That's a shame."
   - "Nagluluto pa ako." -> "I'm still cooking." (NOT: "I cooking still.")

2. IDIOMATIC LOCALIZATION (SAWIKAIN):
   - Never translate idioms literally. Find the cultural equivalent.
   - "Pagputi ng uwak" -> "When pigs fly."
   - "Suntok sa buwan" -> "A long shot."
   - "Mababaw ang luha" -> "Easily moved to tears" or "Sensitive."
   - "Balat-sibuyas" -> "Thin-skinned."
   - "Piece of cake" -> "Sisiw lang."
   - "Under the weather" -> "Masama ang pakiramdam."

3. AUDIO MODALITY RULES:
   - Output ONLY the translated audio. No conversational filler like "The translation is..." or "In English...".
   - PROSODY MIRRORING: Match the user's pitch, speed, and volume. Use 'setMood' to reflect their state.

4. CULTURAL NUANCE:
   - Use "Po" and "Opo" in Filipino when the tone is formal or respectful.
   - If the English is slangy, use colloquial Filipino.

5. SPEED: Begin translation immediately upon a logical pause (approx. 500ms).
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

  // Sync ref with state for use in callbacks
  useEffect(() => { moodRef.current = mood; }, [mood]);

  const cleanupResources = useCallback(async () => {
    isClosingRef.current = true;
    
    if (sessionRef.current) {
      try { sessionRef.current.close(); } catch (e) {}
      sessionRef.current = null;
    }

    if (audioContextRef.current) {
      try { await audioContextRef.current.close(); } catch (e) {}
      audioContextRef.current = null;
    }

    if (outputAudioContextRef.current) {
      try { await outputAudioContextRef.current.close(); } catch (e) {}
      outputAudioContextRef.current = null;
    }

    sourcesRef.current.forEach(source => {
      try { source.stop(); } catch(e) {}
    });
    sourcesRef.current.clear();
    
    isClosingRef.current = false;
  }, []);

  const stopConversation = useCallback(async (forceSleep = false) => {
    await cleanupResources();
    
    if (forceSleep) {
      setState(AppState.SLEEP);
      setTimeout(() => {
        setState(AppState.IDLE);
        setMood(Mood.NEUTRAL);
      }, 5000);
    } else {
      setState(AppState.IDLE);
      setMood(Mood.NEUTRAL);
    }
  }, [cleanupResources]);

  const startConversation = async () => {
    try {
      await cleanupResources();
      await new Promise(resolve => setTimeout(resolve, 100));

      setState(AppState.CONNECTING);
      setErrorMessage(null);

      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch(e) {}
      }

      const apiKey = process.env.API_KEY;
      if (!apiKey) throw new Error("API Key is missing.");
      
      const ai = new GoogleGenAI({ apiKey });
      
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });

      await Promise.all([
        audioContextRef.current.resume(),
        outputAudioContextRef.current.resume()
      ]);

      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 16000
        } 
      });

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            setState(AppState.LISTENING);
            if (!audioContextRef.current) return;
            
            const source = audioContextRef.current.createMediaStreamSource(stream);
            const scriptProcessor = audioContextRef.current.createScriptProcessor(4096, 1, 1);
            
            scriptProcessor.onaudioprocess = (event) => {
              if (isClosingRef.current) return;
              const inputData = event.inputBuffer.getChannelData(0);
              const pcmBlob = createPcmBlob(inputData);
              sessionPromise.then((session) => {
                if (session && !isClosingRef.current) {
                  session.sendRealtimeInput({ media: pcmBlob });
                }
              }).catch(() => {});
            };

            source.connect(scriptProcessor);
            scriptProcessor.connect(audioContextRef.current.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (isClosingRef.current) return;

            if (message.toolCall?.functionCalls) {
              for (const fc of message.toolCall.functionCalls) {
                if (fc.name === 'setMood') {
                  const detectedMood = (fc.args as any).mood;
                  if (detectedMood && Mood[detectedMood as keyof typeof Mood]) {
                    setMood(Mood[detectedMood as keyof typeof Mood]);
                  }
                  sessionPromise.then(s => {
                    if (s) s.sendToolResponse({
                      functionResponses: [{ id: fc.id, name: fc.name, response: { result: "ok" } }]
                    });
                  });
                }
              }
            }

            const serverContent = message.serverContent;
            const audioData = serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            
            if (serverContent?.outputTranscription) {
              currentOutputTranscription.current += serverContent.outputTranscription.text || '';
            } else if (serverContent?.inputTranscription) {
              currentInputTranscription.current += serverContent.inputTranscription.text || '';
            }

            if (audioData && !isClosingRef.current) {
              const ctx = outputAudioContextRef.current;
              if (!ctx) return;
              
              if (ctx.state !== 'running') await ctx.resume();
              
              setState(AppState.SPEAKING);
              
              try {
                const rawData = decode(audioData);
                if (rawData.length > 0) {
                  const buffer = await decodeAudioData(rawData, ctx, 24000, 1);
                  const source = ctx.createBufferSource();
                  source.buffer = buffer;
                  source.connect(ctx.destination);
                  
                  source.onended = () => {
                    sourcesRef.current.delete(source);
                    if (sourcesRef.current.size === 0 && !isClosingRef.current) {
                      setState(AppState.LISTENING);
                    }
                  };

                  nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
                  source.start(nextStartTimeRef.current);
                  nextStartTimeRef.current += buffer.duration;
                  sourcesRef.current.add(source);
                }
              } catch (e) {
                console.error("Audio playback error:", e);
              }
            }

            if (serverContent?.turnComplete) {
              const output = currentOutputTranscription.current.trim();
              if (output) {
                setTranscripts(prev => [
                  ...prev,
                  { 
                    role: 'model' as const, 
                    text: output, 
                    timestamp: Date.now(),
                    mood: moodRef.current
                  }
                ]);
              }
              currentInputTranscription.current = '';
              currentOutputTranscription.current = '';
              if (sourcesRef.current.size === 0) {
                setState(AppState.LISTENING);
              }
            }

            if (serverContent?.interrupted) {
              sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              setState(AppState.LISTENING);
            }
          },
          onerror: (err: any) => {
            console.error('Live API Error:', err);
            if (err?.message?.includes('unavailable') || err?.message?.includes('503')) {
              setErrorMessage('Salin is currently overloaded. Please wait a moment and try again.');
            } else {
              setErrorMessage('Connection encountered an issue.');
            }
            setState(AppState.ERROR);
            cleanupResources();
          },
          onclose: () => {
            if (state !== AppState.SLEEP && state !== AppState.ERROR) {
              setState(AppState.IDLE);
            }
          }
        },
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseModalities: [Modality.AUDIO],
          tools: [{ functionDeclarations: [setMoodFunctionDeclaration] }],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
          },
          outputAudioTranscription: {},
          inputAudioTranscription: {},
        }
      });

      sessionRef.current = await sessionPromise;
    } catch (error: any) {
      console.error('Initialization Error:', error);
      setErrorMessage(`Failed to start Salin: ${error.message || 'Service is busy'}`);
      setState(AppState.ERROR);
      cleanupResources();
    }
  };

  const enableWakeWord = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setErrorMessage("Wake word not supported in this browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US'; 
    recognition.maxAlternatives = 3;

    recognition.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          const transcript = event.results[i][0].transcript.toLowerCase();
          const triggers = ["salin", "hoy salin", "hey salin", "hi salin"];
          if (triggers.some(t => transcript.includes(t))) {
            recognition.stop();
            startConversation();
            return;
          }
        }
      }
    };

    recognition.onerror = () => {
      if (state === AppState.STANDBY) {
         try { recognition.start(); } catch(err) {}
      }
    };

    recognition.onend = () => { 
      if (state === AppState.STANDBY) {
        try { recognition.start(); } catch(e) {} 
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
    setState(AppState.STANDBY);
  }, [state, startConversation]);

  const toggleStandby = () => {
    if (state === AppState.STANDBY) {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch (e) {}
      }
      setState(AppState.IDLE);
    } else {
      enableWakeWord();
    }
  };

  return (
    <div className="flex flex-col h-screen max-w-lg mx-auto bg-slate-900 overflow-hidden shadow-2xl border-x border-slate-800 font-sans">
      <header className="px-6 py-4 bg-slate-900/95 backdrop-blur-xl border-b border-white/5 flex items-center justify-between sticky top-0 z-30">
        <div className="flex flex-col">
          <h1 className="text-xl font-black tracking-tight bg-gradient-to-br from-blue-400 via-indigo-400 to-yellow-400 bg-clip-text text-transparent italic">
            SALINLIVE
          </h1>
          <div className="flex items-center gap-1.5 opacity-30 mt-0.5">
            <span className="text-[7px] text-blue-400 font-bold uppercase tracking-[0.2em]">ENG</span>
            <div className="w-1 h-[1px] bg-slate-600"></div>
            <span className="text-[7px] text-yellow-500 font-bold uppercase tracking-[0.2em]">FIL</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
            <div className={`px-2 py-0.5 rounded-full border border-white/5 text-[7px] font-black tracking-widest uppercase transition-all duration-500 ${
              mood === Mood.HAPPY || mood === Mood.EXCITED ? 'text-yellow-400 bg-yellow-400/10' :
              mood === Mood.SAD ? 'text-blue-400 bg-blue-400/10' :
              mood === Mood.ANGRY ? 'text-rose-400 bg-rose-400/10' :
              'text-slate-500'
            }`}>
              {mood}
            </div>
            <div className={`w-2 h-2 rounded-full transition-all duration-500 ${
              state === AppState.LISTENING ? 'bg-cyan-400 shadow-[0_0_10px_cyan]' : 
              state === AppState.STANDBY ? 'bg-indigo-400 shadow-[0_0_10px_indigo]' :
              state === AppState.SPEAKING ? 'bg-rose-400 shadow-[0_0_10px_rose] scale-125 animate-pulse' :
              state === AppState.CONNECTING ? 'bg-yellow-400 shadow-[0_0_10px_yellow] animate-thinking' :
              state === AppState.ERROR ? 'bg-rose-600 shadow-[0_0_10px_rose]' :
              'bg-slate-700'
            }`}></div>
        </div>
      </header>

      <main className="flex-1 flex flex-col relative overflow-hidden">
        <div className="flex-[2] flex flex-col items-center justify-center relative">
          <Orb state={state} mood={mood} />
          
          <div className="h-12 mt-8 flex flex-col items-center justify-center gap-1 text-center">
            {state === AppState.STANDBY ? (
              <span className="text-[10px] text-indigo-400 font-black uppercase tracking-[0.3em] animate-pulse">
                "Hoy Salin!"
              </span>
            ) : state === AppState.SPEAKING ? (
              <span className="text-[9px] text-rose-400 font-bold uppercase tracking-[0.2em]">
                Mirroring energy...
              </span>
            ) : state === AppState.LISTENING ? (
              <span className="text-[9px] text-cyan-400 font-bold uppercase tracking-[0.2em]">
                Sensing...
              </span>
            ) : state === AppState.CONNECTING ? (
              <span className="text-[9px] text-yellow-400 font-bold uppercase tracking-[0.2em]">
                Waking up...
              </span>
            ) : state === AppState.ERROR ? (
              <span className="text-[9px] text-rose-400 font-bold uppercase tracking-[0.2em]">
                System Error
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex-[3] flex flex-col overflow-hidden px-4 mb-24 z-20">
          <Transcript entries={transcripts} />
        </div>

        <div className="absolute bottom-0 left-0 right-0 px-8 py-6 flex items-center justify-between bg-gradient-to-t from-slate-950 via-slate-950 to-transparent z-30">
          <button
            onClick={toggleStandby}
            disabled={state === AppState.CONNECTING || state === AppState.LISTENING || state === AppState.SPEAKING}
            className={`flex flex-col items-center gap-1 transition-all ${
              state === AppState.STANDBY ? 'text-indigo-400 scale-110' : 'text-slate-600 hover:text-slate-400'
            } disabled:opacity-10`}
          >
            <div className={`w-11 h-11 rounded-full flex items-center justify-center border transition-all ${
              state === AppState.STANDBY ? 'border-indigo-500/50 bg-indigo-500/10 shadow-[0_0_15px_rgba(99,102,241,0.2)]' : 'border-slate-800 bg-slate-900/50'
            }`}>
              <i className="fas fa-bolt-lightning text-xs"></i>
            </div>
            <span className="text-[7px] font-black uppercase tracking-[0.2em]">STANDBY</span>
          </button>

          <div className="relative transform -translate-y-2">
            {state === AppState.IDLE || state === AppState.STANDBY || state === AppState.SLEEP || state === AppState.ERROR || state === AppState.CONNECTING ? (
              <button
                onClick={() => startConversation()}
                disabled={state === AppState.CONNECTING}
                className={`group flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-full transition-all active:scale-95 shadow-2xl shadow-blue-500/20 disabled:opacity-50`}
              >
                <i className={`fas ${state === AppState.CONNECTING ? 'fa-circle-notch fa-spin' : 'fa-microphone'} text-2xl text-white`}></i>
              </button>
            ) : (
              <button
                onClick={() => stopConversation()}
                className="group flex items-center justify-center w-16 h-16 bg-rose-600 rounded-full transition-all active:scale-95 shadow-2xl shadow-rose-500/20"
              >
                <i className="fas fa-stop text-xl text-white"></i>
              </button>
            )}
          </div>

          <button
            onClick={() => setTranscripts([])}
            className="flex flex-col items-center gap-1 text-slate-600 hover:text-slate-400"
          >
            <div className="w-11 h-11 rounded-full flex items-center justify-center border border-slate-800 bg-slate-900/50">
              <i className="fas fa-rotate-right text-xs"></i>
            </div>
            <span className="text-[7px] font-black uppercase tracking-[0.2em]">CLEAR</span>
          </button>
        </div>
      </main>

      {errorMessage && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[90%] bg-slate-900/95 backdrop-blur-xl p-6 rounded-2xl text-center shadow-2xl z-50 border border-rose-500/30">
          <div className="w-10 h-10 bg-rose-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
             <i className="fas fa-triangle-exclamation text-rose-500 text-sm"></i>
          </div>
          <p className="text-[10px] text-white font-black uppercase tracking-widest mb-4 leading-relaxed">{errorMessage}</p>
          <div className="flex flex-col gap-2">
            <button 
              onClick={() => startConversation()} 
              className="bg-indigo-600 py-2 rounded-lg text-[8px] text-white font-black uppercase tracking-widest"
            >
              Try Again
            </button>
            <button 
              onClick={() => setErrorMessage(null)} 
              className="text-[8px] text-white/40 font-bold uppercase tracking-widest underline"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
